# Nari Surokkha — Performance & Scalability Analysis

**Repository:** `D:\Productions\nari-surokkha`
**Reviewed:** 19 August 2026
**Scope:** `services/api`, `services/ml-service`, `apps/admin-portal`, `apps/police-portal`, `apps/mobile`, `packages/shared`, `infra/`, `deploy/`
**Codebase size:** ~30,200 lines across 228 source files

---

## 1. Executive summary

Nari Surokkha is a well-structured monorepo. The API follows a clean
controller → service → repository layering, Fastify is configured sensibly,
the schema is thorough, and the deployment story (Docker Compose + nginx +
Let's Encrypt + coturn) is more complete than most projects at this stage. The
foundations for scale are actually *present* — PostGIS geometry columns with
GIST indexes, a Socket.IO Redis adapter, BullMQ queues, Redis-backed
distributed rate limiting.

The problem is that **most of those foundations are not actually being used**.
The spatial indexes exist but no query touches them. Redis is installed but
nothing is cached. The queue exists but the slowest work still runs inline on
the SOS request. The result is a system that looks horizontally scalable on
paper but is, today, a single-instance application whose most latency-critical
path — triggering an SOS — is also its slowest.

None of this is hard to fix. The five highest-impact items in this report are
all small, localised changes, and together they should cut SOS trigger latency
by roughly an order of magnitude and remove the main barriers to running more
than one API container.

### Scorecard

| Dimension | Rating | One-line verdict |
|---|:--:|---|
| **Performance (API)** | **5.5 / 10** | Correct but unoptimised; the SOS hot path does ~15 sequential round trips |
| **Scalability** | **4.0 / 10** | Single instance by construction; workers, uploads and geo queries all block scale-out |
| **Database design** | **7.0 / 10** | Good schema and indexing — but the spatial indexes are never used |
| **Architecture & code quality** | **7.0 / 10** | Clean layering, good separation, weakened by `any` types and duplicated logic |
| **Security** | **6.5 / 10** | Solid auth/RBAC/rate-limit design, undermined by two global socket broadcasts and IP-keyed limits |
| **Reliability & observability** | **3.0 / 10** | No metrics, no tracing, no error tracking, no alerting. You are flying blind |
| **Frontend performance** | **5.0 / 10** | Zero code splitting; MUI + Leaflet + Google Maps + Recharts in one bundle |
| **Mobile performance** | **6.0 / 10** | Reasonable, but 5-second location pings cost 3 DB queries each |
| **Testing & CI** | **4.5 / 10** | ~82 tests, good CI skeleton, but no load testing and no coverage gate |
| **Overall** | **5.4 / 10** | Production-*capable* at pilot scale; not yet production-*ready* at city scale |

### Where you are today (realistic capacity)

Based on the code paths reviewed, on a single mid-size VPS:

| Metric | Comfortable today | Fails around | Limiting factor |
|---|---|---|---|
| Registered users | ~50,000 | ~250,000 | `responders` / `incident_reports` sequential scans |
| Concurrent WebSocket clients | ~3,000–5,000 | ~10,000 | Single Node process; per-request `info` logging |
| Concurrent active SOS | ~200–500 | ~2,000 | 3 DB queries per 5-second location ping |
| SOS triggers per minute | ~30–60 | ~150 | Inline responder fan-out on the request path |
| Police portal dashboards | ~50 officers | ~200 | Unbounded `getActiveAlertsForStation` query |

These are estimates from code review, not measurements. **The single most
valuable thing you can do this week is make them measurable** (see §7.1).

---

## 2. Architecture overview

```
                            ┌──────────────────────────────┐
   Mobile (Expo/RN)  ───────┤                              │
   Admin portal (Vite/React)┤   nginx  (TLS, 3 subdomains) │
   Police portal (Vite/React)                              │
                            └───────────────┬──────────────┘
                                            │
                            ┌───────────────▼──────────────┐
                            │  Fastify API  (single node)  │
                            │  • HTTP routes /api/v1       │
                            │  • Socket.IO server          │
                            │  • BullMQ Queues  ← same     │
                            │  • BullMQ Workers ← process  │
                            └──┬──────────┬────────────┬───┘
                               │          │            │
                    ┌──────────▼──┐  ┌────▼────┐  ┌────▼──────────┐
                    │ PostgreSQL  │  │  Redis  │  │ ml-service    │
                    │ + PostGIS   │  │         │  │ (FastAPI)     │
                    └─────────────┘  └─────────┘  └───────────────┘
                                            │
                              coturn (host net) ·  OSRM (opt-in)
```

**Stack:** Fastify 5 · Prisma 5 · PostgreSQL 16 + PostGIS 3.4 · Redis 7 ·
BullMQ 5 · Socket.IO 4.8 · React 19 + Vite 8 (portals) · Expo 56 / RN 0.85
(mobile) · FastAPI (ML inference).

**What's genuinely good:**

- Clean module boundaries — every domain has `routes` / `controller` /
  `service` / `repository` / `schemas`. This is the right shape.
- `plugins/websocket.ts` authenticates every socket handshake with a JWT and
  authorises every room join against alert ownership. Many projects skip this.
- The Socket.IO Redis adapter is already wired up with proper duplicated
  pub/sub clients.
- `config/env.ts` validates the whole environment through Zod at boot,
  including a rule that forbids wildcard CORS in production.
- The error handler never leaks internals to clients and logs operational vs.
  unexpected errors at different levels.
- The public tracking page (`/t/:token`) uses short-lived opaque Redis tokens
  rather than JWTs in an SMS — a good, thoughtful design.

---

## 3. Performance findings

Ordered by impact. Severity: 🔴 critical · 🟠 high · 🟡 medium · ⚪ low.

### 🔴 P1 — Every geospatial query does a full table scan

**This is the highest-leverage finding in the report.**

The initial migration creates real PostGIS geometry columns *and* GIST indexes
on `police_stations`, `emergency_alerts`, `alert_locations`, `responders`,
`incident_reports` and `safety_scores`, and keeps them in sync with database
triggers:

```sql
-- 20260624000000_init/migration.sql
location GEOMETRY(Point, 4326),
CREATE INDEX idx_responders_location ON responders USING GIST(location) ...;
CREATE TRIGGER trg_sync_responder_location ... EXECUTE FUNCTION sync_responder_location();
```

But **not one application query uses the `location` column.** Every spatial
query rebuilds the point from the `latitude` / `longitude` decimal columns:

| Location | Query | Effect |
|---|---|---|
| `alerts.repository.ts:22` | `ORDER BY ST_SetSRID(ST_MakePoint(longitude::float, latitude::float),4326) <-> …` | Seq scan of `police_stations` on every SOS |
| `responder.repository.ts:55` | `ST_DistanceSphere(ST_MakePoint(longitude::float, latitude::float), …)` | Seq scan of `responders` on every SOS |
| `alerts.service.ts:508` | `ST_DWithin(ST_MakePoint(longitude::float, latitude::float)::geography, …)` | Seq scan of `incident_reports` on every Safe Route request |
| `incidents.repository.ts:61` | same pattern | Seq scan on every nearby-incidents lookup |

Because the expression differs from the indexed column, PostgreSQL cannot use
the GIST index at all. These are O(n) scans on tables that grow with your user
base — `responders` and `incident_reports` in particular grow forever.

**Fix** — use the column that is already indexed and already populated:

```ts
// responder.repository.ts — findNearbyResponders
const result = await this.prisma.$queryRaw`
  SELECT id, user_id AS "userId"
  FROM responders
  WHERE status = 'verified'
    AND availability = 'available'
    AND location IS NOT NULL
    AND ST_DWithin(location::geography,
                   ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography,
                   ${radiusMeters})
  ORDER BY location <-> ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)
  LIMIT 20;
