# Nari Surokkha — System Health Report

**Date:** 18 July 2026
**Scope:** Full-stack audit — API, mobile app, admin + police portals, ML, infra.
**Context:** System is **live in production** (Docker on VPS, `mystrix-soft.com`),
with real end-to-end SOS→dispatch verified during deployment.

---

## Overall verdict

**Production-ready core, functional pilot. Grade: B+ (8/10).**

The emergency-response backbone is genuinely working and deployed: a real SOS
travels from phone → server → PostGIS nearest-station lookup → live police/admin
dispatch → SMS to family, verified on real infrastructure. The gaps are at the
"smart" edges (audio AI, route optimization) and in operational hardening, not in
the core life-safety path.

---

## Ratings by area

| Area | Rating | Notes |
|---|---|---|
| Core SOS pipeline | 9.5/10 | Real, deployed, verified live end-to-end |
| Real-time dispatch (WebSocket) | 9/10 | Confirmed working across networks in prod |
| Live streaming (WebRTC) | 8/10 | Works; TURN relay just added for cross-network |
| Outbound SMS (BulkSMSBD) | 9/10 | Configured & live; primary alert channel |
| Offline SIM fallback | 8/10 | Implemented; one-tap (OS limitation, not a bug) |
| On-device motion ML (fall/struggle) | 7.5/10 | Real trained model, on-device |
| Backend architecture & security | 8.5/10 | argon2, JWT, RBAC, rate limit, encrypted keys |
| Admin + Police portals | 8.5/10 | Bilingual, gov-themed, real data, deployed |
| Mobile app UX | 8/10 | Themed, splash, drawer, real GPS |
| Push notifications | 3/10 | Firebase not configured → mock mode |
| Server-side ML (audio/route) | 2/10 | Mocked (random values) |
| Audio distress detection (device) | 3/10 | Simulated; real TFLite is a TODO |
| Build/release hygiene | 6/10 | API/portals fixed; APK blocked on lockfile |
| Automated testing | 4/10 | 11 unit tests, no E2E/integration in CI |

---

## Feature status — what works, what doesn't

### ✅ Fully working (real & verified)

- **User auth** — register/login, JWT access+refresh, argon2id hashing, RBAC.
- **SOS trigger → nearest police station** — live PostGIS geospatial query.
- **Alert → BullMQ queue → worker** — real Redis-backed job processing.
- **Real-time dispatch** — `alert:created` pushed to station + dispatch rooms;
  admin/police dashboards update live (verified in production today).
- **Live location tracking** — phone streams real GPS → portal map (fallback
  Baridhara default removed; now true high-accuracy GPS on all platforms).
- **WebRTC live audio/video** — real peer connection + signaling relay; **TURN
  server** added so it works phone-cellular ↔ police-network (CGNAT).
- **Outbound SMS to trusted contacts** — BulkSMSBD configured & live; sends to
  **every** contact (app or not), rebuilt per-job from encrypted admin config.
- **Offline SOS via SIM** — no-data path opens native Messages prefilled with
  contacts + maps link; sends over cellular. (999 disabled for pilot.)
- **Auto case creation** from alert; **5 km responder dispatch** (PostGIS radius).
- **Soft-alert auto-escalation** worker.
- **On-device motion ML** — real trained model (`motion_model.json`, 6-axis,
  fall/struggle classes) running on accelerometer/gyro, with OTA model updates.
- **Admin portal** — users, roles/RBAC, responders, police stations, incidents,
  analytics, audit logs, ML model registry, SMS settings. Bilingual bn/en,
  government-themed.
- **Police portal** — live alert queue, cases, case timeline, incidents. Bilingual.
- **Mobile app** — SOS, trusted contacts, profile, fake call, safety map, report
  incident, safe route, silent alert; animated splash; gov+feminine themed.
- **Evidence storage** — local disk (works; bind-mounted for backup).
- **Deployment** — full Docker stack live: Postgres+PostGIS, Redis, API, ML,
  both portals, nginx, TLS, and coturn.

