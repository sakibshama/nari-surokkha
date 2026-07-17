# Nari Surokkha — System Health Report

**Date:** 2026-07-16
**Reviewed by:** Automated code & configuration audit
**Scope:** Monorepo (`services/api`, `services/ml-service`, `apps/*`, `infra/*`, `deploy/*`)
**Nature of system:** Mission-critical women's safety & emergency response platform. Reliability, privacy, security, and auditability outrank feature speed. The findings below are weighted accordingly.

---

## 0. Remediation Applied (2026-07-16)

A remediation pass has been completed. All Critical and High items below have been fixed, plus the targeted Medium/Low items. Summary of changes:

- **C-1 / C-2 (Docker):** Removed `npm run prisma:seed` from the production start command; removed all insecure inline secret fallbacks. `docker-compose.yml` now requires `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `CORS_ORIGINS`, `WS_CORS_ORIGINS` via `${VAR:?...}` (fails loudly if missing).
- **C-3 (WebSocket):** Added Socket.IO handshake JWT authentication (`io.use`) and per-room authorization — citizens may only join their own `user:`/`alert:` rooms; police/admin are scoped to their station; WebRTC signalling is restricted to alert-room participants; location updates are scoped to the alert room instead of global broadcast.
- **C-4 (SMS webhook):** Added Twilio request-signature validation (`src/utils/twilio-signature.ts`) as a fail-closed pre-handler on the public `/alerts/sms-webhook` route.
- **C-5 / C-6 (CORS):** Removed the wildcard default; `CORS_ORIGINS`/`WS_CORS_ORIGINS` now default to local dev origins and are rejected if set to `*` in production (Zod `superRefine`). Fixed the `CORS_ORIGIN` → `CORS_ORIGINS` env var name mismatch in Docker.
- **H-1 (types):** Normalized the auth role model — JWT/`req.user` `role` is now a typed string key; added a `UserWithRole` Prisma payload type and removed the `as any` casts in the auth layer; updated all consumers (`rbac`, evidence/responder controllers).
- **H-2 (tests):** Repaired the auth unit-test fixtures to match the new `UserWithRole` shape. Remaining test errors from the original report were already resolved in the codebase.
- **H-3 (CI):** Moved the pipeline to `.github/workflows/ci.yml` (where GitHub actually runs it) and corrected it to install from the root workspace lockfile, build `@nari-surokkha/shared`, and run `prisma generate` before type-check/test.
- **H-4 (sessions):** Made session creation atomic — the session id is generated up front and persisted in a single write (removed the create → revoke → create sequence).
- **M-1 (mock-S3):** Added a path-traversal guard that confines served files to the `uploads/` directory.
- **M-2 / M-3 (ML service):** Replaced wildcard CORS with an env-driven allow-list; added `X-API-Key` authentication on all analysis endpoints, and the API now sends that header.
- **L-1 (lint):** Removed the flagged unused imports/variables in the admin portal.

**Verification:** `tsc --noEmit` passes with **0 errors** for both `services/api` and `packages/shared` (when the shared workspace package is resolvable, as it is on Windows/CI). ML `main.py` parses cleanly. Full `npm test` / `oxlint` runs could not be executed in the review sandbox (missing native optional dependencies — `@rollup/rollup-linux-x64-gnu` / oxlint bindings); run them in a normal environment or via the corrected CI to confirm the runtime test pass.

The original findings are preserved below for reference.

---

## 1. Executive Summary

The platform is architecturally sound — clean layering (Route → Controller → Service → Repository), Zod-validated env at startup, Argon2id password hashing, Redis-backed rate limiting, audit logging, and refresh-token rotation are all present and thoughtfully designed. Documentation and intent (see the security comments in `cors.ts` and `rate-limit.ts`) are strong.

However, the codebase is **not currently production-ready**. There are several **critical security gaps** — most seriously, a production Docker configuration that seeds known test credentials and falls back to hardcoded JWT secrets, an unauthenticated WebSocket layer that broadcasts live victim locations, and an unverified public SMS webhook. In addition, `npm run type-check` **fails with 81 TypeScript errors**, the test suite does not compile, and the CI pipeline is in a directory GitHub will never execute.

**Overall health: ⚠️ At Risk — do not deploy to production until the Critical and High items are resolved.**

| Area | Status |
|------|--------|
| Architecture & design | 🟢 Good |
| Type safety / build | 🔴 Failing (81 errors) |
| Security (app code) | 🟡 Mixed — good intent, critical gaps |
| Security (deployment config) | 🔴 Critical issues |
| Tests | 🔴 Not compiling / not running |
| CI/CD | 🔴 Misplaced, effectively disabled |
| Real-time (WebSocket) | 🔴 Unauthenticated |

---

## 2. Critical Issues (fix before any production/staging deploy)

### C-1. Production Docker seeds known test credentials into the live database
`docker-compose.yml` runs on startup:
```
command: sh -c "npx prisma migrate deploy && npm run prisma:seed && npm run start"
```
`prisma:seed` inserts dev accounts with a **known password (`Test@1234`)** and a fixed police badge (`B-12345`). Anyone who reads this public repo structure can log into a production deployment.
**Fix:** Remove `npm run prisma:seed` from the production command. Seed only in dev/staging via a separate, explicit step. Never ship fixed-credential seed data to prod.

### C-2. Hardcoded fallback JWT secrets in Docker config
```
JWT_SECRET=${JWT_SECRET:-supersecretjwtkey}
JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET:-supersecretrefreshkey}
```
These fallbacks are weak and public. (They're also shorter than the 64-char minimum the env schema enforces, so the app would crash — masking the fact that the real fix is to remove them.)
**Fix:** Remove default values entirely so a missing secret fails loudly. Inject secrets from a secrets manager (Docker secrets, Vault, cloud secret store), never inline in compose.

### C-3. WebSocket layer has no authentication or authorization
`src/plugins/websocket.ts`: `io.on('connection', …)` accepts any client with **no token check**. Any anonymous client can:
- `join:alert`, `join:station`, `join:user` — any room, any ID
- receive `alert:location_update` (live victim GPS)
- broadcast `webrtc:signal` and location updates

For an emergency system, this exposes live location of victims to anyone who can reach the socket.
**Fix:** Add a Socket.IO auth middleware (`io.use(...)`) that verifies the JWT on the handshake, and authorize room joins against the user's identity/role (a citizen may only join their own `user:`/`alert:` rooms; police only their `station:`).

### C-4. Public SMS webhook is unverified (spoofable)
`POST /api/v1/alerts/sms-webhook` is registered outside the authenticated router and does **no Twilio signature validation**. An attacker can POST arbitrary `{From, Body}` to trigger SMS-based alert processing on behalf of any phone number.
**Fix:** Validate the `X-Twilio-Signature` header against the request. Reject unsigned/invalid requests. Restrict the route to the provider's IP ranges at the reverse proxy where possible.

### C-5. CORS default is wildcard on a safety-critical API
`env.ts` sets `CORS_ORIGINS` default to `'*'`, and `cors.ts` honors `*` — directly contradicting its own header comment ("Never open CORS to `*`"). Combined with `credentials: true`, a wildcard origin is both insecure and invalid for credentialed requests.
**Fix:** Remove the `'*'` default; require an explicit allow-list. Fail startup if unset in production.

### C-6. Docker env var name mismatch silently disables CORS restriction
`docker-compose.yml` sets `CORS_ORIGIN` (singular). The app reads `CORS_ORIGINS` (plural). In the container the allow-list is never applied and falls back to the insecure default (see C-5). The same mismatch applies to `WS_CORS_ORIGINS`.
**Fix:** Correct the variable names in compose; add a startup assertion that the expected vars are present.

---

## 3. High-Priority Issues

### H-1. `npm run type-check` fails — 81 TypeScript errors in `services/api`
The build's type gate is red. Highest concentrations: `modules/admin` (22), `modules/cases` (21), `modules/alerts` (7). Representative classes of error:
- **Auth type erosion:** `auth.service.ts` uses `(user as any).role` / `.permissions` in many places. `login()` returns `role` as the **Role object**, while `register()` returns `role.key` (a string) — inconsistent shape reaching the client and the JWT. The JWT `role` claim may therefore be wrong for one of the two flows.
- **`req.user` possibly undefined** (8 hits in `cases.controller.ts`) — auth *is* enforced by the route hook, but the controller accesses `req.user.id` without a null guard, so a typing/hook-order regression would crash at runtime instead of failing type-check.
- **Fastify route generic mismatches** in `admin.routes.ts` / `evidence.routes.ts` — handlers typed with request generics the schema doesn't guarantee; evidence routes fall back to `req: any, reply: any`.
- **Prisma field drift:** `cases.service.ts` references `victimName`, `victimPhone`, `profile`, `createdAt` that don't exist on the queried types — indicates schema/code drift or missing `include`s.

**Fix:** Treat type-check as a release gate. Remove `as any` casts around auth; make `login`/`register` return a single normalized user shape; add `req.user` guards (or a typed authenticated-request); align `cases.service` queries with the Prisma schema.

### H-2. Test suite does not compile / does not run
15 type errors live in `src/__tests__/*` (wrong `AuditAction` literals, `UserRole` imported from `@prisma/client`/`@nari-surokkha/shared` where it doesn't exist, `Decimal` vs `number` mismatches, a missing `sms.provider` module import). Even setting that aside, `vitest` fails to start in a clean checkout because the optional native dep `@rollup/rollup-linux-x64-gnu` isn't installed. **Net effect: there is no working automated test signal.**
**Fix:** Repair the test type errors; pin/space out the rollup optional-deps issue (clean `node_modules` + reinstall, or add the platform optional dep). Make `npm test` pass locally before wiring it into CI.

### H-3. CI pipeline is in a location GitHub never runs
The workflow is at `infra/github-actions/ci.yml`. GitHub Actions only executes workflows under **`.github/workflows/`**. CI (lint, type-check, tests, Postgres/PostGIS service) is therefore **not running on any push or PR**, which is how C-1…H-2 reached this state undetected.
**Fix:** Move/symlink the workflow to `.github/workflows/ci.yml`. Make type-check and tests **required** status checks on `main`/`develop`.

### H-4. Non-atomic session creation (create → revoke → create)
`createSessionAndTokens()` writes a placeholder session, immediately revokes it, then creates a second one — three writes per login, with a window where token/session state is inconsistent. The code comment itself flags this as non-atomic.
**Fix:** Generate the `sessionId` first (UUID), embed it in the refresh JWT, then create the session once with the real token. One write, no race.

---

## 4. Medium-Priority Issues

- **M-1. Path traversal in dev mock-S3 route.** `GET /evidence/mock-s3/*` does `path.join(uploadDir, decodeURIComponent(fileKey))` on raw user input; a `../` payload can escape `uploads/`. Dev-only, but should be normalized-and-bounds-checked or removed from any non-dev build.
- **M-2. ML service CORS is `allow_origins=["*"]` with `allow_credentials=True`** (`services/ml-service/main.py`). Invalid combination and overly open; lock to the API origin.
- **M-3. ML service has no auth.** The API sends `ML_SERVICE_API_KEY`, but `main.py` never checks it, and every endpoint is mock/`random`-based. Fine for a stub, but must not reach production as-is.
- **M-4. Hardcoded `http://localhost:3001` in clients.** `apps/mobile/src/services/api.ts` and `apps/admin-portal/src/services/api.ts` hardcode localhost as the base/fallback. Ensure all builds are env-driven; a shipped localhost fallback is a silent outage.
- **M-5. Two divergent compose files.** `docker-compose.yml` (root) and `infra/docker/docker-compose.dev.yml` differ; the root file still declares the obsolete `version: '3.8'`. Consolidate and document which is authoritative for which environment.
- **M-6. `.env` files exist on disk** for `api`, `admin-portal`, `police-portal`. They are correctly **git-ignored and not tracked** (verified) — good — but confirm they're excluded from Docker build context and images.
- **M-7. 73 `: any` annotations across `src/modules`** erode the type guarantees the architecture otherwise provides, especially on request bodies/params.

---

## 5. Low-Priority / Hygiene

- **L-1. 43 lint warnings** (0 errors) across portals: unused imports (`X`, `Wifi`, `Role`, `User`, `Responder`), unused catch bindings, and `react-hooks/exhaustive-deps` misses (e.g. `AuditLogs.tsx` `useEffect` missing `fetchLogs`) that can cause stale data.
- **L-2. Stale reports.** `type-check-report.txt`/`lint-report.txt` reference a `pino` import in `push.provider.ts` that no longer exists — regenerate reports after fixes so the signal is trustworthy.
- **L-3. Rate-limit key uses `x-forwarded-for` unconditionally** — only trust it behind a known proxy, else clients can spoof the header to dodge limits. Configure Fastify `trustProxy` explicitly.
- **L-4. Unused/placeholder params** flagged by tsc (`options`, `opts`, `req`) — remove or prefix with `_`.

---

## 6. What's Working Well

- Layered, modular architecture with clear separation of concerns.
- Startup env validation via Zod that intentionally crashes on misconfiguration.
- Argon2id hashing with tunable cost; constant-time login path with a dummy-hash verify to resist user-enumeration timing attacks.
- Refresh-token rotation with server-side session revocation; "logout all" also deactivates device tokens.
- Redis-backed distributed rate limiting with stricter auth limits and prod header suppression.
- Evidence access is owner/role gated and writes an access audit log; presigned-URL pattern for private evidence.
- Helmet, cookie signing, request IDs for traceability, and audit-log models throughout the schema.

---

## 7. Recommended Remediation Order

1. **Deployment safety (today):** C-1, C-2, C-6 — stop seeding prod, remove secret fallbacks, fix env var names.
2. **Exposure of victim data:** C-3 (WebSocket auth), C-4 (SMS webhook signature), C-5 (CORS allow-list).
3. **Restore the safety net:** H-3 (move CI into `.github/workflows`), H-2 (make tests run), H-1 (drive type-check to zero).
4. **Correctness/robustness:** H-4 (atomic sessions), M-1…M-3 (ML service + mock-S3 hardening).
5. **Hygiene:** M-4…M-7, then the L-items.

**Suggested release gate:** `type-check` green, `test` green, and a security review sign-off on items C-1…C-6 before staging is promoted to production.

---

## 8. Verification Notes

- Findings drawn from source review plus the committed `type-check-report.txt` (81 API errors) and `lint-report.txt` (43 warnings, 0 errors).
- `git ls-files` confirms no real `.env` is tracked (only `.env.example`).
- Test/build execution in the review sandbox was blocked by a missing rollup native optional dependency; the type errors are reproducible from the committed report and source. Re-run `npm run type-check` and `npm test` in a clean environment after fixes to confirm.
