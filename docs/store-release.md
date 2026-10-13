# Store release: declarations and open decisions

What Google Play (and later the App Store) will ask about before Nari Surokkha
can be published, what to submit, and the decisions that are still open.
Package / bundle id: `com.narisurokkha.app`.

Policies change; re-read the linked Play Console help pages when you submit.
Nothing here is legal advice.

---

## 1. Checklist

| # | Item | Where | Status |
|---|---|---|---|
| 1 | `SEND_SMS` permission declaration | Play Console → App content → Sensitive permissions | To submit; approval not guaranteed (§2) |
| 2 | Background location declaration + video | App content → Location permissions | To submit (§3) |
| 3 | Foreground service declarations (microphone, location) + video | App content → Foreground service permissions | To submit (§4) |
| 4 | Data safety form | App content → Data safety | To fill (§5) |
| 5 | Account deletion (in app **and** a web link) | App content → Data safety / Account deletion | Verify it exists before submitting (§5) |
| 6 | Payments policy decision | Product + legal | **Open decision** (§6) |
| 7 | Restrict the Firebase API key | Google Cloud console | To do (§7) |
| 8 | No unused restricted permissions (`USE_EXACT_ALARM`, `SCHEDULE_EXACT_ALARM`) | `apps/mobile/app.json` | Verify they are absent from the merged manifest of the release build |
| 9 | No cleartext traffic / no editable server address in release builds | mobile app | Verify in the release build |
| 10 | Fresh native project (`npx expo prebuild --clean`; `android/` and `ios/` are git-ignored) | EAS build | Every release |

---

## 2. `SEND_SMS`

The app sends the SOS text from the user's own SIM when it is offline or the
server SMS quota is used up. SMS permissions are restricted on Play to the
default SMS app, plus a list of permitted exceptions reviewed case by case.

- **Declare** in Sensitive permissions → SMS: core purpose "personal safety /
  emergency alert", explain that an SMS is sent **only** when the user
  triggers or confirms an SOS, only to contacts the user added, and only when
  the internet path is unavailable.
- **Video:** user adds a trusted contact → turns on airplane mode (mobile data
  off) → presses SOS → system SMS permission prompt (with the in-app
  explanation first) → SMS arrives on the contact's phone.
- **If it is rejected:** ship a build without `SEND_SMS`. The fallbacks
  already exist: server-side SMS (`/alerts/:id/sms-fallback`) and the system
  SMS composer (`expo-sms`), which needs one tap but no permission. Keep the
  code path behind a build flag so both variants can be built.

## 3. Background location

Needed so live tracking continues while an SOS (or Safe Route) is active with
the screen off.

- **Prominent disclosure before the runtime prompt** (Play requirement): a
  full-screen in-app explanation shown *before* `ACCESS_BACKGROUND_LOCATION` is
  requested, naming the feature, that location is collected in the
  background, and who receives it (responders, trusted contacts, the tracking
  link). The review found the SOS path requests it without that screen — fix
  before submitting.
- **Declaration form:** feature = "emergency SOS live tracking"; why
  foreground-only is not enough (the phone is usually in a pocket during an
  emergency).
- **Video (≤ 30 s, public/unlisted link):** disclosure screen → permission
  prompt → start SOS → lock screen → location keeps updating on the admin
  portal map.
- With foreground-only permission the app should still track while visible
  (fallback watcher) and must not claim "Live location transmitting" otherwise.

## 4. Foreground services (Android 14+)

Declared types: `microphone` (always-on emergency listening) and `location`
(SOS / Safe Route tracking). Each needs an entry in the Play Console's
foreground-service declaration with a video.

| Type | Task | User-visible evidence for the video |
|---|---|---|
| `microphone` | On-device detection of "Help" / "বাঁচাও", shouting, crying while the app is in the background | Settings → Emergency detection → background listening on → persistent "Nari Surokkha is listening" notification → lock phone → say "Help" → soft alert appears |
| `location` | Live location during an active SOS / Safe Route | Start SOS → notification "sharing your location" → lock phone → updates continue |

Explain that audio is processed **on the device** and never uploaded by this
feature, and that the user can turn background listening off at any time.
Android 14 also requires the microphone service to be started while the app
is in the foreground (handled in the app; see `docs/EMERGENCY_DETECTION.md` §5).

## 5. Data safety form

Answers as the app works today (re-check against the release build):

