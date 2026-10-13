# Nari Surokkha — Full Application Review (second pass)

**Date:** 12 October 2026, evening
**Code reviewed:** commit `23a3d8e` ("feat: add payment gateways, subscription system, on-device emergency detection, and incident media"), plus your later edits to `PaymentGateways.tsx` and `Settings.tsx`. It covers everything added today: payments, SIM fallback, detection, incident media, the Settings redesign and the heatmap.
**Replaces:** the morning version of this file (still in git history). The September security review (`docs/reports/PRODUCTION_REVIEW_2026-09-17.md`) is re-checked in §6.

---

## Status after the fix pass (13 October 2026)

**Every code issue in this review is fixed** except the items listed under "Still open" below. Checks after the fixes:

| Check | Result |
|---|---|
| API `tsc` / ESLint | 0 errors / 0 errors (54 lint errors before) |
| API unit tests | **200 / 200** (136 before) |
| Admin portal `tsc -p tsconfig.app.json` + `vite build` | Pass |
| Mobile `tsc` + `npm test` | Pass: 49 pass, 2 skipped (audio fixtures not in repo), 0 fail |
| Compose files, nginx, shell scripts, workflows | Validated: `docker compose config`, `nginx -t`, shellcheck, actionlint |

**Highlights:**
- Fix-first items #1–#11 are all done.
  - The SIM SMS now goes out as a confirmed multi-part send (native patch).
  - The portal's siren and realtime survive navigation and token expiry.
  - SOS tracking is tied to SOS state and survives Back and app restarts, with a foreground fallback.
  - Route deviation alerts once per route.
  - Responder accept works.
  - Password hashes are no longer sent.
  - 4xx errors keep their status.
  - The evidence IDOR is closed.
- **B1–B6 are closed in code:**
  - B1, B2: admin permission checks; a password is required when creating a user.
  - B3: `trustProxy`, and nginx overwrites `X-Forwarded-For`.
  - B4: phone OTP at registration, and SMS consent links for trusted contacts.
  - B5: time-limited coturn credentials and denied private peer IPs.
  - B6: signed, expiring local evidence URLs.
- New: owners can resolve an alert and admins can set an alert's status.
  - Owner: `POST /alerts/:id/resolve`.
  - Admin: `PATCH /admin/alerts/:id/status`, with actions in Alert details.
- New: mobile change password, the push and background-location switches, the evidence delete button, a tile map, the fake-call ringtone, and automatic online SOS after an offline one.
- Portal access token now lives in memory only, with UI permission gating, paging and a CSP.
- Infrastructure:
  - PostGIS dev compose, Node 22 non-root images, CI runs the mobile tests, tag-exact deploys.
  - Encrypted off-site backups, with WAL-G point-in-time recovery documented.
  - Working Alertmanager, TURN, nginx rate-limit zones and a Grafana dashboard.
  - ml-service retired.
- Found and fixed during the work: BullMQ rejected job IDs containing `:`. Every SOS fan-out and dispatch job was refused, so contact SMS were never queued by the server.

**Still open (decisions, data or a device needed, not code):**
- **Payments policy:** selling SMS plans through SSLCommerz/Stripe versus Play Billing / Apple in-app purchase. Options are in `docs/store-release.md`.
- **Play approval** for `SEND_SMS`, background location and foreground services. The declarations are written up in `docs/store-release.md`.
- **Real training data** for the motion model and real voices for the keyword models. The process is in `docs/EMERGENCY_DETECTION.md` §9.
- **Custom roles** still carry no permissions (permissions are per user). That is a design choice.
- **Not yet tested on a phone or by real image builds:**
  - the SMS patch, background location and the disclosure dialog;
  - the Docker images and the WAL-G build (Docker Hub was blocked here).

**Before running the new code:**
- Run `npx prisma migrate deploy` and `npx prisma generate` in `services/api`.
- Set the new env vars from `.env.production.example` / `services/api/.env.example`: `DIRECT_DATABASE_URL`, `PHONE_VERIFICATION`, `TRUST_PROXY`, `TURN_SECRET`, `EVIDENCE_URL_SECRET`.
- Your local Redis URL now includes the dev password if you use the root compose.
- Make a new native mobile build: `npx expo prebuild --clean`, then build.

