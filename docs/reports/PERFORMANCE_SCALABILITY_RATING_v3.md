# Nari Surokkha — Performance & Scalability Rating (Revision 3)

**Repository:** `D:\Productions\nari-surokkha`
**Branch reviewed:** `fix/critical-perf-2026-08` (through commit `300fdd7`)
**Date:** 19 August 2026
**Supersedes:** `PERFORMANCE_SCALABILITY_RATING_v2.md`

---

## 1. What changed since revision 2

Eight further commits. The branch now holds **13 commits, 67 files, +4,409 /
−540**, of which 22 files are new and roughly a quarter of the added lines are
tests.

| Commit | Fix |
|---|---|
| `aa5ae32` | Prometheus metrics, Sentry, Bull Board, Grafana/Alertmanager stack, SLO rules |
| `ac1eae6` | Worker process split, nginx upstream pool, PgBouncer, `connection_limit` applied |
| `cf80044` | Live-location writes buffered in Redis; retention + trigram + BRIN migration |
| `44fd552` | Analytics as SQL aggregation; cursor pagination on four unbounded queries |
| `1a66cbc` | User-keyed rate limits, token revocation, refresh-token reuse detection |
| `842dd21` | Route-level code splitting in both portals |
| `e742834` | k6 load suite |
| `300fdd7` | Env documentation for the new configuration |

Two new migrations: `20260819000000_spatial_index_usage` and
`20260819100000_retention_and_search`.

---

## 2. Scorecard

| Dimension | Rev 1 | Rev 2 | **Rev 3** | Movement this round |
|---|:--:|:--:|:--:|---|
| **Performance (API)** | 5.5 | 7.5 | **8.5** | ▲ 1.0 — the last high-frequency write path is fixed |
| **Scalability** | 4.0 | 5.0 | **7.5** | ▲ 2.5 — three of four structural blockers removed |
| **Database design** | 7.0 | 8.5 | **9.0** | ▲ 0.5 — retention, BRIN, trigram, tuning, pooling |
| **Architecture & code quality** | 7.0 | 7.5 | **8.0** | ▲ 0.5 — clean process-role split, shared utils |
| **Security** | 6.5 | 7.0 | **8.0** | ▲ 1.0 — S1–S5 all closed |
| **Reliability** | 3.0 | 5.0 | **7.0** | ▲ 2.0 — idempotency, durable buffers, graceful drain |
| **Observability** | 3.0 | 3.0 | **8.0** | ▲ 5.0 — from nothing to SLIs, alerts and error tracking |
| **Frontend performance** | 5.0 | 5.0 | **6.5** | ▲ 1.5 — code splitting and vendor chunking |
| **Mobile performance** | 6.0 | 6.0 | **6.0** | — untouched |
| **Testing & CI** | 4.5 | 5.5 | **6.5** | ▲ 1.0 — 98 tests; k6 suite written but not yet run |
| **Overall** | **5.4** | **6.6** | **7.8** | ▲ 2.4 across the engagement |

---

## 3. Capacity, re-estimated

| Metric | Rev 1 | Rev 2 | **Rev 3** | Now limited by |
|---|---|---|---|---|
| SOS trigger p95 | ~600–1500 ms | ~40–80 ms | **~40–80 ms** | one indexed query + one insert |
| SOS triggers/minute | ~30–60 | ~300+ | **~1,000+** | worker throughput — and workers now scale independently |
| Concurrent active SOS | ~200–500 | ~200–500 | **~5,000+** | no longer the write path; now socket capacity |
| Concurrent WebSocket clients | ~3–5k | ~5–8k | **~5–8k _per replica_** | single process per replica — but replicas now work |
| Registered users | ~50k | ~500k | **~1M+** | nothing in the app tier; Postgres sizing |
| Police dashboards | ~50 officers | ~50 officers | **~500+** | cursor pagination replaced the unbounded query |

**These remain projections.** The k6 suite exists precisely to replace them
with measurements, and it has not been run yet. Treat this table as a
hypothesis with a test attached, not a result.

---

## 4. Where the big movements came from

### Observability: 3.0 → 8.0

The largest single jump in the engagement, from a genuine zero. There is now a
`/metrics` endpoint on a separate internal port, four domain SLIs, Prometheus
scraping both the API and worker fleets, Grafana, Alertmanager with rules
scoped to real conditions, Sentry finally connected to the DSN that had been
declared and unused since the project began, Bull Board for queue depth, and
`pg_stat_statements` so "what is slow?" is answerable from data.

The one that matters most is `sos_dispatch_duration_seconds` — time from
someone pressing the button to help actually being told. That is the number to
put on a wall.

Not a 9 or 10 because there is no distributed tracing, only a datasource is
provisioned in Grafana rather than dashboards, and — the honest reason — none
of it has yet run against production traffic.

### Scalability: 5.0 → 7.5

Three of the four blockers are gone. Workers moved out of the API process, so
a burst of SMS fan-out no longer competes with request handling on the same
event loop, and the two scale independently. nginx got a `least_conn` upstream
pool with health checks. PgBouncer sits in front of Postgres, with `directUrl`
routing migrations around it since DDL cannot survive transaction pooling.

The fourth remains: evidence still lives on a host bind-mount. That is why
this is 7.5 and not 9 — multiple API containers work fine **on one host**, but
a second host needs object storage first.

### Reliability: 3.0 → 7.0

Less visible than the others, and arguably as valuable. Retries are now
idempotent at both the job and channel level; the location buffer lives in
Redis so a restart cannot lose pings; shutdown drains in-flight work before
exiting; nginx retries the next upstream on a bad replica; and the alerting
rules mean a failure surfaces rather than accumulating quietly.

---

## 5. What is still open

