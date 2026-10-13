# Nari Surokkha: Production Readiness Review

**Date:** 17 September 2026
**Branch reviewed:** `fix/critical-perf-2026-08` (HEAD `740207e`) plus the **uncommitted** working tree
**Earlier reviews:** `PERFORMANCE_SCALABILITY_RATING_v4.md` (19 Aug, 8.6/10)

---

## 1. Verdict

**Not ready for production yet.** Most of the performance and scalability work is
done and good. What still blocks launch is **security** and **release process**:

- One admin can give themselves more power than they were given (privilege escalation).
- The login rate limit can be bypassed with a fake header.
- Anyone can register any phone number without proving they own it. Together
  with the SOS SMS flow, that lets someone send paid SMS to any number.
- The TURN relay password is handed to every logged-in user.
- 27 commits are not merged into `main`, and 112 files are changed but not committed.

**Overall rating: 7.2 / 10.** It was 8.6 in the 19 Aug review. The code did not get
worse. The drop is because this review looked at security and release process,
and the August review did not cover them.

---

## 2. Scorecard

| Area | Aug v4 | **Now** | Why |
|---|:--:|:--:|---|
| API performance | 9.0 | **8.5** | Route-deviation alert storm; one DB lookup per socket location message; Expo push has no batching or timeout |
| Scalability | 9.0 | **8.5** | Design supports multiple hosts, but load tests have never run on real infrastructure |
| Database design | 9.5 | **9.0** | Solid. No point-in-time recovery; no partitioning |
| Architecture & code quality | 8.5 | **7.5** | Admin module takes untyped input (`data: any`, no body schemas); many `as any` route casts; ML service still unused |
| **Security** | 8.5 | **6.0** | See §3, blockers B1–B6 |
| Reliability | 8.0 | **7.0** | Node 20 is past end of life; restore test not scheduled; RPO is 24h |
| Observability | 8.0 | **7.5** | Stack is built but has never watched production traffic |
| Data protection | 7.5 | **7.0** | Public, non-expiring evidence URLs when storage is `local`; database volume not encrypted |
| Web portals | 7.5 | **7.0** | Access token stored in localStorage; no tests; no data-fetching cache layer |
| Mobile | 7.5 | **6.5** | Google Play restricted permissions (SMS, background location, exact alarm); no tests; large amount of uncommitted work |
| Testing & CI | 8.5 | **7.5** | CI gates are good, but the new e2e and integration tests are uncommitted and have never run in CI |
| **Release hygiene** | — | **4.0** | New row: unmerged branch, uncommitted work, `.npmrc` not tracked |
| **Overall** | 8.6 | **7.2** | |

---

## 3. Must fix before production (blockers)

### B1. Admins can escalate their own privileges (High)
`services/api/src/modules/admin/admin.repository.ts:115` writes `data.permissions`
straight to the user record. The controller only checks `manage_admins` when
`body.role === 'admin'`. An admin who has only `manage_users` can send:

```
PUT /api/v1/admin/users/<own-id>
{ "permissions": ["manage_admins", "manage_stations", "view_audit_logs"] }
```

That admin now has every permission. The same request also lets them edit or
demote other admins, and `superadmin` is never guarded at all.

**Fix:**
- Require `manage_admins` whenever `permissions` is present, or when the target user is already an admin or superadmin.
- Block users from changing their own permissions.
- Add JSON body schemas for `/admin/*` with `additionalProperties: false`.

### B2. Default password for users an admin creates (High)
`admin.repository.ts:40`: `argon2.hash(data.password || 'default123!')`.
If an admin creates a user without a password, that account gets a password
that is public in the source code.

**Fix:** require a password in the schema, or generate a random one-time password
and force a reset on first login.

### B3. Login rate limit can be bypassed with a spoofed header (High)
`plugins/rate-limit.ts:58` uses the **first** `X-Forwarded-For` value as the
client IP. nginx uses `$proxy_add_x_forwarded_for`, which *appends* the real IP
to whatever the client sent, so the first value is chosen by the client. An
attacker who sends a new random `X-Forwarded-For` on each request gets a fresh
rate-limit bucket every time. This affects login, register, and the webhook.

