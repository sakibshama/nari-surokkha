# Nari Surokkha — System Health Report

**Date:** 17 July 2026
**Scope:** Full monorepo audit (`apps/`, `services/`, `packages/`) — feature functionality, mock/stub inventory, and build health.

---

## 1. Executive Summary

The **backend emergency-response core is genuinely functional** — real database writes, geospatial queries, job queue, WebSocket dispatch, and WebRTC signaling all exist and are wired end to end. The system is not a hollow prototype.

However, several **safety-critical outer edges are mocked or missing**, and the codebase does not currently type-check or lint cleanly. Two findings matter most for a life-safety product:

1. **Outbound SMS to trusted contacts is not implemented at all.** There is config for it and a comment claiming it happens, but no code sends it. On a phone without the app installed and no data connection, a trusted contact would receive nothing.
2. **The entire ML service is mocked** — distress-audio, fall/struggle motion, and safe-route detection all return random or geometric placeholder values.

Overall status: **functional skeleton, mocked extremities, failing build hygiene.**

---

## 2. Feature Status Matrix

| Feature | Status | Notes |
|---|---|---|
| User auth (register/login, JWT, argon2, timing-safe compare) | ✅ Functional | Real crypto, dummy-hash timing defense in `auth.service.ts` |
| SOS trigger → nearest police station (PostGIS) | ✅ Functional | Real geospatial query, DB write, audit log |
| Alert → BullMQ job queue → worker | ✅ Functional | Real Redis-backed queue and worker |
| Real-time police dispatch (WebSocket) | ✅ Functional | `alert:created` emitted to station + dispatch rooms |
| Live location tracking (mobile → server → portal) | ✅ Functional | Socket.IO `alert:location_update` relay |
| WebRTC live audio/video signaling | ✅ Functional | Real `RTCPeerConnection` in mobile + relay in `websocket.ts` |
| Auto-create police case from alert | ✅ Functional | `casesService.createCaseFromAlert` |
| Nearby responder dispatch (5 km) | ✅ Functional | Real PostGIS radius query |
| Soft-alert auto-escalation | ✅ Functional | Real `escalations` worker |
| Inbound SMS SOS (offline, via Twilio webhook) | ⚠️ Functional but unconfigured | Real handler + signature verification; needs Twilio credentials |
| Push notifications | ⚠️ Config-gated | Real `FirebasePushProvider` **only if** `FIREBASE_PROJECT_ID` set; else `MockPushProvider` |
| Evidence file storage | ⚠️ Config-gated | Real S3 **only if** `AWS_S3_BUCKET` set; else mock local-disk `/mock-s3/` |
| Police & Admin portals data | ✅ Functional | Real API calls (`api.get/post`, React Query) |
| Mobile app API layer | ✅ Functional | Real axios client with token interceptor |
| **Outbound SMS to trusted contacts** | ❌ **Missing** | No provider implemented; notifications send push only |
| **ML: audio distress detection** | ❌ Mocked | `random.uniform(0.1, 0.9)` in `ml-service/main.py` |
| **ML: motion / fall / struggle** | ❌ Mocked | `random.uniform(0.05, 0.95)` |
| **ML: safe-route** | ❌ Mocked | Geometric midpoint + hardcoded `safety_score_avg: 85.5` |
| Mobile background sensor monitoring | ❌ Stubbed | `SensorsManager` only `console.log`s; never sends data |
| Live streaming UI (`StreamingView`) | ❌ Placeholder | Static "LIVE BROADCASTING" panel (real WebRTC is elsewhere in `ActiveSosScreen`) |
| Admin ML-tuning page | ❌ Mocked | "Mock save logic, no actual database for ML settings" |

---

## 3. What Is Genuinely Functional

The request→dispatch pipeline is real and reasonably well-architected:

When a user triggers `triggerManualSos`, the API performs a live PostGIS lookup for the nearest station, writes the alert and an audit log to Postgres via Prisma, enqueues a BullMQ notification job, emits a WebSocket event to the matched station and the global dispatch room, auto-creates a police case, and queries responders within a 5 km radius. Separately, the mobile client opens a real WebRTC peer connection and relays SDP/ICE through the Socket.IO signaling channel. Both web portals and the mobile app talk to the real backend — there is no fake data layer sitting in front of them.