`;
```

```ts
// alerts.repository.ts — findNearestPoliceStation
ORDER BY location <-> ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)
LIMIT 1;
```

Add a geography-cast expression index where you filter by distance in metres:

```sql
CREATE INDEX idx_responders_location_geog
  ON responders USING GIST ((location::geography))
  WHERE status = 'verified';
CREATE INDEX idx_incident_reports_location_geog
  ON incident_reports USING GIST ((location::geography));
```

**Expected effect:** nearby-responder lookup drops from O(n) to an index probe
— roughly 200 ms → under 5 ms at 100k responders. Safe Route scoring likewise.

> Verify the triggers actually backfilled existing rows before switching:
> `SELECT count(*) FROM responders WHERE location IS NULL AND latitude IS NOT NULL;`
> If non-zero, run a one-off `UPDATE … SET location = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)`.

---

### 🔴 P2 — The SOS trigger path does ~15 sequential round trips before responding

`AlertsService.triggerManualSos` → `dispatchConfirmedAlert`
(`alerts.service.ts:111–240`) runs, **inline, before the citizen's phone gets a
response**:

1. Fetch trusted contacts
2. Nearest police station (full scan — P1)
3. Insert alert
4. Insert audit log
5. Enqueue notification job ✅ *(this part is right)*
6. Two Socket.IO emits
7. Create a police case (another insert)
8. Nearby responder lookup (full scan — P1)
9. **Then, per responder, sequentially:**
   - `createDispatch` — one INSERT
   - one Socket.IO emit
   - `deviceToken.findMany` — **a classic N+1 query** (`:202`)
   - an unawaited `fetch()` to `exp.host` — **one HTTP call per responder,
     not batched** (`:216`)

With ten nearby responders that's 10 inserts + 10 queries + 10 outbound HTTPS
requests, all before `reply.send()`. In a *panic-button* flow. If the Expo
endpoint is slow, `fetch()` is fired without `await` — so failures are
invisible and the request may terminate before the push is sent.

