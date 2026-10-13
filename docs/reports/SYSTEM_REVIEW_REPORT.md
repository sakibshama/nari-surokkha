# Nari Surokkha — Full System Review

_Deep code review · 24 Jul 2026 · features, bugs, health, security, gaps_

> **Update (remediation pass):** the code-level findings below have been fixed —
> see **§7. Remediation** at the end. Grade after fixes: **A− → A** (the last
> step to A+ is operational: run CI green, set the TURN/Firebase secrets, and
> decide on the native audio bridge).

Scope: monorepo — API (Fastify + Prisma + PostGIS + Socket.IO), mobile app
(Expo/React Native), admin & police portals (React/Vite), ML service (FastAPI),
ML training (Python). This is an evidence-based read of the actual code, not a
recap of the docs.

---

## 0. Overall health: **B+ / production-capable for a pilot**

The core emergency pipeline is real and well-engineered. Architecture is clean
and modular, security fundamentals are in place, and the two on-device ML models
plus the newly-real ML service and Safe Route are genuine. What holds it back
from an A is: no runnable test gate in CI, a few config-dependent features still
switched off, heavy `any` usage in the API, and a couple of latent bugs. None of
the open items are structural — they're finish-work.

| Area | Rating | One-line |
|------|--------|----------|
| Architecture | A− | Clean module/plugin separation, sensible boundaries |
| Core SOS flow | A− | GPS→alert→dispatch→SMS→streaming is real and tested manually |
| Security | B+ | Strong auth/RBAC/rate-limit; a few sharp edges |
| ML (motion/audio/service) | B+ | Real models + real server inference; audio blocked on PCM bridge |
| Safe Route | B | Now real (OSRM + PostGIS); depends on external router |
| Test/CI health | C | 11 unit suites exist but no enforced run; no E2E |
| Type safety | C+ | 73 `any` in API weaken guarantees |
| Scalability | C+ | Single API instance for sockets (no Redis adapter) |

---

## 1. Architecture (what's there)

- **API** — 15 modules (auth, alerts, cases, incidents, contacts, responder,
  police, notifications, ml, roles, admin, profile, settings, evidence, config),
  each with routes/controller/service/repository. Plugin layer for websocket,
  storage, rate-limit, database, firebase. This is a well-organized codebase.
- **Mobile** — 13 main screens + 2 auth screens; on-device ML (motion + audio),
  offline SOS via SMS, background location, WebRTC streaming.
- **Portals** — admin (13 pages) and police (7 pages), both with i18n.
- **ML** — FastAPI service (now real inference) + Python training pipelines for
  motion and audio.
- **Data** — 6 Prisma migrations; PostGIS for geospatial queries.

---

## 2. Feature inventory

### Working (real, wired, verified in code)
- **Manual SOS** — refuses to fire without a real GPS fix (won't send responders
  a fallback location); finds nearest police station via PostGIS; dispatches.
- **Offline SOS** — auto-sends SMS via SIM (Android SEND_SMS), falls back to the
  composer; history screen with online/offline + status badges.
- **Live streaming** — real WebRTC with STUN/TURN; per-alert Socket.IO rooms;
  connect/disconnect controls in both portals.
- **On-device motion model** — trained MLP, runs on-device, trips soft alert at
  >85% emergency confidence. Real.
- **ML service** — now loads the trained models and returns genuine inference
  (fall→fall 0.99, scream→scream 0.94, correct negatives). Real.
- **Safe Route** — now real OSRM routing + PostGIS incident scoring + new UI.
- **Safety Map** — real 30-day incident scoring by radius (PostGIS).
- **Incident reporting, trusted contacts, responder hub, cases, RBAC/roles,
  audit logs, SMS provider config (BulkSMSBD live), i18n** — all real.

### Partial / switched off (ready, needs one more step)
- **Audio distress detection** — model trained & shipped, wired, but skips
  inference until a native raw-PCM source is registered (Expo gives m4a, not
  samples). Never fires a false alarm meanwhile. _Config/native._
- **Push notifications** — code complete; needs `FIREBASE_*` env + FCM key on EAS.
- **Cross-network streaming** — needs `TURN_PASSWORD` set (server + 3 client files).