| Data type | Collected? | Shared? | Purpose | Notes |
|---|---|---|---|---|
| Precise + approximate location | Yes | Yes — responders and the user's trusted contacts, **at the user's request** (SOS) | App functionality (safety) | Also SOS tracking link recipients |
| Name, phone number, email | Yes | No | Account, app functionality | |
| Contacts | Yes (only the trusted contacts the user types/picks) | No | App functionality | Not the whole address book |
| Photos and videos | Yes (evidence, incident reports) | Yes — responders/admins handling the case | App functionality | Incident media can be anonymous |
| Audio | Evidence recordings only, if uploaded | As above | App functionality | Background detection audio is processed on device only (ephemeral, not collected) |
| Device or other IDs | Yes (push token) | No | Notifications | |
| Purchase history | Yes (subscription payments) | Payment processor | App functionality | Card data is entered on the gateway's page, never in the app |
| App activity / diagnostics | Motion training windows **only if** the user opts in | No | Analytics / product improvement | Opt-in (`mlDataSharingEnabled`) |
| Crash logs | Not from the app today (Sentry is API-only) | — | — | Update if mobile Sentry is added |

Also declare: data is **encrypted in transit**; users **can request deletion**.
Play requires an in-app account-deletion path **and** a web URL where a user
can request deletion without the app. Confirm both exist (and that deletion
covers evidence, location trails and contacts, subject to the retention rules
in `docs/DATA_PROTECTION.md`) before submitting.

## 6. Payments: SSLCommerz / Stripe vs Play Billing / Apple IAP — **open decision**

The app sells subscriptions that buy server-sent SOS SMS quota, paid through
SSLCommerz or Stripe in a browser (`docs/PAYMENTS.md`). Both stores generally
require their own billing for **digital goods and services consumed in the
app**, and a plan that unlocks an in-app capability is likely to be treated as
one. Options:

| Option | What it means | Pros | Cons |
|---|---|---|---|
| A. Play Billing + Apple IAP | Subscriptions sold as store products; server verifies purchase tokens / App Store receipts | Clearly compliant; one-tap purchase | 15–30 % store fee; new server verification work; local wallets (bKash/Nagad via SSLCommerz) not available in-app |
| B. Keep external gateways, purchase on the web only | Remove purchase UI and links from the app; users subscribe on a website; the app only shows status | No store fee; local payment methods | Worse UX; the app may not tell users where to pay (anti-steering rules); review risk if any link remains |
| C. Make SOS SMS free in the app | Fund server SMS by grants/partners or organisation accounts; nothing sold to end users in the app | No billing policy issue; best for a safety app | Needs a funding model |
| D. Alternative / user-choice billing programmes | Offer the external gateway alongside Play Billing where Google allows it | Lower fees, local methods | Country-limited enrolment; check whether Bangladesh is eligible at submission time; Apple equivalent is region-limited |

**Recommendation to evaluate first:** C for the core SOS function (a
paid-only emergency SMS path is also hard to defend in review), with A or B
for optional extras. Decide before the first public release; until then, hide
the purchase screen in store builds or ship to closed testing only.

## 7. Restrict the Firebase API key in `apps/mobile/google-services.json`

The key in `google-services.json` (Firebase project `nari-surokkha`) is a
client identifier, not a secret — it ships inside every APK. Restrict it so
it cannot be used from other apps or for other APIs:

1. Google Cloud console → select project **nari-surokkha** → *APIs & Services →
   Credentials*.
2. Open the key named like **"Android key (auto created by Firebase)"** (the
   value matches `current_key` in `google-services.json`).
3. *Application restrictions* → **Android apps** → add package
   `com.narisurokkha.app` with the **SHA-1** of:
   - the **app signing key** (Play Console → *Test and release → App integrity
     → App signing*), and
   - the **upload key** / EAS credentials SHA-1 (`eas credentials`) for
     internal builds; add a debug SHA-1 only to a separate dev key.
4. *API restrictions* → **Restrict key** → allow only the Firebase APIs the
   app uses (for push: *Firebase Cloud Messaging API*, *FCM Registration API*,
   *Firebase Installations API*). Save, then confirm a release build still
   registers for push.
5. Optional: enable **Firebase App Check** (Play Integrity) for the APIs that
   support it.
6. If the key was ever used elsewhere, rotate it in Firebase (Project settings
   → General) and rebuild with the new `google-services.json`.

The server-side Firebase credential (`FIREBASE_PRIVATE_KEY`) **is** a secret:
it lives only in `.env.production`, never in the repository.

## 8. App Store (iOS) — not started

iOS has not been built or tested. Expect: `NSLocationAlwaysAndWhenInUseUsageDescription`
and `NSMicrophoneUsageDescription` strings reviewed for clarity, background
modes (`location`, `audio`) justified in review notes, no `SEND_SMS`
equivalent (use the composer), and the payments decision in §6 (guideline
3.1.1).