**Fix:** the alert row and its tracking token are the only things the caller
needs. Everything from step 4 onward belongs in the queue you already have:

```ts
async triggerManualSos(userId, data, ipAddress) {
  const nearestStation = await this.repo.findNearestPoliceStation(data.latitude, data.longitude);
  const alert = await this.repo.createAlert({ ...data, userId, assignedStationId: nearestStation?.id, status: 'confirmed' });

  // Fire-and-forget: police portal must know instantly, so keep the emit.
  this.fastify.io?.to(`station:${nearestStation?.id ?? 'dispatch'}`).emit('alert:created', payload);

  // Everything else is queued.
  await this.fastify.queues.dispatch.add('fan_out_alert', { alertId: alert.id, userId });

  return { ...alert, trackingToken: generateTrackingToken(alert.id) };
}
```

Then in the worker, replace the per-responder loop with set operations:

```ts
const responders = await responderRepo.findNearbyResponders(lat, lng, 5000); // now index-backed
await prisma.responderDispatch.createMany({
  data: responders.map(r => ({ responderId: r.id, alertId })),
});
const tokens = await prisma.deviceToken.findMany({          // ONE query, not N
  where: { userId: { in: responders.map(r => r.userId) }, isActive: true },
  select: { token: true },
});
await sendExpoPushBatched(tokens.map(t => t.token), payload); // Expo accepts 100/request
```

**Expected effect:** p95 SOS response time from ~600–1500 ms down to ~40–80 ms.
For an emergency button, this is the difference that matters most.

---

### 🟠 P3 — Notification job retries re-send SMS to contacts that already received it

`NotificationsService.processTrustedContactsNotification`
(`notifications.service.ts:99–167`) loops over contacts sequentially, and at
the end:

```ts
if (errors.length > 0) {
  throw new Error(`Notification processing had ${errors.length} failures.`);
}
```

The queue is configured with `attempts: 3`. So if contact #4 of 5 fails, BullMQ
re-runs the **entire** job — and contacts #1–3 get a second and then a third
duplicate SOS SMS. That is real money (paid SMS), real noise, and in an
emergency, real confusion.

Each iteration is also fully sequential: SMS send → `user.findUnique` →
notification-log insert → notification-log update. Five contacts ≈ 20 serial
round trips.

**Fix:**

- Make the job idempotent — one queue job **per contact**, keyed
  `jobId: \`${alertId}:${contactId}\``, so BullMQ deduplicates and retries only
  the contact that actually failed.
- Send in parallel: `await Promise.allSettled(contacts.map(sendToContact))`.
- Pre-fetch all contact-users in one query
  (`user.findMany({ where: { phone: { in: phones } } })`) instead of one lookup
  per contact.
- Normalise phone numbers before matching (the code's own comment flags this:
  *"Assuming phone numbers match EXACTLY"*) — `+8801…` vs `01…` will silently
  miss push delivery today.

---

### 🟠 P4 — Live location tracking costs 3 database queries per ping

On native, `startBackgroundLocationUpdates` (`services/backgroundTasks.ts:55`)
streams position every `10 s / 10 m` at `Accuracy.Balanced`; the web path
(`ActiveSosScreen.tsx:192`) uses `5 s / 5 m` at `Accuracy.Highest`. Each ping
hits `POST /alerts/:id/location`, which runs:

1. `getAlertById` — authorisation check (`alerts.service.ts`)
2. `alertLocation.create` — INSERT
3. `emergencyAlert.update` — UPDATE the denormalised latest position

Steps 2 and 3 are **not in a transaction**, so a crash between them leaves the
trail and the alert marker disagreeing.

At 500 concurrent active SOS on native cadence: 50 req/s → 150 queries/s →
~100 writes/s, purely for tracking. `alert_locations` grows without bound and
is never pruned.

**It gets worse when a Safe Route is active.** The same background task
(`backgroundTasks.ts:31`) *additionally* posts to
`/alerts/safe-route/:id/location` on every tick, and `updateRouteLocation`
(`alerts.service.ts`) does a fresh `activeRoute.findUnique` each time. A user
with both an active SOS and an active route generates 2 requests and 4+
queries every 10 seconds. The route's waypoints never change — cache them.

**Fix:**

```ts
// 1. Cache the ownership check — the alert's owner never changes.
const cacheKey = `alert:${alertId}:owner`;
let ownerId = await redis.get(cacheKey);
if (!ownerId) {
  ownerId = (await repo.getAlertById(alertId))?.userId;
  await redis.set(cacheKey, ownerId, 'EX', 3600);
}

// 2. Collapse the two writes into one round trip.
await prisma.$transaction([
  prisma.alertLocation.create({ data: { alertId, latitude, longitude, accuracy } }),
  prisma.emergencyAlert.update({ where: { id: alertId }, data: { latitude, longitude, accuracy } }),
]);
```