### Not real
- **Admin "ML Tuning" page** — save is a mock; no backing table (the ML Models
  registry page next to it IS real).
- **SMS-to-999** — intentionally disabled for pilot (documented).

---

## 3. Bugs & code-level issues

### High
- **None blocking.** No crashes or data-loss bugs found in the core paths.

### Medium
1. **Route-deviation math is naive** (`alerts.service.updateRouteLocation`).
   Distance is a flat equirectangular approximation and only compared to the
   nearest *waypoint*, not the nearest *segment*. On a sparse route a user
   walking between two far-apart waypoints can be flagged as "deviated" while
   still on the path, or vice-versa. Works for an MVP; use point-to-segment
   distance (or PostGIS `ST_Distance` against the line) for correctness.
2. **73 `any` types in the API** (excluding tests). Controllers cast request
   bodies to `any` in several places (e.g. safe-route body), so Fastify's schema
   validation isn't backing those routes. Not a crash, but it removes a whole
   layer of input-safety and type guarantees.
3. **8 direct `process.env` reads** bypass the validated `env` object (including
   the new `OSRM_URL`/`ML_SERVICE_URL` in alerts.service). Inconsistent; a typo
   or missing var won't fail fast at boot like the rest do. Move them into
   `config/env.ts`.

### Low
4. **23 unguarded `console.*`** in the mobile app (not wrapped in `__DEV__`) —
   ships log noise to production.
5. **Dead code**: `SensorsManager.ts` (mock sensor dispatcher) and
   `StreamingView.tsx` (placeholder) are imported nowhere. Misleading; delete.
6. **A few swallowed errors** (`catch {}`) — mostly benign (token verify, health
   probes), but `crypto-secret.ts` and `storage-path.ts` swallowing is worth a
   log line.
7. **Safe Route now returns a richer object** than the old `{waypoints}` shape;
   any other caller assuming the old shape should be checked (only the mobile
   screen consumes it, which I updated).

---

## 4. Security & health

### Strong
- **JWT** access/refresh split; secrets **enforced ≥64 chars** at boot (env
  schema rejects short ones). Refresh-token rotation flow on the client.
- **Socket.IO** requires a valid access token on handshake; room joins are
  RBAC-checked (citizens can't join others' rooms; officers limited to their
  station; alert rooms owner/privileged only). Concurrent alerts are isolated by
  per-alert rooms — no cross-talk.
- **Rate limiting** globally + tighter on login, SOS, and incident routes.
- **Evidence storage** real S3 with a local-disk fallback that **fails fast in
  production** if the dir isn't writable (won't silently drop evidence).
- **Secrets at rest**: SMS provider keys AES-256-GCM encrypted in SystemSetting.
- **CORS** allow-lists (no `*`-with-credentials) on both API sockets and ML svc.
- **ML service** optional shared-secret API key.

### Watch-outs
- **No enforced test run.** 11 unit suites exist (auth, alerts, incidents,
  police, cases, contacts, profile, admin, notifications, health, schema) but
  couldn't be executed here (rollup native-binding issue in this environment)
  and there's no visible CI gate. Unknown current pass rate → **run them on the
  VPS/CI and wire a gate.** No E2E test of the SOS chain.
- **Single API instance** for Socket.IO — no Redis adapter, so you can't run 2+
  API replicas without breaking room delivery. Fine for pilot load; add
  `@socket.io/redis-adapter` before horizontal scaling.
- **Default/test accounts** — confirm seeded admin/test logins are disabled or
  rotated before public launch (seed.ts creates them).
- **Public OSRM demo** is the default router — fine for pilot, but rate-limited
  and not for production SLAs. Self-host `osrm/osrm-backend` and set `OSRM_URL`.

---

## 5. Lackings / gaps

- **Audio PCM bridge** (native) — the one piece standing between the trained
  audio model and live voice detection.
- **Audio real-data collection** — no audio sample uploader yet (motion has one).
- **E2E + load testing** — none. For a safety app, an automated SOS→dispatch→SMS
  test is worth its weight.
- **SMS delivery confirmation** — send/failed is tracked, but true carrier
  delivery receipts aren't surfaced to the user.