Security hygiene in the backend is above average for a prototype: argon2 password hashing with a constant-time dummy-verify path, JWT auth middleware, RBAC, rate limiting, Twilio webhook signature verification, and CORS/WS origin allow-lists that explicitly reject wildcards in production.

---

## 4. What Is Mocked or Missing (and why it matters)

**Outbound SMS — the most serious gap.** `env.ts` defines `SMS_PROVIDER` with options `mock | sslcommerz | bdbulksms | twilio`, and `alerts.service.ts` comments that "the worker will find the trusted contacts and send SMS/Push." In reality `notifications.service.ts` only ever calls `pushProvider.sendPush`, and only for contacts who are *themselves registered app users with an active device token*. A trusted contact who does not have the app receives nothing. For a women's-safety product where the recipient is often a family member without the app, this is a functional hole in the primary alert path, not a cosmetic one.

**The ML service is entirely simulated.** All three endpoints in `services/ml-service/main.py` return `random.uniform(...)` or fixed values with a `time.sleep()` to imitate latency. The comments openly label them "Mock endpoint." Only `/safe-route` is actually consumed by the backend (`alerts.service.ts` → `fetch(ML_SERVICE_URL/safe-route)`); the audio and motion endpoints are never called by any real client.

**Mobile auto-detection is stubbed.** `SensorsManager.sendMockMotionData` / `sendMockAudioData` construct hardcoded payloads and only `console.log` — they never actually read sensors or POST anywhere. So the "automatic distress detection" concept has no working path on the device, independent of the mocked ML.

**Config-gated mocks (acceptable but note the default).** Push and storage both ship a legitimate dual-mode: real Firebase/S3 when env vars are present, mock otherwise. This is a reasonable dev pattern — but by default (no env configured) both run mocked, and `MockPushProvider` injects a random 10% failure. Make sure production env is fully populated.

**Minor placeholders.** `StreamingView` is a static UI panel (the real WebRTC lives in `ActiveSosScreen`). The web branch of `ActiveSosScreen` uses `Math.random()` "simulate movement" — a test harness, fine for dev. The admin ML-tuning page saves nothing.

---

## 5. Build & Code Health

| Check | Result |
|---|---|
| TypeScript `type-check` | ❌ **81 errors** (66 in `src/`, 15 in tests) |
| ESLint | ❌ **501 errors, 146 warnings** (647 problems) |
| Test files present | 11 unit test files |
| Git history | Single "Initial commit" — no incremental history |

The type errors in source are real (e.g. `authenticate.ts` reads `stationId`/`badgeNumber` off a `JwtAccessPayload` type that doesn't declare them; many `req.body is of type 'unknown'` in `admin.controller.ts`; route-handler generic mismatches across `admin.routes.ts`). These aren't just test noise — the API does not cleanly compile under `tsc --noEmit`, which undermines confidence in the "functional" backend at the edges. The 501 lint errors suggest the project's own quality gates are not being enforced in CI.

---

## 6. Priority Recommendations

1. **Implement outbound SMS to trusted contacts.** Add a real `SmsProvider` (Twilio/SSLCommerz/BDBulkSMS) mirroring the push-provider pattern, and have `processTrustedContactsNotification` send SMS to *every* contact — not just registered app users. This closes the biggest safety gap.
2. **Decide the ML story.** Either integrate a real model or clearly flag distress-detection as "not yet available" in the UI so it isn't relied upon in an emergency. Do not ship random-number safety scoring as if real.
3. **Wire or remove mobile `SensorsManager`.** Right now it advertises monitoring that does nothing.
4. **Fix the 66 source-level TS errors and get `type-check` + `lint` green in CI.** For a "reliability over speed" mission statement, a failing type-check is the first thing to fix.
5. **Verify production env completeness** so push and storage exit mock mode (`FIREBASE_PROJECT_ID`, `AWS_S3_BUCKET`, `SMS_*`, `ML_SERVICE_*`).

---

*Assessed by reading source directly: `services/api/src`, `services/ml-service/main.py`, `apps/mobile/src`, `apps/police-portal/src`, `apps/admin-portal/src`, plus the repo's own `type-check-report.txt` and `lint-report.txt`.*