Longer term, buffer pings in Redis and flush a batch every 15–30 s
(`createMany`), keeping only the *latest* position hot in Redis for the police
portal. That turns 200 writes/s into ~15 writes/s.

Also add a retention job: partition `alert_locations` by month, or delete rows
for alerts closed more than 90 days ago.

---

### 🟠 P5 — Two Socket.IO broadcasts go to *every* connected client

```ts
// evidence.service.ts:52
this.fastify.io.emit('evidence_uploaded', { alertId, evidenceId, type });

// responder.service.ts:63
this.fastify.io.emit('responder_accepted', { … });
```

`io.emit()` with no room targets **every socket on every API instance**,
including ordinary citizens' phones. Two problems:

- **Performance:** with 5,000 connected clients, one evidence upload
  fans out to 5,000 frames through the Redis adapter.
- **Privacy:** every user of the app learns that evidence was uploaded for
  alert `X`. For a women's-safety platform, that is a meaningful leak.

**Fix:** scope both to the rooms that already exist:

```ts
this.fastify.io.to(`alert:${alertId}`)
  .to(`station:${alert.assignedStationId}`)
  .to('station:dispatch')
  .emit('evidence_uploaded', { … });
```

---

### 🟠 P6 — The analytics endpoint loads 30 days of rows into Node to count them

`AdminRepository.getAnalyticsData` (`admin.repository.ts:377`):

```ts
this.prisma.emergencyAlert.findMany({ where: { createdAt: { gte: thirtyDaysAgo } }, select: { createdAt: true } }),
this.prisma.incidentReport.findMany({ where: { createdAt: { gte: thirtyDaysAgo } }, select: { createdAt: true, latitude: true, longitude: true, type: true } })
```

…then groups by day in a JavaScript loop. The code even admits it:
*"Let's just fetch the last 30 days and group in memory for simplicity here."*

At 1,000 alerts/day that is 30,000 rows transferred and parsed on every
dashboard load. `recentIncidents` then returns the *entire* 30-day incident
array to the browser for the heatmap.

**Fix** — one SQL statement, and cache it:

```sql
SELECT date_trunc('day', created_at)::date AS day, count(*)::int
FROM emergency_alerts
WHERE created_at >= now() - interval '30 days'
GROUP BY 1 ORDER BY 1;
```

Wrap in `redis.get`/`setex` with a 5-minute TTL — analytics does not need to be
real-time. For the heatmap, aggregate server-side into a grid
(`ST_SnapToGrid`) rather than shipping raw points.

---

### 🟡 P7 — Unbounded queries with no pagination

| Location | Query | Risk |
|---|---|---|
| `police.repository.ts:66` | `getActiveAlertsForStation` — no `take`, joins user + profile | A busy station's dashboard grows without limit |
| `cases.service.ts` | `getCaseTimeline` → `getAlertLocations` — no limit | A 1-hour SOS = 720 location rows in one response |
| `responder.repository.ts` | `getDispatchesForResponder` — no `take` | Grows with responder tenure |
| `admin.repository.ts:308` | `listAuditLogs` — `take: 50` but no `skip`/cursor | Older logs are simply unreachable |

**Fix:** cursor pagination (`cursor` + `take`) everywhere; offset pagination
degrades badly past a few thousand rows. Cap `getCaseTimeline` locations and
expose a separate paginated trail endpoint.

---

### 🟡 P8 — Admin search uses unindexed `ILIKE '%…%'`

`listUsers`, `listResponders`, `listStations` all use
`{ contains: search, mode: 'insensitive' }`, which Prisma compiles to
`ILIKE '%term%'`. A leading wildcard cannot use a B-tree index — every search
is a full scan plus a join to `user_profiles`.

**Fix:**

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_users_phone_trgm ON users USING GIN (phone gin_trgm_ops);
CREATE INDEX idx_user_profiles_name_trgm ON user_profiles USING GIN (full_name gin_trgm_ops);
```

---

### 🟡 P9 — Every request is logged twice at `info`

`app.ts:182` and `app.ts:190` add `onRequest` and `onResponse` hooks that each
log at `info`. Fastify's built-in logger already emits both. So you get four
log lines per request, each with JSON serialisation cost, and Docker's default
`json-file` driver has **no size limit configured** — this will eventually fill
the VPS disk.

**Fix:** delete both hooks (Fastify's defaults carry `reqId`, method, url,
statusCode and `responseTime` already). Add log rotation to compose:

```yaml
logging:
  driver: json-file
  options: { max-size: "50m", max-file: "5" }