**Fix:** set `trustProxy` in Fastify (to nginx's address, or to `1` hop) and use
`request.ip`. Alternatively, have nginx set `X-Real-IP $remote_addr` and read
only that header.

### B4. No phone verification, so the SMS flow can be abused (High: cost and harassment)
- `/auth/register` has no OTP step and no route-specific rate limit.
- `contacts.service.ts:114`: users can mark their *own* trusted contacts as
  "verified". The contact never confirms anything.
- The SOS limit is 5 per minute per user, with 5 contacts each. That is 25 SMS
  per minute per account, and the number of accounts is unlimited (see B3).

Result: anyone can make the platform send paid "EMERGENCY" SMS to any phone
number (SMS pumping or harassment). Someone can also register a victim's phone
number before the victim does.

**Fix:**
- Verify the phone with an OTP at registration.
- Verify contacts by sending the contact a confirmation SMS or link.
- Add an SMS quota per account and per day.
- Add stricter rate limits to register and SOS routes.
- Add alerting on SMS spend.

### B5. TURN server is open to any logged-in user (High)
- `GET /config/ice-servers` (`config.routes.ts:60`) gives every logged-in user the
  **static** coturn password.
- coturn runs with `network_mode: host` and no `--denied-peer-ip` rules. Anyone
  with the password can use the server as a relay: they can proxy traffic
  through the VPS and reach private or internal addresses on the host network.

**Fix:**
- Switch to `--use-auth-secret` / `--static-auth-secret` and issue short-lived HMAC credentials per user.
- Add `--denied-peer-ip` for 0.0.0.0/8, 10/8, 127/8, 169.254/16, 172.16/12 and 192.168/16.
- Add `--no-multicast-peers`.

### B6. Public evidence URLs that never expire (High when `STORAGE_PROVIDER=local`)
`evidence.routes.ts:118`: `GET /api/v1/evidence/mock-s3/*` has **no
authentication**, and it is registered in every environment. The `?expires=`
query parameter is added to the URL but **never checked**, and there is no
signature. Anyone who has one of these links can download the recording
forever. Links leak through logs, browser history and forwarded messages.

The URL host is also built from the request's `Host` header, so an attacker can
influence it (host-header injection).

**Fix:**
- Register this route only when `NODE_ENV !== 'production'`, or require HMAC-signed URLs with an expiry check.
- Confirm production uses R2 or S3.
- Build URLs from `API_BASE_URL` only.

### B7. Release process (Blocker)
- 27 commits on `fix/critical-perf-2026-08` are **not merged** into `main`.
  `deploy.yml` deploys `main`, so none of the August work is live.
- 112 files are uncommitted, including API changes (ICE servers, SMS template,
  Expo push, Firebase credentials, seed guard) and the whole new mobile audio-ML
  and direct-SMS feature. One lost disk means all of that is lost.
- `.npmrc` (`legacy-peer-deps=true`) is **untracked**, so a fresh clone on the VPS
  or in CI may fail `npm install`.

**Fix:** commit in logical pieces, push, open a PR, get CI green, then merge.

### B8. Runtime and image (Medium, but do it before launch)
- `services/api/Dockerfile` uses `node:20-alpine`. **Node 20 reached end of life
  in April 2026** and no longer gets security patches. Move to `node:22-alpine`
  or `node:24-alpine`.
- The image runs as **root**. Add `USER node`.
- The image uses `npm install`, not `npm ci`, and ships devDependencies. Use
  `npm ci --omit=dev` in the final stage.

---

## 4. Should fix (before or right after launch)

| # | Issue | Where | Fix |
|---|---|---|---|
| S1 | **Route-deviation alert storm.** Once a user is off the route, every 10-second ping creates a *new* soft alert and a DB write, because the cached route never sees `status='deviated'`. | `alerts.service.ts:795-820` | Create at most one alert per route (Redis `SET NX` flag or status check). Re-arm only after the user is back on the route. |
| S2 | Socket `alert:location_update_from_client` runs one DB query per message (`ownsAlert`). Lat/lng are not validated and the event has no rate limit. | `plugins/websocket.ts` | Cache ownership per socket and alert; validate coordinates; throttle. |
| S3 | Socket authorization is too broad: any `police`, `admin` or `dispatch` user can join **any** user room and any alert room, across stations. `superadmin` is not treated as privileged. | `websocket.ts:30` | Scope police to alerts in their own station; audit-log joins to rooms. |
| S4 | Sockets never re-check token expiry or revocation after connecting, so a revoked officer keeps receiving live data. | `websocket.ts` | Check the token version on connect; disconnect on revocation (pub/sub) or re-validate every N minutes. |
| S5 | Expo push sends one HTTP call per token, has no timeout, no Expo access token, and never checks receipts, so invalid tokens are never removed. | `firebase-push.provider.ts:41` | Batch up to 100 per request; use an `AbortController` timeout; process receipts and delete tokens that return `DeviceNotRegistered`. |
| S6 | Safe Route defaults to the **public OSRM demo** (`router.project-osrm.org`). Its usage policy forbids production traffic, and it only supports car routing. | `env.ts:153` | Run the self-hosted `osrm` profile and set `OSRM_URL=http://osrm:5000`. |
| S7 | The dev `docker-compose.yml` publishes Postgres 5432, Redis 6379 and OSRM 5000 on all network interfaces. | `docker-compose.yml` | Never use it on a VPS, or bind to `127.0.0.1`. |
| S8 | Portals store the access token in `localStorage` (zustand `persist`), so any XSS can steal it. | `*/store/authStore.ts` | Keep the token in memory only; refresh from the httpOnly cookie on page load. |
| S9 | The cookie-signing secret is the same as `JWT_SECRET`. JWTs are verified without an `algorithms` list. | `app.ts`, `auth.service.ts` | Use a separate `COOKIE_SECRET`; pass `algorithms: ['HS256']`. |
| S10 | `/ml/samples` accepts any JSON from any user, with no schema, size or rate limit. This risks storage abuse and poisoned training data. | `ml.routes.ts` | Add a schema, size cap, per-user quota and label review. |
| S11 | The admin SMS-template `{name}` placeholder is filled from the user's own profile name, so a user can put a phishing link inside the "EMERGENCY" SMS. | `settings.types.ts` | Strip URLs and control characters from the name; cap its length. |
| S12 | Plain `throw new Error(...)` for user-input problems returns 500 instead of 400/404. Examples: `getSafeRoute`, `updateUser` "User not found". `/safe-route/:id/location` has no schema. | alerts, admin | Use typed errors and add schemas. |
| S13 | ML service is still unused. The API never calls `ML_SERVICE_URL`, yet the prod compose file *requires* `ML_SERVICE_API_KEY`. | `docker-compose.prod.yml:233` | Remove it from prod or connect it. |

---

## 5. Mobile: Google Play risks

`app.json` requests `SEND_SMS`, `ACCESS_BACKGROUND_LOCATION`, `USE_EXACT_ALARM`,
`RECORD_AUDIO` and `CAMERA`.

- **SEND_SMS** is a restricted permission. Play requires a Permissions
  Declaration, and a personal-safety app can qualify, but you must apply.
  Without an approved declaration the app is rejected.
- **ACCESS_BACKGROUND_LOCATION** needs its own declaration and a demo video.
- **USE_EXACT_ALARM** is only allowed for alarm and calendar apps and is likely
  to be rejected. Use `SCHEDULE_EXACT_ALARM` only, or drop it.
- On Android 14+, check that `FOREGROUND_SERVICE_LOCATION` and
  `FOREGROUND_SERVICE_MICROPHONE` are declared with the matching service types.
- `google-services.json` is committed. That is normal, but restrict the API key
  in Google Cloud Console.
- The mobile app has no automated tests. Test SOS, offline SMS and audio
  detection by hand on real devices: low-end Android, and battery-saver mode.

---

## 6. What is already good (do not redo)

- PostGIS index usage, checked with EXPLAIN in CI.
- SOS fan-out runs through a queue; notifications are idempotent.
- Redis-buffered location writes.
- Separate worker process, PgBouncer, and read-replica support.
- Refresh-token reuse detection; token-version revocation for HTTP requests.
- Per-account login backoff; argon2id with a timing-safe dummy hash.
- SameSite=strict cookies plus an Origin check.
- Twilio webhook signature check that rejects requests when not configured.
- Evidence streaming, encryption at rest, retention purge and erasure.
- Observability stack (Prometheus, Grafana, Alertmanager, Sentry).
- Production seed now skips demo accounts unless `ALLOW_DEV_SEED=true`.
- Env validation forbids a wildcard WebSocket CORS origin in production.

---

## 7. Launch checklist (in order)

1. **Commit and merge:** commit the working tree, track `.npmrc`, open a PR from `fix/critical-perf-2026-08`, get CI green, merge to `main`.
2. **Security fixes:** B1–B6, then S1 and S8.
3. **Runtime:** move the Dockerfile to Node 22/24, run as a non-root user, use `npm ci --omit=dev`.
4. **Staging deploy:** `$COMPOSE build`, then `migrate deploy` (**never** `db push`), then `up -d`.
5. **Load test on staging** with `SMS_PROVIDER=mock`: `k6 run load/sos-spike.js`, `location-soak.js` and `ws-fanout.js`. Record p95 latency and error rates.
6. **Production secrets:**
   - Rotate the admin password and disable seed or test accounts (`Test@1234`).
   - Set a unique `JWT_SECRET`, `JWT_REFRESH_SECRET` and `COOKIE_SECRET`.
   - Set the TURN auth secret.
   - Set R2/S3 storage, not `local`.
   - Set `OSRM_URL` to the self-hosted service.
7. **Data safety:** enable WAL archiving or point-in-time recovery (for example pgBackRest or wal-g), and schedule `restore-test.sh` weekly.
8. **Firewall:** allow only 80, 443, 3478 and the TURN relay range 49152–49200. Keep Grafana and Prometheus reachable only through an SSH tunnel.
9. **Monitoring:** set Alertmanager to page on API 5xx rate, queue backlog, SMS failures and SMS spend.
10. **Play Store:** submit the SMS and background-location declarations before uploading the release build.

---

## 8. How this review was done

- Read the API source (auth, admin, RBAC, alerts, WebSocket, evidence, storage,
  rate limit, config, settings, push), the Docker and compose files, the nginx
  templates, CI, the portal auth and socket code, and the mobile manifest.
- Reviewed every uncommitted API change.
- **Type-check:** `tsc --noEmit` on the API gives 5 errors, all
  `Cannot find module '@nari-surokkha/shared'`. That is a workspace-link problem
  in the review environment, not a code bug. There are no other type errors.
- **Unit tests could not run here:** `node_modules` was installed on Windows and
  has no Linux rollup binary. Before merging, run on your machine:
  `npm install` → `services/api`: `npx prisma generate && npm run type-check && npm run test:coverage`.
- Load tests were not run. No real infrastructure was available.
