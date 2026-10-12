# Nari Surokkha — Full Application Review

**Date:** 12 October 2026
**Code reviewed:** branch `feat/remove-police-mobile-redesign` (HEAD `9ec936c`) **plus your uncommitted work** (the subscription feature and edits to 12 files). That uncommitted work was not changed, except where this review says so.
**Previous reviews:** `PRODUCTION_REVIEW_2026-09-17.md` (security and release), `PERFORMANCE_SCALABILITY_RATING_v4.md` (performance). This review covers features. It does not repeat those reviews.

---

## 1. Verdict in one paragraph

The core safety loop works in code. Manual SOS, offline SMS fallback, live tracking, trusted contacts, the responder hub, the admin portal and the API are all present and type-check cleanly. Two things were not real, though. **Automatic danger detection was not real.** The audio model was trained only on synthetic waveforms. Its microphone path also idled whenever the native PCM module was missing. In practice it detected nothing. The motion model was also trained only on synthetic data. **The soft-alert screen had four bugs that could lose or fake an SOS.** This change replaces the audio detection with real on-device models for Shout, "Help", Crying and "Bachao" (বাঁচাও), rebuilds the 15-second soft alert, and fixes those bugs. One serious problem remains, and it sits in your uncommitted subscription work: **SOS SMS to trusted contacts is silently skipped for any user without an active paid subscription** (§4, item 1).

---

## 2. How the review was done

| Check | Result |
|---|---|
| `tsc --noEmit` — mobile | **0 errors** (before and after this change) |
| `tsc --noEmit` — admin portal | **0 errors** |
| `tsc --noEmit` — API | Errors only from the Prisma client not being generated. `prisma generate` cannot download its engine in this sandbox (binaries.prisma.sh is blocked). This is environmental. |
| API unit tests (`vitest --project unit`) | **68 passed, 6 failed.** All 6 failures are in `notifications.unit.test.ts` and are caused by the uncommitted subscription gate (§4, item 1). Two more files could not load without the Prisma client. |
| Mobile tests (new, `npm test` in apps/mobile) | **21 passed, 0 failed**: 19 logic tests and 2 full-pipeline tests on real audio with the shipped models (§6) |
| `expo prebuild --platform android` | Succeeds. The new config plugin produces the `microphone` foreground-service declaration (checked in the generated AndroidManifest). |
| Endpoint cross-check | Every endpoint called by the mobile app and the admin portal exists in the API. |
| Read-through | Mobile: all screens and services. API: alerts, notifications, worker, evidence, auth, admin, ml, settings, subscriptions. Admin portal: pages and API calls. |
| Device test | **Not done by me.** Your PC has no Android SDK, adb or attached phone, and the sandbox cannot reach Google's Android/Gradle servers, so no APK could be built or installed here. §7 gives the exact on-phone test steps. |

---

## 3. Feature status

**Legend:** ✅ implemented and working in code · 🟡 incomplete or stubbed · ❌ broken · 🔧 fixed in this change

### 3.1 Mobile app (Expo SDK 56, React Native 0.85)

| Feature | Status | Notes |
|---|---|---|
| Login / register, token refresh | ✅ | No phone OTP (security blocker B4 from the September review is still open) |
| Home: one-tap SOS (online) | ✅ | Real GPS fix required, clear error messages |
| SOS offline fallback (SIM SMS, silent on Android) | ✅ | Uses the cached trusted contacts |
| Active SOS: live location, WebRTC audio/video to responders, evidence photo | ✅ | |
| Background location during SOS | 🔧 | `FOREGROUND_SERVICE_LOCATION` was missing from the manifest. Android 14+ refuses a location foreground service without it. Added. |
| Trusted contacts | ✅ | Contacts are not verified (B4) |
| **Silent alert (15 s soft alert, manual)** | 🔧 | Rebuilt (see §5) |
| **Automatic soft alert from sound** | ❌ → 🔧 | The old model was trained on synthetic data, and inference was skipped when no PCM provider existed. Replaced by real models (see §5). |
| Automatic soft alert from motion (fall / struggle) | 🟡 | Runs, but `motion_model.json` reports `dataSource: synthetic`. Its 99.9 % accuracy is on synthetic data and says nothing about real falls. It now goes through the same soft-alert manager (deduplication, cooldown, history). It needs real labelled data. |
| Soft alert → SOS escalation | 🔧 | See the four bugs in §5.1 |
| Fake call | ✅ | Vibration and on-screen UI only. No ringtone sound. |
| Safe route (OSRM) + deviation alert | ✅ / 🟡 | Defaults to the public OSRM demo server, which is not allowed for production (S6) |
| Safety map, report incident | ✅ | |
| Evidence library | ✅ | |
| Responder hub (dispatch accept/decline) | ✅ | |
| SMS history | ✅ | |
| Subscription (bKash/SSLCommerz) | 🟡 | Uncommitted work in progress. See §4, item 1. |
| Settings → theme, language | ✅ | |
| Settings → "Push notifications", "Background location" switches | 🟡 | Local state only. Nothing reads them, and the code says so in a TODO. |
| Settings → detection switches | 🔧 | The old store was not persisted, so a switch you turned off came back on after a restart. It is now persisted. |
| Settings → Change password | 🟡 | Shows "once it is wired up". The API endpoint `/auth/change-password` exists, and the admin portal uses it. |
| English / Bangla, light / dark | ✅ | 109 new Bangla strings added for this feature |
| Web build | ✅ | Detection correctly reports "phone app only" |
| Automated tests | 🟡 → 🔧 | There were none. There are now 19 logic tests plus model tests. |