```

---

### 🟡 P10 — Evidence uploads are buffered fully in memory

`EvidenceService.processUpload` takes a `Buffer`. With a 10 MB limit and, say,
20 concurrent uploads, that's 200 MB of heap in a container with no memory
limit set. `getFileContent` similarly pulls whole files through the API rather
than redirecting to a presigned URL.

**Fix:** stream multipart directly to S3/MinIO with
`@aws-sdk/lib-storage`'s `Upload`; for downloads, issue a presigned URL
(the code already has `getPresignedUrl`) and let the client fetch the object
directly.

### ⚪ P11 — Smaller items

- **`DATABASE_POOL_MIN` / `DATABASE_POOL_MAX` are validated but never used.**
  Prisma takes its pool size from `?connection_limit=` in the connection
  string. The env vars are dead code, so you are silently on Prisma's default
  (`num_cpus * 2 + 1`).
- **Duplicate case-number generators.** `police.repository.ts:createCase` uses
  `CASE-${Date.now()}`; `cases.service.ts` uses `CASE-${year}-${4 hex chars}`.
  Two schemes for one unique column.
- **Case-number collisions are near-certain.** 4 hex chars = 65,536 values per
  year; by the birthday bound, a collision becomes more likely than not at
  ~300 cases/year and `case_number` is `UNIQUE`. Use `CASE-${year}-${sequence}`
  from a Postgres sequence, or 8+ random chars with a retry.
- **`removeOnComplete: true` on both queues** discards all job history — you
  lose the ability to debug a failed SOS fan-out. Prefer
  `removeOnComplete: { age: 86400, count: 1000 }`.
- **Missing composite indexes** for the queries you actually run:
  `(assigned_station_id, status, created_at DESC)` on `emergency_alerts`,
  `(station_id, status)` on `cases`, `(alert_id, status)` on
  `notification_logs`.

---

## 4. Scalability analysis — 4.0 / 10

### 4.1 The blockers to running more than one API container

The Socket.IO Redis adapter and Redis-backed rate limiting mean you *designed*
for multiple instances. Four things stop you actually doing it:

**① Workers run inside the API process.** `plugins/worker.ts` is registered in
`buildApp()`, so every API replica also runs notification and escalation
workers at `concurrency: 5`. Consequences: CPU-bound job processing competes
with request handling on the same event loop; you cannot scale workers and API
independently; and a worker crash takes down an HTTP server.

> **Fix:** a `WORKER_MODE=true` env flag, or better, a separate
> `services/worker` entrypoint sharing the same code. In compose:
> `api: { deploy: { replicas: 3 } }` + `worker: { replicas: 1 }`.

**② Evidence lives on a host bind-mount.** `STORAGE_LOCAL_DIR: /app/uploads`
with `- ${UPLOADS_DIR}:/app/uploads`. Two API containers on two hosts cannot
share it. The S3 storage provider is already implemented — switching
`STORAGE_PROVIDER` to `aws-s3`/`cloudflare-r2` removes this blocker entirely.

**③ nginx has a single hardcoded upstream.** `proxy_pass http://api:3001;`
with no `upstream` block, no `ip_hash`/`least_conn`, no health checks.

> **Fix:**
> ```nginx
> upstream nari_api {
>     least_conn;
>     server api:3001 max_fails=3 fail_timeout=10s;
>     keepalive 32;
> }
> ```
> Socket.IO's default transport upgrade needs sticky sessions *or*
> `transports: ['websocket']` on the client to skip long-polling. You already
> run the Redis adapter, so `websocket`-only is the cleaner choice.

**④ No connection pooler.** With N API replicas × Prisma's default pool, you
will exhaust PostgreSQL's `max_connections` quickly. Add PgBouncer in
transaction mode, and set `?pgbouncer=true&connection_limit=…` on the Prisma
URL.

### 4.2 Database scaling

- **No read replica, no read/write split.** Analytics, audit logs and admin
  lists all hit the primary.
- **No partitioning** on the append-only high-volume tables:
  `alert_locations`, `audit_logs`, `notification_logs`, `ml_training_samples`.
  Monthly `PARTITION BY RANGE (created_at)` with an automated drop of old
  partitions is the standard answer and is much cheaper than bulk `DELETE`.
- **No retention policy at all.** Nothing is ever pruned. `alert_locations`
  alone will accumulate ~720 rows per hour of active SOS.
- **PostgreSQL runs on stock defaults** — the compose file sets no
  `shared_buffers`, `work_mem`, `effective_cache_size` or `max_connections`.
  On a 8 GB VPS the defaults leave most of the machine unused.

### 4.3 Infrastructure gaps

| Gap | Impact |
|---|---|
| No `deploy.resources.limits` on any service | One runaway container can OOM the whole VPS |
| No container log rotation | Disk fills; the API stops accepting writes |
| No backup service in compose (only a `backup.sh` script) | Backups depend on someone remembering |
| coturn on `network_mode: host` with ports 49152–49200 | Correct for TURN, but ties the stack to one host |
| Single VPS, no failover | Any host failure = total outage of an emergency service |
| OSRM defaults to the **public demo server** | `router.project-osrm.org` is rate-limited and explicitly not for production; Safe Route silently degrades to straight-line fallback |

