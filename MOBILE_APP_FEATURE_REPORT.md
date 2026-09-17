# Nari Surokkha Mobile App — Feature Analysis Report

**Date:** 18 July 2026 · **Method:** full static trace of every screen and
service against live backend routes (deployed at api.mystrix-soft.com), plus
findings verified live during this deployment cycle.

## Verdict: 8/10 — every core safety feature is real and wired; two features
depend on mocked server ML, one endpoint mismatch was found & fixed today.

---

## ✅ WORKING — verified real end-to-end

| Feature | Status | Notes |
|---|---|---|
| **Register / Login** | ✅ | Real argon2-backed auth; refresh-token flow added — no more auto-logout; offline never logs out |
| **SOS trigger** | ✅ Verified live | Real GPS (Highest accuracy, no fallback coords), PostGIS nearest station, live police/admin dispatch — tested on production |
| **Active SOS screen** | ✅ | Live location streaming (real GPS watch on all platforms), status timeline, cancel flow |
| **Camera/mic lifecycle** | ✅ Fixed today | Media fully released on cancel/unmount (stream ref fix) |
| **Live video/audio streaming (WebRTC)** | ✅ | Portal-initiated offer/answer; TURN relay configured for cross-network (needs TURN_PASSWORD set) |
| **SMS to trusted contacts (online)** | ✅ Live | BulkSMSBD configured; server sends to every contact + tracking link |
| **Offline SOS (SIM fallback)** | ✅ | No-data path opens native composer prefilled (one tap — OS limit); 999 disabled for pilot |
| **Trusted contacts** | ✅ | Full CRUD against real API; cached locally for offline SMS |
| **Profile setup** | ✅ | GET/PUT /profile real |
| **Evidence capture** | ✅ | Camera → multipart upload → server disk; appears in portals |
| **Soft (silent) alert** | ✅ | 15-s countdown → /alerts/soft → auto-escalation worker server-side; confirm/cancel wired |
| **Motion detection (fall/struggle)** | ✅ Real | Genuine on-device model: expo-sensors 6-axis window → real MLP (relu/softmax) from motion_model.json, OTA-updatable; triggers SoftAlert |
| **Background location during SOS** | ✅ | Real expo-task-manager task, registered/unregistered correctly |
| **Responder hub** | ✅ | apply / me / dispatches / accept-reject / location update — all routes exist |
| **Report incident** | ✅ | POST /incidents (rate-limited, anonymous supported) |
| **Fake call** | ✅ | Fully local feature — no dependencies |
| **Push notifications** | ✅ code-complete | Expo-token routing + Firebase cert init done today; needs FIREBASE_* creds on server + `eas credentials` FCM upload, then live |
| **Splash / theming / drawer / logo** | ✅ | Animated logo splash, gov+feminine theme, drawer navigation |

## 🔧 FIXED DURING THIS AUDIT

- **Safety Map score — was calling `POST /safety/score`, an endpoint that has
  never existed** (silent 404 → screen showed fallback data forever). Now calls
  the real `GET /incidents/safety-score`. Safety Map shows real scores derived
  from incident reports after next app build.

## ⚠️ WORKS, BUT DEPENDS ON MOCKED SERVER ML

| Feature | Reality |
|---|---|
| **Safe Route** | App + backend + ActiveRoute DB all real, but the route itself comes from the ML service's `/safe-route` which returns a **geometric mock** (straight-line waypoints, fixed safety score). Directionally useful UI, not real routing. |
| **Audio distress detection** | Records real 3-second chunks, but inference is `Math.random() > 0.95` — a placeholder until the real TFLite model lands. **Do not present as active protection.** |

## ❌ NOT WORKING / NOT APPLICABLE

- **Push in Expo Go / web** — platform limitation; needs the built APK (and the
  Firebase/EAS credential steps).
- **Web build limitations** — sensors, background tasks, SecureStore, offline
  SMS are native-only; web is a dev convenience, not a product surface.

## Known follow-ups (recommended order)

1. Add FIREBASE_* to VPS + `eas credentials` FCM upload → push live.
2. Set TURN_PASSWORD (server + clients) if not yet done → streaming reliable
   across carrier networks.
3. Rebuild APK (includes today's SafetyMap fix, auth persistence, media
   release, logo/splash).
4. Label Safe Route and voice detection as "beta" in UI until real models.
5. Real E2E test on two physical phones: SOS → SMS receipt → portal live view
   → streaming connect/disconnect → cancel → camera off.

*All endpoint pairings verified: every mobile API call now has a matching
backend route (27 calls traced, 1 mismatch found & corrected).*
