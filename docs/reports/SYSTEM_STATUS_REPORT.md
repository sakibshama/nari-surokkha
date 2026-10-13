# Nari Surokkha — System Status Report

_Deep code audit · 24 Jul 2026 · what is pending or not properly working_

This is a full-repo sweep (mobile app, API, admin/police portals, ML service,
training) for mocks, stubs, placeholders, dead code, and half-wired features.
Items are grouped by **severity for a real deployment**, most serious first.

---

## A. Genuinely not working (mocked / fake logic)

### 1. Server ML service is entirely mocked — but mostly dormant
`services/ml-service/main.py` returns **random numbers**, not real inference:
- `/analyze-audio` → `random.uniform(...)`
- `/analyze-motion` → `random.uniform(...)`
- `/safe-route` → a straight geometric midpoint, fixed "15 mins", fixed "85.5" score

Reality check on impact: motion detection was moved **on-device** (real trained
model), and audio detection is on-device too. So the API no longer calls
`/analyze-motion` or `/analyze-audio` at all — those two mock endpoints are
**dead weight**. The **only live path** that still hits the mock service is:

### 2. Safe Route is fake end-to-end ⚠️ (live mock)
`alerts.service.ts → getSafeRoute()` calls the mock `/safe-route`, so
`SafeRouteScreen` shows a **fake three-point zig-zag** with a hardcoded time and
safety score. It looks like it works but the route is meaningless. Real routing
needs a routing engine (OSRM/Google Directions) + a safety-weighting layer over
incident data. **Status: not real. Label it "beta" or hide it until built.**

### 3. Admin "ML Tuning" page doesn't persist
`admin-portal/src/pages/MLTuning.tsx` — the save handler is a mock; there is no
backing table for those tuning knobs. Sliders move, nothing is stored. (Note:
`MLModels.tsx`, the model-registry/OTA page, **is** real — don't confuse the
two.) **Status: cosmetic only.**

---

## B. Real but inert — needs a native piece or external config to actually fire

### 4. Audio distress detection — blocked on the raw-PCM bridge
The model is trained, shipped, parity-verified, and `AudioProcessor` is wired
into the Home screen. But it **skips inference** because Expo records to an m4a
file, not raw PCM samples, and no `setPcmProvider(...)` is registered. So today
it never raises a voice alert (and, deliberately, never a false one — the old
`Math.random()` was removed). **To activate:** add a native audio-stream module
(`react-native-live-audio-stream`) and register the provider. Until then, keep
voice detection labelled "beta". _(Full detail in `services/ml-training/TRAINING_AND_UPDATE_GUIDE.md` §7c.)_

### 5. Audio real-data retraining can't collect yet
`audio_pull_samples.py` expects clips uploaded from devices, but there is **no
audio sample uploader** in the app (the motion one, `motionSampleUploader.ts`,
exists and works). Follows directly from #4 — no PCM, nothing to upload. So the
audio model is stuck on synthetic data until #4 is done and an uploader is added.

### 6. Push notifications need credentials + an EAS upload
Firebase code path is complete (Expo tokens + FCM). It stays silent until you
set `FIREBASE_*` env vars on the server **and** upload the FCM key to EAS
credentials. Config, not code. _(Tracked from earlier.)_

### 7. Cross-network live streaming needs the TURN password set
WebRTC + coturn are configured, but `TURN_PASSWORD` must be set in the server
env **and** in the three client files (currently `CHANGE_ME_turn_password`).
Until then, streaming works same-network only. Config, not code.

---

## C. Dead code — misleading, not broken (safe to delete)

These are defined but **imported nowhere**, so they don't affect the running
app. They're worth removing because they look like real features:

- `apps/mobile/src/services/ml/SensorsManager.ts` — a mock that "dispatches"
  hardcoded motion/audio to the server every 5s and just `console.log`s. The
  **real** path is `MotionMonitor` → `SensorProcessor` (on-device model), which
  **is** wired into Home and correctly navigates to SoftAlert on a >0.85
  emergency. `SensorsManager` is leftover scaffolding.
- `apps/mobile/src/components/StreamingView.tsx` — a "🔴 LIVE BROADCASTING"
  visual **placeholder** with no WebRTC. Real streaming lives in
  `ActiveSosScreen`. This component is unused.

---

## D. Minor / by-design

- `offlineSos.ts` — SMS-to-999 is **intentionally disabled** for pilot mode
  (documented in code). Correct as-is; re-enable at official launch.
- `socket.ts` — alert location updates go over HTTP, not WebSocket ("fine for
  now, WS is lower-latency"). Works; just not optimal.
- `ProfileSetupScreen.tsx` — passes `0,0` as a location stub if GPS is
  unavailable during profile save. Low-risk (profile, not SOS), but worth a
  guard.
- Hundreds of `placeholder=`/`disabled=` matches in the portals are ordinary
  input hints and button states — **not** issues.

---

## E. Known gaps carried from before (not code bugs)

- **No end-to-end tests.** Unit tests exist for the API; there is no full
  SOS→dispatch→SMS→stream E2E test.
- **Single API instance for sockets.** Scaling past one API process needs the
  Redis Socket.IO adapter; fine for pilot load.
- **SMS delivery confirmation** isn't surfaced back to the user beyond
  send/failed status.

---

## Priority recommendation

| # | Item | Type | Priority |
|---|------|------|----------|
| 2 | Safe Route is fake | live mock | **High** — mark beta / hide, or build real routing |
| 4 | Audio PCM bridge | native piece | **High** if voice detection is a launch feature |
| 6 | Firebase creds + EAS | config | **High** — push is core to alerts |
| 7 | TURN password | config | **High** — needed for distributed APKs |
| 3 | ML Tuning persistence | mock | Medium |
| 5 | Audio uploader | feature | Medium (after #4) |
| C | Delete dead code | cleanup | Low but easy |
| E | E2E tests / scaling | hardening | Before wider rollout |

**Bottom line:** the core SOS flow (GPS → alert → dispatch → SMS → same-network
streaming) and the on-device **motion** model are real and working. The main
"looks real but isn't" trap is **Safe Route**. The main "ready but switched off"
items are **audio detection** (needs the native PCM bridge) and two **config**
steps (Firebase, TURN). Two files are dead scaffolding worth deleting.