### ⚠️ Config-gated (works once credentials added)

- **Push notifications** — real `FirebasePushProvider` exists but only activates
  when `FIREBASE_PROJECT_ID` is set. Currently **mock mode** (10% random "fail").
  → Add `FIREBASE_*` to `.env.production` to enable. Until then, alerts reach
  contacts via SMS + WebSocket only, not push.
- **S3 evidence storage** — real S3 path exists; defaults to local disk without
  `AWS_S3_BUCKET`. Local is fine for pilot; add S3 for scale/redundancy.

### ❌ Mocked / not real yet

- **Server ML service** (`ml-service`) — `/audio-distress`, `/motion`,
  `/safe-route` all return `random.uniform(...)`. Only `/safe-route` is consumed
  by the backend, so **safe-route suggestions are not real** — geometric mock.
- **Audio distress detection (device)** — `AudioProcessor` records real audio but
  inference is `Math.random() > 0.95`; real `.tflite` model is a `TODO`. So the
  "listen for screams / trigger words" feature does not actually detect anything.
- **ML tuning page** (admin) — sliders don't yet persist to a real ML config.

---

## Security posture — 8.5/10

**Strong:** argon2id with constant-time dummy-verify, JWT auth + RBAC,
per-route rate limiting, CORS/WS origin allow-lists (wildcards rejected in prod),
Twilio webhook signature verification, SMS provider keys encrypted at rest,
API bound to localhost behind nginx, TLS on all subdomains.

**To address before public launch:**
1. **Seeded test accounts use public passwords** (`Test@1234` is in the repo) —
   change the admin password and disable/remove test citizen/responder/police
   accounts. (Dev login prefill already blanked.)
2. **TURN credential is embedded in clients** — extractable from the APK; risk is
   bandwidth freeloading, not data. Fine for pilot; move to short-lived HMAC
   credentials at scale.
3. **No account lockout/OTP** on registration — consider phone OTP verification
   to prevent fake accounts before wide release.

---

## Build / release health — 6/10

- **API** — was broken (unresolved `@/` path aliases, `type:module` mismatch,
  undeclared `@sinclair/typebox`, drifted migrations); all fixed and building
  clean in Docker.
- **Migrations** — three parity migrations added (`roles_and_rbac`,
  `native_enums`, `schema_parity`) to close long-standing schema↔migration drift.
- **Portals** — build clean (strict unused-var lint relaxed); admin toolchain
  aligned to police (Vite 8).
- **Mobile APK** — **currently blocked**: EAS `npm ci` fails because
  `package-lock.json` is out of sync (needs `npm install --legacy-peer-deps` +
  commit; worklets peer conflict fixed, `.npmrc` added).
- **~52 local changes not yet pushed** — commit & push so prod/CI/EAS match repo.

---

## Testing — 4/10

11 unit test files (services, controllers). **No integration or E2E tests in CI**,
and no automated test of the critical SOS→dispatch→SMS path. For a life-safety
system this is the biggest process gap: add at least one integration test that
triggers an SOS and asserts the alert, case, queue job, and SMS log are created.

---

## Priority recommendations

1. **Unblock the APK** — sync lockfile, push, rebuild (immediate).
2. **Secure the pilot** — change admin password, disable test accounts.
3. **Enable push** — add `FIREBASE_*` credentials (recommended for a safety app).
4. **Decide the ML story** — either integrate real audio/route models, or clearly
   label those features "beta / not active" in the UI so no one relies on them in
   an emergency. Do not present mock safety scores as real.
5. **Add one E2E test** of the SOS pipeline and wire CI green.
6. **Offsite backups** — nightly `pg_dump` + evidence folder to remote storage.

---

*Assessed by direct source scan across `services/api`, `services/ml-service`,
`apps/mobile`, `apps/admin-portal`, `apps/police-portal`, plus live production
verification during this deployment.*