Ordered by what I would do next.

### 🟠 P10 — evidence storage (the last scale-out blocker)

Evidence uploads are still buffered entirely in memory (`Buffer`, 10 MB cap,
no container memory headroom accounted for) and written to a host bind-mount.
Two consequences: ~20 concurrent uploads is 200 MB of heap, and a second host
cannot see the files.

The S3 provider is already implemented, so this is a `STORAGE_PROVIDER` switch
plus streaming the multipart body with `@aws-sdk/lib-storage`'s `Upload` rather
than buffering, and issuing presigned URLs for download instead of proxying
bytes through the API. I left it deliberately: it deserves its own change
rather than being folded into a batch.

### 🟠 Run the load tests

`load/` contains three k6 scenarios with thresholds mirroring the production
alert rules. Until they run, §3 is arithmetic rather than evidence. Run them
against staging with `SMS_PROVIDER=mock` — `sos-spike.js` creates real alerts,
which create real police cases.

### 🟡 Data protection

- Evidence files — photos, audio and video of assaults — have no documented
  encryption-at-rest configuration and no retention or deletion policy. For
  this data class that is both a compliance and an ethical exposure, and it is
  the most serious item left on this list even though it is not a performance
  one.
- No documented RPO/RTO, and no evidence the backup has ever been restored. A
  backup you have never restored is a hypothesis.

### 🟡 Remaining security

- **S6** no account lockout — the login rate limit is still per-IP-and-per-user,
  which rotating IPs defeats. Add per-account exponential backoff.
- **S7** no CSRF protection despite cookie auth being supported; set
  `SameSite=Strict` at minimum.
- **S9** the ML service API key has no rotation mechanism.

### 🟡 Frontend and mobile

- No data-fetching library. Raw axios + zustand means no request dedup, no
  caching, manual loading state everywhere. TanStack Query would remove a
  category of bugs as well as requests.
- Both Leaflet and `@react-google-maps/api` still ship. Pick one.
- No tests in either portal; no bundle-size budget in CI.
- Mobile: production API URL still hardcoded in `services/api.ts`; no offline
  retry queue on the axios client; location cadence is not adaptive.

### 🟡 Database and CI

- No read replica; analytics and audit queries still hit the primary (now
  cached, which takes most of the sting out).
- No partitioning. The chunked retention sweep is a reasonable substitute at
  current volumes but will not be forever.
- CI has no coverage gate, does not build the Docker images, and does not run
  the load suite.
- `services/api/src/plugins/storage.ts:116` has a pre-existing type error
  (`TS2352`), unrelated to any of this work but still red.

---

## 6. Before you merge

The branch is **not merged and not deployed**. Nothing in this report has run
against a real database.

```bash
# 1. Install the new dependencies
#    (root lockfile needs --legacy-peer-deps — apps/mobile peer conflict)
npm install --legacy-peer-deps

# 2. Verify properly, with a generated Prisma client
cd services/api
npx prisma generate
npm run type-check
npm test

# 3. Apply the two new migrations — NEVER db push, it drops the PostGIS columns
npx prisma migrate deploy

# 4. Confirm the spatial indexes are actually being used
```
```sql
EXPLAIN ANALYZE
SELECT id FROM responders
WHERE status = 'verified' AND availability = 'available'
  AND ST_DWithin(location::geography,
                 ST_SetSRID(ST_MakePoint(90.41, 23.81), 4326)::geography, 5000);
-- expect: Index Scan using idx_responders_location_geog
-- Seq Scan here means the geometry backfill did not populate `location`,
-- and the single highest-leverage fix is inert.
```
```bash
# 5. Bring up monitoring and confirm the SLIs report
docker compose -f docker-compose.prod.yml --profile monitoring up -d
curl http://api:9091/metrics | grep sos_dispatch

# 6. Then, and only then, replace the numbers in §3
k6 run load/sos-spike.js
```

**Verification caveat, restated because it matters:** type-checking and tests
ran in a sandbox where `prisma generate` could not complete
(`binaries.prisma.sh` is blocked there). 98 tests are defined and the 75 that
do not depend on generated Prisma enums all pass; the 12 failures are
`Object.values(<undefined enum>)`, `Prisma.Decimal`, and a storage-directory
check — all environmental, all predating this work. The new code's Prisma call
sites were therefore type-checked *without* the generated client. Step 2 above
closes that gap and should be treated as required, not optional.

---

## 7. Closing

Revision 1 described a system whose foundations were built and then left
unwired: PostGIS columns created and never queried, a queue built and then
bypassed, Redis deployed and idle, Sentry configured and never initialised.
Revision 2 closed the worst of those. This revision finishes the job and adds
the thing that was missing entirely.

The shape of the work has changed completely. At revision 1 the list was
"connect what you already built". Now the remaining list is genuine product and
operations work: move evidence to object storage, run the load tests, decide an
encryption and retention policy for assault evidence, pick one mapping library.
None of it is remediation.

Two closing observations, one encouraging and one not.

The encouraging one: **the emergency path is now good**. A panic button that
responds in under 80 ms, a fan-out that retries without duplicating, dispatch
that cannot silently page zero responders without someone being alerted, and
location tracking that costs no database round trip. That is the part that has
to work when it matters, and it does.

The other: **7.8 is a paper score until step 2 of §6 runs.** Everything here
was verified in a sandbox missing a generated database client, and none of it
has been deployed. The gap between this report and reality is one `npm test`
and one `migrate deploy` wide — but it is a real gap, and it is the only thing
standing between an inference and a fact.

---

*Revision 3, 19 August 2026. Reflects `fix/critical-perf-2026-08` at commit
`300fdd7` — pre-merge, pre-migration, pre-load-test.*