---

## 5. Security review — 6.5 / 10

**Done well:** Argon2id password hashing with tuned parameters; JWT access
(15 m) + refresh (30 d) split; per-socket handshake auth with per-room
authorisation; Twilio webhook signature verification that *fails closed*;
helmet; Zod-enforced non-wildcard CORS in production; an error handler that
never leaks internals; presigned URLs for evidence.

**Issues:**

| # | Severity | Finding |
|---|---|---|
| S1 | 🔴 | **Global socket broadcasts leak alert IDs** to every connected client (see P5). |
| S2 | 🟠 | **Rate limits are keyed on IP.** In Bangladesh, mobile carriers use CGNAT — thousands of users share one public IP. The global 100 req/min limit will throttle legitimate users, and worse, could block someone's SOS. Key authenticated routes on `request.user.id`, keep IP-keying for `/auth/*` only. |
| S3 | 🟠 | **Permissions are baked into the JWT.** Revoking an admin's `manage_users` permission has no effect until their 15-minute access token expires. Add a Redis `token_version:<userId>` check, or look up permissions per request (cached). |
| S4 | 🟠 | **No refresh-token rotation or reuse detection.** `user_sessions` stores the refresh token; a stolen 30-day token is valid for 30 days. Rotate on every refresh and revoke the whole family on reuse. |
| S5 | 🟠 | **Seed credentials (`Test@1234`) are public in the repo.** Already noted in your project memory — worth re-verifying that production admin passwords were changed and test accounts disabled. |
| S6 | 🟡 | **No account lockout.** `RATE_LIMIT_LOGIN_MAX: 5` per IP is bypassed by rotating IPs. Add per-account exponential backoff. |
| S7 | 🟡 | **No CSRF protection** despite cookie-based auth being supported (`authenticate.ts` falls back to `request.cookies.accessToken`). Set `SameSite=Strict` at minimum. |
| S8 | 🟡 | **Tracking tokens are 6 random bytes (48 bits).** Fine against blind guessing at current volume, but these grant location access to a person in danger. 16 bytes costs nothing. |
| S9 | 🟡 | **`ml-service` trusts a static API key** with no rotation mechanism. |
| S10 | ⚪ | **nginx lacks HSTS**, `gzip`, and edge rate limiting (`limit_req_zone`). |

---

## 6. Frontends & mobile

### Portals (admin + police) — 5.0 / 10

- **No code splitting whatsoever.** `App.tsx` statically imports all twelve
  pages; `grep` for `React.lazy` returns nothing. Both portals bundle MUI,
  Leaflet, `@react-google-maps/api`, Recharts (admin), framer-motion and
  socket.io-client into a single chunk. A police officer on a 3G connection
  waits for the analytics charting library before they can see an alert.
- **No `manualChunks`** in either `vite.config.ts`.
- **Two mapping libraries shipped simultaneously** — Leaflet *and* Google Maps.
  Pick one.
- **No data-fetching library.** Raw axios + zustand means no request
  deduplication, no caching, no stale-while-revalidate, and manual loading
  state in every component.
- **`Dashboard.tsx:104,113`** runs two `setInterval` timers (10 s and 2 s)
  alongside the WebSocket. The 2-second connection check is wasteful.

**Fixes, in order of value:**

```ts
// 1. Route-level splitting — typically 60-70% off initial bundle
const Analytics = lazy(() => import('./pages/Analytics'));

// 2. vite.config.ts
build: {
  rollupOptions: {
    output: {
      manualChunks: {
        vendor: ['react', 'react-dom', 'react-router-dom'],
        mui: ['@mui/material', '@mui/icons-material'],
        maps: ['leaflet', 'react-leaflet'],
        charts: ['recharts'],
      },
    },
  },
},
```

3. Adopt TanStack Query for server state; keep zustand for UI state only.
4. Add `rollup-plugin-visualizer` so bundle size is visible in CI.
5. Add `gzip on;` / `brotli` and `Cache-Control: immutable` for hashed assets
   in nginx.

### Mobile (Expo / React Native) — 6.0 / 10

**Strong points:** on-device TFLite inference for motion and audio (keeps the
detection loop off the network), background task manager for location, offline
SMS SOS fallback, secure token storage via `expo-secure-store`, an
`ErrorBoundary`, and `babel-plugin-transform-remove-console` for release
builds.

**Issues:**

- **The production API URL is hardcoded** (`services/api.ts:17`,
  `https://api.mystrix-soft.com/api/v1`). Move to
  `expo-constants` / EAS build profiles so staging and production builds differ.
- **Location pings cost 3 DB queries each** (P4) — and double when a Safe
  Route is also active. Consider adaptive cadence (10 s while moving, 30–60 s
  while stationary) and batching several fixes into one request.
- **No request retry / offline queue** on the axios client. A location update
  that fails during a cellular handover is simply lost.