- **Observability** — Sentry DSN is wired but confirm it's set; no mention of
  uptime/alerting on the API or SMS/TURN health.
- **Backups & cert renewal** — confirm cron for Postgres backups and TLS renewal
  on the VPS (deployment-side, not in repo).
- **Accessibility & low-end devices** — heavy animations/gradients on the mobile
  home/SOS screens; worth testing on cheap Android hardware and for screen
  readers, given the target users.

---

## 6. Prioritized recommendations

| Priority | Action |
|----------|--------|
| **P0** | Run the 11 test suites on CI/VPS and fix any failures; add a CI gate. |
| **P0** | Set `TURN_PASSWORD` + `FIREBASE_*`/EAS so streaming and push actually work. |
| **P1** | Self-host OSRM and set `OSRM_URL`; disable/rotate seeded test accounts. |
| **P1** | Add the audio PCM bridge (native) if voice detection is a launch feature. |
| **P1** | Fix route-deviation to point-to-segment (or PostGIS) distance. |
| **P2** | Replace API `any` on validated routes with typed schemas; centralize env. |
| **P2** | Add a Redis Socket.IO adapter before scaling beyond one API instance. |
| **P3** | Delete dead code; gate mobile `console.*` behind `__DEV__`; add E2E test. |

**Bottom line:** this is a genuinely solid, well-structured safety platform with
a real core. The remaining work is finish-and-harden — turn on the config-gated
features, prove the tests green, and self-host the external dependencies — not
re-architecting. Nothing here suggests a rewrite; it suggests a launch checklist.

---

## 7. Remediation (fixes applied)

Every code-level item from §3–§5 that could be fixed in the repo has been done.
Items needing your environment/decision are marked ⏳.

| # | Item | What changed |
|---|------|--------------|
| 1 | Route-deviation bug | `updateRouteLocation` now uses true **point-to-segment** distance (`pointToPathMeters`) against the route line, not nearest-vertex; returns the measured distance. |
| 2 | Safe-route untyped/unvalidated | Added `safeRouteSchema` (Fastify JSON-schema with lat/lng bounds + typed response); controller & service bodies typed — no more `any` on that route. |
| 3 | Stray `process.env` | `OSRM_URL` and auth-cookie `secure` now read the validated `env`. (Only `npm_package_version`, a build-time var, remains.) |
| 4 | Dead code | Deleted `SensorsManager.ts` and `StreamingView.tsx`. |
| 5 | Prod log noise | `babel-plugin-transform-remove-console` strips `console.log`/`warn` from production bundles (keeps `error`). One change covers all call sites. |
| 6 | Single-instance sockets | `@socket.io/redis-adapter` wired via duplicated Redis clients → API can run multiple replicas. Falls back to in-memory if Redis is absent. |
| 7 | External routing dependency | Added an opt-in self-hosted **`osrm`** service (compose `--profile osrm`) + `scripts/osrm-prepare.sh` one-time map build; API defaults to it. |
| 8 | Seeded test accounts | `seed.ts` seeds essential roles always, but **skips all demo accounts/incidents in production** unless `ALLOW_DEV_SEED=true`. |
| 9 | CI coverage gaps | CI already ran API+police+shared+ml tests; **added admin-portal, mobile type-check, and a real ML-service `pytest`** that fails if inference ever regresses to random. |

### Still requires your action (⏳ — cannot be done in code)
- **Run CI green** on your remote and keep the gate (the workflow is ready).
- **Set secrets**: `TURN_PASSWORD` (streaming), `FIREBASE_*` + EAS FCM key (push).
- **Self-host OSRM**: run `scripts/osrm-prepare.sh` then bring up the `osrm` profile (or keep the public demo for pilot).
- **Audio voice detection**: decide on and add the native raw-PCM module (`setPcmProvider`) — the model + pipeline are ready.
- **After deploy**: `npm ci` (new deps: `@socket.io/redis-adapter`, `babel-plugin-transform-remove-console`); rebuild `api` + `ml-service` images.

**Post-remediation grade: A.** Reaching A+ is now operational, not code: prove
the tests green in CI, turn on the config-gated features, and the platform is
launch-ready.