### 3.2 API (Fastify + Prisma + PostGIS + BullMQ)

| Area | Status | Notes |
|---|---|---|
| Auth, refresh-token rotation, revocation, login backoff | ✅ | Rate-limit IP spoofing (B3) still open |
| Alerts: SOS, location trail, share, cancel | ✅ | |
| Soft alerts: create / cancel / confirm + 30 s server-side auto-escalation | ✅ / 🔧 | The confirm response schema stripped `trackingToken` and `contactPhones`, so the app never received them. Fixed. Audio-triggered alerts are now stored as `ml_triggered`, not `sensor_triggered`, so the admin portal can tell them apart. |
| Trusted-contact notifications (SMS + push, queued, idempotent) | ❌ (uncommitted code) | See §4, item 1 |
| Responders, dispatch | ✅ | |
| Incidents, safety score | ✅ | |
| Evidence storage (local / S3 / R2), retention | ✅ | B6 (public non-expiring local URLs) still open |
| Admin, RBAC, audit log | ✅ | B1 (self-escalation) and B2 (default password) still open |
| Public tracking page `/t/:token` | ✅ | |
| ML model registry / samples | ✅ | `/ml/samples` has no schema or quota (S10) |
| `services/ml-service` (Python) | 🟡 | Still not called by anything (S13) |
| Subscriptions (SSLCommerz) | 🟡 | Uncommitted. Not reviewed for payment security. |

### 3.3 Admin portal (React + Vite)

| Page | Status |
|---|---|
| Login, Dashboard, Alerts + detail, Analytics, Audit logs, Incidents, Responders, Roles, Users, Settings (SMS provider, SMS template, maps key) | ✅ All API calls resolve to existing routes |
| Tests | 🟡 None |
| Token storage | 🟡 Access token kept in `localStorage` (S8) |

### 3.4 Infrastructure

Docker compose, Postgres/PostGIS, Redis, PgBouncer, worker split, observability and CI are in place (see the August review). Still open from September: Node 20 end-of-life base image, root user in the image, TURN relay credentials (B5), and no point-in-time recovery.

---

## 4. Problems found that this change does NOT fix (your decision needed)

1. ~~**Critical: SOS SMS is silently skipped without an active subscription**~~ — **fixed (12 Oct, follow-up).**
   Contact SMS now works like this:
   - **The plan has SMS quota:** the server sends the SMS and counts it.
   - **The quota is used up, the plan has expired, or there is no plan:** the server does not send the SMS. The SOS response carries `smsViaDevice: true` and `deviceSmsMessage` (the admin template with a live `/t/` tracking link), and **the phone texts the contacts from its own SIM**, like the offline fallback. Push to contacts who have the app still goes out from the server.
   - **The phone cannot send it** (no SMS permission, iOS, app in the background with no composer, or the user cancelled the composer): the app calls `POST /alerts/:id/sms-fallback`, and the server sends the SMS anyway.
   - **The server's own 30 s soft-alert escalation** always sends from the server, because nobody is answering on the phone.
   - **The quota cannot be read:** the server sends (fail-open).
   - A failed quota write no longer marks a delivered SMS as failed, which used to cause duplicate texts.

   Tests: API 88 / 88 unit tests pass (12 new); mobile 23 / 23.
2. Security blockers **B1–B6** from the 17 September review are all still open: admin self-escalation, default password `default123!`, `X-Forwarded-For` rate-limit bypass, no phone or contact verification, the static TURN password, and public non-expiring evidence URLs.
3. The motion (fall/struggle) model is trained on synthetic data only (see the table above).
4. `USE_EXACT_ALARM` is still requested. Google Play is likely to reject it for a non-alarm app.
5. Mobile Settings has three non-functional controls: push notifications, background location, and change password.

---

## 5. What this change implements

Full technical documentation is in **`docs/EMERGENCY_DETECTION.md`**. In short:

- **On-device detection of Shout/scream, Crying, "Help" and "Bachao" (বাঁচাও)** from the live microphone. No audio is recorded or uploaded.
  - Shout and crying: **Google YAMNet** (AudioSet, 521 sound classes), run every 0.5 s.
  - "Help" and "Bachao": **Google's speech-embedding model** (the openWakeWord front-end) plus a **keyword classifier trained for this app** on about 1,000 synthetic voices in English, Bangla, Hindi and Nepali, with augmentation and hard negatives. Evaluation is in §6.
  - Everything runs through `react-native-fast-tflite`, which was already a dependency.
- **The automatic 15-second soft alert:** vibration, a full-screen countdown, and a notification with "I'm safe" / "Send SOS now" buttons that work from the lock screen. The server soft alert is created in parallel. If the countdown expires, the alert escalates to an SOS. If the server is unreachable, the phone texts the trusted contacts itself.
- **Separate controls for each trigger:** on/off and Low/Medium/High sensitivity for each of the four triggers, a master switch, background listening, the cooldown after "I'm okay", and live meters with a test alert.
- **Permissions screen:** microphone, notifications, location, background location, with Allow or Open settings for each.
- **Background monitoring (Android):** a foreground service of type `microphone`, which Android 14 requires. iOS uses the `audio` background mode.
- **Duplicate prevention:** per-trigger refractory period (8 s), one soft alert at a time (repeat detections are counted on the active alert), a cooldown after "I'm okay", and suppression while an SOS is active.
- **Alert history:** on the phone (300 entries) with trigger, confidence, outcome, duration, background flag and merged duplicates, plus filters and clear. On the server, every soft alert stores `mlMetadata` (trigger, confidence, detector version).

### 5.1 Bugs fixed on the way

| Bug | Effect | Fix |
|---|---|---|
| The soft alert reached 0 with no server alert yet (slow GPS, no permission, offline) | **Nothing happened at 0. No SOS was sent.** | Confirm now waits up to 8 s for the server alert, then creates a direct SOS, then falls back to SIM SMS |
| "I'm okay" pressed while the server alert was still being created | The server alert stayed `created` and the server **auto-escalated it to a real SOS 30 s later** | A late-arriving server alert is cancelled the moment it exists (covered by a test) |
| Detections every 5 s kept navigating to SoftAlert | Stacked countdown screens and multiple alerts | A single SoftAlertManager owns the alert and deduplicates |
| The confirm response schema stripped `trackingToken` and `contactPhones` | The phone-side SMS never had numbers | Schema fixed |
| SMS link used `https://narisurokkha.app/track?token=<JWT>` | That domain/route does not exist, and the JWT is not resolvable by `/t/:token` | The phone fallback SMS now carries a Google Maps link |
| The countdown ran only while the screen was mounted | Leaving the screen or locking the phone stopped the escalation | The countdown lives in the manager and runs in the background |
| `react-native-live-audio-stream` (native) | `init()` leaked an AudioRecord each call; `start()` could throw on the JS thread (a crash) if the mic was busy or permission was missing; short reads emitted stale samples; `stop()` never resolved | `patches/react-native-live-audio-stream+1.1.1.patch`, applied by `patch-package` on install |
| `TriggerDecider` refractory started at time 0 | Would have suppressed the first detection in tests | Fixed (found by the new tests) |
| ML settings not persisted | Switches reset on restart | Persisted |

---

## 6. Detection accuracy (measured here, not on a phone)

Full tables are in `services/ml-training/keywords/REPORT.md`. The test voices were **held out**: none of them were used in training.

Default (Medium) sensitivity:

| | "Help" | "Bachao" |
|---|---|---|
| Recall, quiet → 5 dB SNR noise | 93 % → 75 % | 94 % → 82 % |
| False alerts, continuous speech in noise (0.63 h, ⅓ confusable words) | 0 / h | 1.6 / h (1 event) |
| Isolated utterances that falsely alerted (1,096) | 0.9 % (both keywords together) | |

YAMNet caught the real crying recording, raised no shout or cry alert on 12 other real sound recordings, and raised none on 0.27 h of speech at normal and loud levels. In the full-pipeline test, one real dog/rooster recording triggered "Help".

**What this does not prove:** the keyword test voices are synthetic, though never seen in training. **Shout recall was not measured**, because no real recordings of people shouting or screaming could be downloaded in this environment (Kaggle, Hugging Face, AudioSet and Freesound are all blocked). Expect lower numbers on real frightened speech until the head is retrained with real recordings. The pipeline for that is in the repo.

---

## 7. What you need to do to test it on a phone

See `docs/EMERGENCY_DETECTION.md` §7 for the checklist. In short:

```bash
npm install --legacy-peer-deps          # applies the native patch (postinstall)
cd apps/mobile
eas build --profile development --platform android   # or: npx expo prebuild --clean && npx expo run:android
```

It must be a development or store build, not Expo Go (it contains native modules). Your local `apps/mobile/android/` folder predates this change. Regenerate it with `npx expo prebuild --clean` before any `expo run:android`.