- **No bundle or startup-time budget.** `react-native-fast-tflite` +
  `react-native-webrtc` + Reanimated 4 is a heavy footprint; measure TTI.

---

## 7. Reliability, observability & testing

### 7.1 Observability — 3.0 / 10 (the biggest single gap)

`SENTRY_DSN` is declared in `env.ts` and **never referenced anywhere else**.
There is no `/metrics` endpoint, no OpenTelemetry, no tracing, no dashboards,
no alerting. `/health` is a good liveness check but tells you nothing about
latency, error rate, or queue depth.

For an emergency-response service, this is the most serious gap in the report:
**you would not know that SOS dispatch had broken until a user told you.**

**Minimum viable observability — about a day's work:**

```ts
// 1. Prometheus metrics
import metricsPlugin from 'fastify-metrics';
await fastify.register(metricsPlugin, { endpoint: '/metrics' });

// 2. Custom SLI: the number that actually matters
const sosLatency = new Histogram({
  name: 'sos_dispatch_duration_seconds',
  help: 'Time from SOS request to police notification',
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5],
});

// 3. Error tracking
Sentry.init({ dsn: env.SENTRY_DSN, tracesSampleRate: 0.1 });
```

Add Prometheus + Grafana + Alertmanager to `docker-compose.prod.yml`
(three small containers), plus `bull-board` for queue visibility. Then define
SLOs and alert on them:

| SLO | Target | Alert |
|---|---|---|
| SOS trigger p95 latency | < 500 ms | page immediately |
| SOS → SMS delivered p95 | < 10 s | page immediately |
| API 5xx rate | < 0.1% | page |
| Notification queue depth | < 100 | warn |
| WebSocket connected clients | — | dashboard |

### 7.2 Testing — 4.5 / 10

~82 test cases across 13 files, covering auth, alerts, contacts, incidents,
police, admin, notifications, profile, schema, plus one integration and one
E2E test. That's a real foundation. What's missing:

- **No coverage gate.** `test:coverage` exists; CI never enforces a threshold.
- **No load or soak testing.** For a system whose defining characteristic is
  *simultaneous emergency spikes*, this is the critical omission. Add k6:

  ```js
  // load/sos-spike.js — 500 concurrent SOS triggers
  export const options = { stages: [
    { duration: '30s', target: 50 },
    { duration: '1m',  target: 500 },
    { duration: '2m',  target: 500 },
  ]};
  ```
- **No WebSocket load test.** You do not know how many concurrent sockets one
  instance holds.
- **Portals and mobile have no tests at all** — `npm test` is absent from both
  portal `package.json` files.
- **Stale quality reports.** `type-check-report.txt` (81 `error TS` lines) and
  `lint-report.txt` both reference an old `D:\NRI\...` path. Regenerate them or
  delete them; right now they misrepresent the current state either way.
- **CI does not build the Docker images** or run migrations against a
  production-like dataset.

### 7.3 Data protection

- No documented backup *restore* test. A backup you have never restored is a
  hypothesis, not a backup.
- No documented RPO/RTO.
- Evidence files (photos/audio/video of assaults) have no encryption-at-rest
  configuration and no documented retention/deletion policy — for this data
  class that is both a compliance and an ethical exposure.

---

## 8. What should be newly implemented

### 8.1 Platform capabilities (highest value first)

| # | Capability | Why | Effort |
|---|---|---|---|
| 1 | **Observability stack** — Prometheus, Grafana, Sentry, bull-board, SLO alerts | You cannot operate an emergency service blind | M |
| 2 | **Separate worker process** | Unblocks independent scaling; isolates job crashes | S |
| 3 | **Redis caching layer** — police stations, active alerts per station, alert ownership, analytics, ICE config | Redis is deployed and doing almost nothing | M |
| 4 | **Load-testing suite (k6)** — SOS spike, WebSocket fan-out, location-ping soak | Turns capacity guesses into numbers | M |
| 5 | **Object storage for evidence (S3/R2)** | Removes the last statefulness blocking multi-node | S |
| 6 | **PgBouncer + read replica** | Required before 3+ API replicas | M |
| 7 | **Table partitioning + retention jobs** | `alert_locations` / `audit_logs` grow forever | M |
| 8 | **Idempotency keys on `POST /alerts/sos`** | A phone retrying on a flaky network must not create three alerts | S |
| 9 | **Circuit breakers on SMS / Expo / OSRM / ML** | Today an SMS provider outage fails jobs; it should degrade | M |
| 10 | **Dead-letter queue + operator replay UI** | A permanently-failed SOS notification currently vanishes | S |

### 8.2 Product features worth building