The original review follows unchanged.

---

## 1. Verdict

The app is feature-rich, and most of it works in code. It type-checks, and all tests pass (§2). Today's work holds up under review: payments, the SMS-quota → SIM fallback, on-device detection and incident media. This pass, however, found **two critical problems in the emergency path and a group of high-severity bugs** that the morning review missed. The most important:

1. **The phone's own SOS text is never delivered on Android.** The SMS library sends one SMS part only, and the SOS message is longer than that, so Android drops it silently. This is the SMS used offline and when the quota is used up.
2. **In the admin portal, the SOS siren and popup stop working after you leave the Dashboard once.**

Also high-severity:

- Pressing Android **Back** during an SOS stops live tracking.
- **Route deviation sends a new SOS every 10 seconds.**
- Responders cannot **accept** a dispatch: the server returns a 500.
- The admin user list **sends password hashes** to the browser.
- Many 4xx errors reach clients as **500**.

All six September security blockers (B1–B6) are still open.

None of these is hard to fix. §3 lists the order I would fix them in.

---

## 2. How the review was done

Four parallel reviewers each read one area against the code it calls: API, admin portal, mobile app, and infrastructure/ML/security. I then re-checked every Critical and High finding against the source myself.

| Check | Result |
|---|---|
| API `tsc --noEmit` | **0 errors** |
| API unit tests (`vitest --project unit`) | **136 / 136 pass** (13 files) |
| Admin portal `tsc -p tsconfig.app.json` | **0 errors**. Correction: earlier today I ran `tsc -p .`, which checks nothing because the root `tsconfig.json` has `files: []`. Your `import type` fix in two files was a real dev-server crash. CI uses `tsc -b`, which is correct. |
| Admin portal `vite build` | Passes |
| Mobile `tsc --noEmit` | **0 errors** |
| Mobile tests (`npm test`) | **26 pass, 0 fail, 2 skipped**. The 2 real-model tests need the ~70 MB audio fixtures, which are not in the repo. |
| Schema ↔ migrations | Every model, column and enum in `schema.prisma` is created by a migration. Column types were not diffed (no PostGIS here). |
| Endpoint cross-check | Every path called by the app and the portal exists. Mismatches are in the request/response **schemas** (§5). |
| Device test | Not possible from here (no phone, no Android SDK). |

---

## 3. Fix first (in this order)

| # | Problem | Where | Effort |
|---|---|---|---|
| 1 | **The SIM SOS SMS is never sent.** `react-native-direct-sms` calls `sendTextMessage` with no multi-part support. The SOS text (over 160 chars in English, and well over 70 in Bangla) is dropped silently, but the app logs "sent". | `apps/mobile/src/services/directSms.ts:78`; library `DirectSmsModule.java:26` | Small native module using `divideMessage` + `sendMultipartTextMessage` with a sent-intent |
| 2 | **The portal's SOS siren and popup die after leaving the Dashboard.** `socket.off('alert:created')` with no handler removes Layout's listener too. | `admin-portal/src/pages/Dashboard.tsx:128-130` | Pass the handler to `off()` |
| 3 | **Portal realtime dies when the token expires.** The socket keeps the login-time token, which is valid for 15 minutes, and never re-authenticates. | `admin-portal/src/services/socket.ts:22-26` | Make `auth` a callback, and refresh on `connect_error` |
| 4 | **Android Back during an SOS stops tracking** (location, queue, socket). The server alert stays active. | `mobile/src/screens/main/ActiveSosScreen.tsx:217-223` | `usePreventRemove` while the SOS is active |
| 5 | **Route deviation creates a soft alert on every off-route ping.** Each one auto-escalates to a real SOS with server SMS 30 s later. The app can't cancel them. | `api/src/modules/alerts/alerts.service.ts:958-969` | Escalate once per route, and return the alert id |
| 6 | **Responder accept and verify crash.** The audit-log write uses a non-existent `details` field and a non-existent enum value `responder_verified`. | `api/src/modules/responder/responder.service.ts:54-62, 162-170` | Use `metadata` and a valid action |
| 7 | **Password hashes are sent to the portal.** `/admin/users` uses `include` with no `select` and no response schema. | `api/src/modules/admin/admin.repository.ts:26-32, 52-68, 97-103` | Use `select` or `omit` |
| 8 | **`fastify.httpErrors.*` become 500s** in evidence, responder and payments (28 places). Clients see "unexpected error". | `api/src/middleware/error-handler.ts:52-85` | Pass through errors with `statusCode` 400–499 |
| 9 | **Evidence IDOR.** Any non-citizen role (responder, custom role) can stream any evidence file via `/evidence/:id/raw`. | `api/src/modules/evidence/evidence.service.ts:141` | Use the owner-or-admin check used elsewhere |
| 10 | **SOS tracking needs "Allow all the time" location.** With foreground-only permission, no location is sent at all, but the screen still says "Live location transmitting". | `mobile/src/services/backgroundTasks.ts:64-86`; `ActiveSosScreen.tsx:308` | Fall back to a foreground watcher |
| 11 | Security blockers **B1–B6** | §6 | — |

---

## 4. Feature status

**Legend:** ✅ works in code · 🟡 incomplete or partly broken · ❌ broken

### 4.1 Mobile app (Expo SDK 56 / RN 0.85)

| Feature | Status | Notes |
|---|---|---|
| Login, register, token refresh | ✅ | No OTP (B4) |
| Logout | 🟡 | Only clears the phone. `/auth/logout` is never called, so the refresh token stays valid and the push token stays bound to the account. Cached contacts and SMS history survive logout. |
| Home → one-tap SOS (online) | ✅ / 🟡 | Works. No GPS timeout: with no fix, no SOS is sent at all (`HomeScreen.tsx:226-236`) |
| SOS offline / quota → SIM SMS | ❌ | Fix-first #1 |
| Server-side SMS fallback (`/sms-fallback`) | ✅ | |
| Active SOS: live location | ❌ | Fix-first #4 and #10. The location task is also shared with Safe Route: leaving either screen stops the other (`SafeRouteScreen.tsx:169`). Leaving Active SOS disconnects the app-wide socket (`:221`). |
| Active SOS: WebRTC to responders | 🟡 | Code complete, not tested end to end. Responders can't join the alert room (§5, API M6). |
| Active SOS: evidence photo | ✅ | |
| SOS state after an app restart | 🟡 | Not persisted. Background pings are dropped and Home doesn't know an SOS is active (`locationStore.ts`). |
| 15 s soft alert + escalation | ✅ | 23 logic tests |
| On-device detection (shout, help, cry, bachao) | ✅ / 🟡 | Models ship and load. Accuracy measured on held-out synthetic voices, not yet on real voices. Shout recall unmeasured. |
| Background listening (Android FGS microphone) | ✅ | Config verified |
| Motion (fall / struggle) | 🟡 | Synthetic training data only. Sensors run whenever Home is open, even with the toggle off. |
| Trusted contacts | ✅ | Unverified contacts (B4) |
| Safe route | 🟡 | Deviation is ignored on the phone; the server side is fix-first #5 |
| Safety map | 🟡 | Score card only; no map is drawn |
| Report incident + photos/videos | ✅ | New today |
| Evidence library | 🟡 | No delete button, although the API supports deletion |
| Responder hub | ✅ / ❌ | List works. Accept crashes on the server (#6). The availability switch never saves: the field is stripped by the schema (`responder.schemas.ts:27-35`), and going offline writes location 0,0. |
| SMS history, alert history | ✅ | |
| Subscription (gateways from the portal) | ✅ | The deep link only works while the screen is open (no `linking` config). Polling covers the rest. |
| Settings: theme, language, detection | ✅ | |
| Settings: push / background-location switches | 🟡 | Local only (TODO at `SettingsScreen.tsx:41-43`) |
| Settings: change password | 🟡 | Alert stub (`:270`), although the API exists |
| Settings: server address editor | 🟡 | Also shown in release builds |
| Fake call | ✅ | Vibration only, no ringtone |
| Bangla / English, light / dark | ✅ | 579 Bangla keys. A few strings bypass `t()`: the SMS permission dialog and the location notification. |

### 4.2 API (Fastify + Prisma + PostGIS + BullMQ)

| Area | Status | Notes |
|---|---|---|
| Auth: refresh rotation, reuse detection, token version | ✅ | |
| Rate limiting | 🟡 | The `X-Forwarded-For` bypass is still open (B3) |
| SOS, SMS quota → device SIM fallback, `/sms-fallback` | ✅ | |
| Soft alerts + 30 s server escalation | 🟡 | Check-then-act race: an escalation can overwrite a cancel (`alerts.repository.ts:71-76`). If the queue is down, escalation is only logged (`alerts.service.ts:540-551`). |
| Location pings + Redis buffer | 🟡 | The offline replay `timestamp` is stripped by the schema (`alerts.schemas.ts:70-79`), so queued pings get "now" |
| Safe route + deviation | ❌ | #5 |
| Evidence | 🟡 | #9; 4xx errors become 500 (#8); B6 |
| Responders (apply, dispatch, accept, verify) | ❌ | #6. Responders also can't join the alert room for live location and WebRTC (`websocket.ts:30-33`). |
| Incidents + anonymous media | ✅ | New today; 17 tests |
| Subscriptions + payments (SSLCommerz, Stripe) | 🟡 | Exactly-once crediting works. But the unauthenticated cancel/fail URLs close a pending payment without asking the gateway. A user who backs out and then pays in the same session is charged but **not credited**, and still sees "success" (`subscription.service.ts:165,199`; `subscription.repository.ts:58-66`). |
| Admin (users, responders, alerts, analytics, audit) | ❌ / 🟡 | #7. Edit-user ignores the new password. Deleting a user with alerts fails as "not found" (FKs without cascade). `activeAlerts` is always 0, because nothing ever sets `in_progress`. There is no endpoint to resolve or close an alert. |
| Roles | 🟡 | Any admin can CRUD roles with no permission check. Custom roles carry no permissions. |
| Settings (SMS), config, ICE servers | 🟡 | B5 |
| Worker (notifications, escalations, dispatch, retention) | ✅ / 🟡 | Retention runs from a 24 h `setInterval`, so frequent deploys mean it never runs, and it runs on every replica |
| Public tracking `/t/:token` | ✅ | |
| `superadmin` role | — | Not seeded and can't be created, so all `superadmin` checks are dead code. `/admin/*` being admin-only locks nobody out. |
| Dead code | — | Police models and enums, `SafetyScore`, `MlDetectionEvent`, unused `admin.schemas.ts`, the tracking-JWT path (`alerts.tokens.ts`), `/api/v1/ping` placeholder |

### 4.3 Admin portal (React 19 + Vite 8)

| Page | Status | Notes |
|---|---|---|
| Login | 🟡 | The login response schema has no `permissions`, so **all UI permission gating is disabled**: every admin sees every page, and some return 403 |
| Dashboard | ❌ | #2. "Active emergencies" is always 0. "Avg Safety Score 84/100" is hard-coded. |
| Global SOS popup + siren (Layout) | ❌ | Stops after #2. Dead after a token expiry (#3). |
| Alert details | 🟡 | Works, but has no resolve, close or dispatch actions (and the API has none). It re-requests routes on every render because the `center` array is new each time, which costs money with Google Directions. It doesn't rejoin the alert room after a reconnect. |
| Analytics + heatmap | ✅ | The error state now shows the real cause |
| Incidents + media gallery | ✅ / 🟡 | Works. No live updates when it is the first page opened (production builds). |
| Users | 🟡 | #7. Edit-user password does nothing. Any edit logs the edited user out. Only 50 users are shown (no paging). |
| Roles | 🟡 | Errors go only to the console. Custom roles can't be assigned. |
| Responders | 🟡 | "Delete" actually suspends. Suspended responders show as "Pending" with a Verify button. |
| Audit logs | 🟡 | Newest 50 only (the cursor is ignored) |
| Payment gateways | ✅ | |
| Settings | ✅ / 🟡 | The email change is stripped by the API schema, but the UI says "saved" |
| Toasts | 🟡 | Two `<Toaster>`s, so every toast shows twice (`main.tsx:10`, `Layout.tsx:168`) |
| Translation | 🟡 | The heatmap, media gallery, maps, global popup and most of Alert details are English only |
| Security | 🟡 | Access token in `localStorage`. No XSS sinks found. |

### 4.4 Infrastructure, ML, repository

| Area | Status | Notes |
|---|---|---|
| Production compose | 🟡 | Well structured. TURN effectively off (`TURN_HOST` missing from the example env, ports not opened). `nginx:alpine` unpinned. |
| Root `docker-compose.yml` | ❌ | Uses `postgres:15-alpine`, which has **no PostGIS**, so migrations fail. Its header says "Production". Redis has no password. |
| Staging compose | ❌ | `NODE_ENV=staging` is not allowed by `env.ts`, so the API exits. Wrong build context. |
| Dockerfiles | 🟡 | Node 20 is end-of-life. Containers run as root. `npm install` instead of `npm ci`. |
| CI | 🟡 | Good migration tests on real PostGIS. **Mobile tests are not run.** The portal job is duplicated. |
| Deploy workflow | 🟡 | Deploys a tag but resets compose to `origin/main` |
| Migrations | 🟡 | `schema.prisma` needs `DIRECT_DATABASE_URL`, but `.env.example`, staging and CI don't set it |
| Backups | ❌ | Local, unencrypted `pg_dump` only. No off-site copy, no point-in-time recovery. |
| Alerting | ❌ | Alertmanager doesn't expand `${ALERT_WEBHOOK_URL}`, so no alert is ever delivered |
| `services/ml-service` (Python) | ❌ (dead) | Deployed but nothing calls it |
| Keyword-training pipeline | ✅ | Reproducible; synthetic voices |
| `packages/shared` | 🟡 | Used by 5 API files only. Its `lint` script fails, which fails the root `npm run lint`. |
| Observability | 🟡 | Prometheus, Sentry (API only) and health routes are in place. No Grafana dashboards. Scrapes only one API replica. |
| Secrets in git | ✅ | Only the `.env.example` files and the Firebase client config (key should be restricted) |
| Docs and repo hygiene | 🟡 | `README.md` is a 15-byte placeholder. 11 dated report files sit at the root. `type-check-report.txt` (July, 81 errors) is stale. The detection thresholds in `docs/EMERGENCY_DETECTION.md` were wrong and are **corrected in this pass**. |

---

## 5. All other bugs

**Medium**

- **API M1:** the location replay timestamp is stripped by the schema (§4.2).
- **API M2:** soft-alert race between cancel and escalate.
- **API M3:** escalation is silently lost when the queue is down.
- **API M4:** payments are closed without asking the gateway (§4.2).
- **API M5:** admin edit-user ignores the password; admin delete-user fails for real users.
- **API M6:** responders can't join the alert room.
- **Mobile M1:** shared location task. Leaving Safe Route stops SOS tracking, and vice versa.
- **Mobile M2:** Active SOS disconnects the app-wide socket. Responders stop getting dispatch events until the app restarts.
- **Mobile M3:** SOS state is lost on restart.
- **Mobile M4:** Home SOS has no GPS timeout.
- **Mobile M5:** logout doesn't revoke the refresh token on the server.
- **Mobile M6:** the committed `apps/mobile/android/` folder is from July. It lacks today's permissions, the microphone service type and the deep-link scheme. If EAS builds from it, everything in `app.json` is ignored. Delete it, or run `expo prebuild --clean`.
- **Mobile M7:** the responder availability switch never saves (§4.1).
- **Portal M1:** UI permission gating is off (§4.3).
- **Portal M2:** "Active emergencies" is always 0.
- **Portal M3:** Responders "Delete" looks like it does nothing.
- **Portal M4:** the email edit is dropped.
- **Portal M5:** Incidents has no live updates on a cold load.
- **Portal M6:** Alert details re-fetches routes on every render.
- **Infra M1:** TURN is off in production.
- **Infra M2:** retention may never run.
- **Infra M3:** the 1 req/s per-IP limit on `/auth/refresh` hurts carrier NAT (CGNAT) users.
- **Infra M4:** nginx caches the API's IP at startup, which gives 502s after the API container is recreated.
- **Infra M5:** `DATABASE_URL` is defined twice in `.env.production.example`.

**Low**

- Two toasters.
- Any user edit logs that user out.
- A failed SMS is counted twice in logs and metrics.
- `role:'police'` causes a 500.
- Deleting a gateway strands its pending payments.
- A Twilio ICE token is minted on every request.
- The mobile deep link fails on a cold start.
- Offline-SOS resend leaves out the name.
- Motion sensors run with the toggle off.
- The incident location is rounded twice. It ends at ~1 km; the code comment says ~111 m.
- Duplicate and unreferenced infra files (`infra/github-actions`, `infra/nginx`, `infra/docker`, `deploy/scripts/healthcheck.sh`).

---

## 6. Security blockers from 17 September

| # | Blocker | Status |
|---|---|---|
| B1 | An admin can give themselves or others any permission (no body schema; permissions written as given) | **Open**: `admin.controller.ts:45`, `admin.repository.ts:81-83` |
| B2 | Default password `default123!` for admin-created users | **Open**: `admin.repository.ts:40` |
| B3 | Rate limits bypassed with a spoofed `X-Forwarded-For` (no `trustProxy`) | **Open**: `rate-limit.ts:58-61` |
| B4 | No phone OTP, no trusted-contact verification | **Open** |
| B5 | Static TURN password handed to every user; the relay can reach internal Docker hosts | **Open** (unless Twilio ICE is configured) |
| B6 | Evidence served by an unauthenticated `/evidence/mock-s3/*` route whose `expires=` is never checked | **Open in local-storage mode** (fixed with S3/R2). Also exposes incident media in local mode. |

New security findings in this pass: **password-hash leak (#7)**, **evidence IDOR (#9)**, unauthenticated payment cancel (API M4), and no admin portal CSP.

---

## 7. Incomplete or not built

- No way to **resolve or close** an alert (API or portal). The user's only end state is `false_alarm`.
- Mobile Settings: push / background-location switches and change password (stubs).
- Safety map draws no map. Evidence library has no delete. Fake call has no ringtone. Offline SOS doesn't send an online SOS when the connection returns.
- Motion model needs real training data. Keyword models need real voices. Shout recall is unmeasured.
- Roles have no real permission model behind custom roles.
- Users and audit logs have no paging.
- `services/ml-service` is unused: wire it up or delete it.
- Sentry is missing in the mobile app and portal. No Grafana dashboards.

---

## 8. Store-release risks (Google Play / App Store)

- **`SEND_SMS`:** needs a Play Permissions Declaration, and approval is not guaranteed for a non-default SMS app. Keep the server SMS and the composer as fallbacks.
- **`USE_EXACT_ALARM` / `SCHEDULE_EXACT_ALARM`:** declared but unused, and restricted to alarm apps. Remove both.
- **Background location:** needs a declaration and video, and a prominent in-app disclosure *before* the request. The SOS path asks without one.
- **Foreground services (microphone, location):** need the Play FGS declaration and video, and the Data Safety form must list microphone and video streaming.
- **Subscriptions through SSLCommerz/Stripe:** probably need Play Billing / Apple in-app purchase for a digital service. Check this before release.
- **`usesCleartextTraffic: true`** and the user-editable server address in release builds.

---

## 9. Before your next run

In `services/api`:

```
npx prisma migrate deploy      # payments + incident_media tables
npx prisma generate            # your client is from 11 Oct
```

Then restart the API, restart the admin portal, and make a new native mobile build (`npx expo prebuild --clean` first, see Mobile M6).