| Feature | Rationale |
|---|---|
| **Dispatch acknowledgement SLA + auto-escalation** | If no responder or officer acknowledges within N seconds, escalate to the next-nearest station and notify a supervisor. Today an ignored alert stays ignored. |
| **Two-way communication on an active alert** | The victim can see that help is coming, but cannot exchange a message. A one-tap "I'm safe" / "Still in danger" channel is high-value and cheap. |
| **Responder reputation & reliability scoring** | Dispatch currently notifies *all* responders in 5 km with no ranking. Rank by acceptance rate, proximity and recent responsiveness; notify the top N. |
| **Geofenced safe zones / check-in timers** | "If I don't check in by 22:00, alert my contacts" — a natural extension of the existing `ActiveRoute` deviation logic. |
| **Offline-first alert queue on mobile** | Offline SMS SOS exists; extend it to a durable outbox that syncs evidence and location when connectivity returns. |
| **Police duty roster & shift-aware routing** | `getActiveAlertsForStation` assumes someone is watching the dashboard. Route to the officer actually on shift. |
| **Multi-language (Bangla) across all surfaces** | For the target user base this is a correctness requirement, not a nicety. |
| **Accessibility pass on the SOS flow** | Panic conditions degrade fine motor control; large targets, haptics, voice trigger. |
| **Admin-facing SLA dashboard** | Median time-to-dispatch, time-to-acknowledge, per-station response times — the metrics that justify the platform to government stakeholders. |
| **Data retention & subject-access tooling** | Users should be able to see and delete their own evidence and location history. |

---

## 9. Prioritised roadmap

### Sprint 1 — one week, mostly small diffs

| Task | File(s) | Effort |
|---|---|---|
| Use `location` geometry column in all 4 spatial queries (P1) | `alerts.repository.ts`, `responder.repository.ts`, `incidents.repository.ts`, `alerts.service.ts` | S |
| Add geography expression indexes + backfill check | new migration | S |
| Move responder fan-out off the SOS request path (P2) | `alerts.service.ts`, `plugins/worker.ts` | M |
| Batch Expo pushes; kill the `deviceToken` N+1 | `alerts.service.ts` | S |
| Scope the two global `io.emit` calls to rooms (P5/S1) | `evidence.service.ts`, `responder.service.ts` | S |
| Remove the duplicate request/response log hooks (P9) | `app.ts` | XS |
| Add Docker log rotation + resource limits | `docker-compose.prod.yml` | XS |
| Fix case-number generation & unify the two generators | `cases.service.ts`, `police.repository.ts` | S |
| Point `OSRM_URL` at the self-hosted container | `.env.production` | XS |

### Sprint 2 — two weeks

- Prometheus `/metrics` + Sentry + Grafana dashboards + SLO alerts
- Extract a separate worker service; add `replicas` to compose
- Per-contact idempotent notification jobs (P3) + phone normalisation
- Redis caching for stations, alert ownership and analytics
- Rewrite `getAnalyticsData` as SQL aggregation (P6)
- Cursor pagination on all list endpoints (P7)
- Route-level code splitting + `manualChunks` in both portals

### Sprint 3 — one month

- k6 load suite in CI; publish a real capacity model
- PgBouncer; PostgreSQL tuning; read replica for analytics
- Partition `alert_locations` / `audit_logs`; retention jobs
- Move evidence to S3/R2 with streaming upload
- Refresh-token rotation + reuse detection (S4); user-keyed rate limits (S2)
- Location-ping batching through Redis (P4)

### Quarter 2 — architectural

- Multi-node deployment: nginx upstream pool, PgBouncer, S3, shared Redis
- Dispatch SLA engine with auto-escalation
- Responder ranking and reputation
- Two-way victim ↔ responder messaging
- Bangla localisation and an accessibility pass on the SOS flow
- Documented, *tested* disaster recovery with stated RPO/RTO

---

## 10. Closing assessment

The instinct behind this codebase is right. Someone thought carefully about
authenticating WebSocket handshakes, about failing closed on unverified
webhooks, about not putting a JWT in an SMS, about PostGIS geometry columns
with sync triggers. Those are not beginner decisions.

What's missing is the follow-through: the geometry columns were created and
then never queried, the queue was built and then bypassed, Redis was deployed
and then left idle, Sentry was configured in `env.ts` and never initialised.
The gap between *designed for scale* and *running at scale* is almost entirely
made up of items like these — and each one is a small, contained change.

Two things deserve emphasis above everything else in this report:

1. **Fix the spatial queries (P1) and get the responder fan-out off the SOS
   request path (P2).** Together they are perhaps two days of work and they
   address the slowest path in a system whose entire purpose is speed under
   panic.

2. **Instrument the system.** Every number in §1 is an estimate derived from
   reading code. Until you have `sos_dispatch_duration_seconds` on a dashboard
   with an alert attached to it, you will not know whether a change helped, and
   you will not know when it breaks.

Everything else in this report can follow.

---

*Prepared from a static review of the repository at `D:\Productions\nari-surokkha`
on 19 August 2026. Capacity figures are code-derived estimates and should be
replaced with load-test measurements.*
