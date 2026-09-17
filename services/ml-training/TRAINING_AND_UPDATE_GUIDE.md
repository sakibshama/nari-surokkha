# Nari Surokkha — ML Model: Training & Update Guide

_Last trained: 24 Jul 2026 · motion model v1 (acc 0.9992) · audio model v1 (acc 0.999) — both synthetic_

This document records what was done and — importantly — the exact steps to
**update the model in the future**.

There are **two on-device models**, built the same way (pure-TypeScript JSON
model, no native runtime, OTA-updatable, strict Python↔TS feature parity):

| model | file prefix | classes | detects |
|-------|-------------|---------|---------|
| **motion** | `motion_*` / `config.py` | normal, walking, fall, struggle | falls & physical struggle from IMU |
| **audio**  | `audio_*` / `audio_config.py` | background, speech, scream, distress_keyword | screams & shouted distress words from the mic |

Sections 1–6 below cover the **motion** model. Section 7 covers the **audio**
model (its training loop is identical — same commands with `audio_` prefixes).

---

## 1. What was done

The **on-device motion model** (fall / struggle detection) was trained and
shipped:

- Set up the Python training environment (`numpy`, `scikit-learn`).
- Ran `python train.py --out models` → generated a fresh
  `motion_model.json` from 6,000 synthetic windows (1,500 per class).
- Result: 4-class MLP (24 features → 32 hidden ReLU → 4 softmax),
  **test accuracy 0.9992** on held-out synthetic data.
- Verified **feature parity**: `features.py` (training) and
  `apps/mobile/src/services/ml/features.ts` (device) produce the identical 24
  features in the identical order — this is what lets a Python-trained model run
  correctly on the phone.
- Shipped it into the app: copied to
  `apps/mobile/assets/models/motion_model.json` (the bundled fallback), and
  validated the copy is well-formed JSON.

> **Note on accuracy:** 0.99 is on *synthetic* data and only proves the pipeline
> works — it is NOT real-world accuracy. Real accuracy comes from the
> real-data retraining loop (§3), once devices have collected labelled windows.

### The model in one line
Input: 2-second window of 6-axis IMU @ 50 Hz `[ax,ay,az,gx,gy,gz]` (shape
100×6) → 24 features → MLP → `{normal, walking, fall, struggle}`. `fall`/
`struggle` with high confidence → the app raises a silent alert. Runs entirely
on the phone, no server round-trip.

---

## 2. How to UPDATE the model — quick retrain (synthetic)

Use this to regenerate the model or after tweaking the synthetic generator /
architecture. Runs on any machine with Python (not the VPS).

```bash
cd services/ml-training
python -m venv .venv && .venv\Scripts\activate      # Windows
pip install -r requirements.txt                      # numpy + scikit-learn

python train.py --out models                         # trains → models/motion_model.json
copy models\motion_model.json ..\..\apps\mobile\assets\models\motion_model.json
```

Then either:
- **Ship in the next APK** — commit the updated JSON, `eas build`. Every new
  install gets it. OR
- **Push over-the-air** to already-installed phones — see §4.

---

## 3. How to UPDATE with REAL data (the loop that makes it accurate)

Devices automatically upload labelled windows:
- **fall/struggle** window saved when a user confirms a real SOS,
- **normal** window saved when a user dismisses a false auto-alert.

Once enough have accumulated, pull and retrain:

```bash
cd services/ml-training

# 1. Get an admin JWT (log into the admin portal, or:)
curl -s -X POST https://api.mystrix-soft.com/api/v1/auth/login ^
  -H "Content-Type: application/json" ^
  -d "{\"phone\":\"+8801912345600\",\"password\":\"YOUR_ADMIN_PASSWORD\"}"
#   → copy data.tokens.accessToken

# 2. Point at production + set the token
set API_URL=https://api.mystrix-soft.com/api/v1
set ADMIN_TOKEN=<paste accessToken>

# 3. Pull real windows, then train on synthetic + real
python pull_samples.py --out data\real            # → data/real/*.npz
python train.py --real data\real --out models     # combines synthetic + real

# 4. Ship it (see §2 copy line, then §4 for OTA)
```

Repeat this loop periodically — accuracy improves each cycle, with **zero app
releases** if you use OTA (§4).

---

## 4. Pushing an update Over-The-Air (no app-store release)

Installed phones fetch the newest model on next launch. To make them pick up a
new model you must **bump the version**, otherwise they keep the one they have.

1. Edit `services/ml-training/config.py` → increase `MODEL_VERSION` (e.g. `1` → `2`).
2. Retrain (`python train.py --out models`) — the exported JSON now carries the
   new version.
3. In **Admin Portal → ML Models** → upload `models/motion_model.json` →
   **Activate**.
4. Phones compare their cached version to the server's active version on launch;
   if the server's is newer, they download and swap it in. The bundled copy in
   the APK stays as a permanent offline fallback.

**Rule of thumb:** bundle refresh (same version) = shipped only in new APKs;
version bump + Admin upload = reaches existing installs OTA.

---

## 5. The ONE rule you must never break: feature parity

The model only works if the phone computes features **byte-for-byte identically**
to training. Two files are a matched pair:

- `services/ml-training/features.py`  ← source of truth (training)
- `apps/mobile/src/services/ml/features.ts` ← must mirror it exactly (device)

If you add/remove/reorder a feature or change any math in one, **mirror it in the
other and retrain**. A mismatch causes silent mis-prediction (no crash, just
wrong answers) — the most dangerous kind of bug for a safety model. After any
change, re-verify: the model's `featureNames` array must equal the order
`features.ts` returns.

Also keep in sync when changed: `config.py` ↔
`apps/mobile/src/services/ml/modelConfig.ts` (window size, sample rate, channel
order, class list).

---

## 6. Optional: TensorFlow Lite export

The default JSON model needs no native runtime. If you later want the
`react-native-fast-tflite` path (e.g. for a bigger model):

```bash
pip install tensorflow
python train.py --tflite --out models    # also writes models/motion_model.tflite
```

---

## 7. The AUDIO distress model

Built and shipped, mirroring the motion pipeline exactly. It listens to 3-second
mic chunks (16 kHz mono) and classifies `background / speech / scream /
distress_keyword`; `scream` and `distress_keyword` raise a soft alert.

### 7a. What was done
- Extracts **26 acoustic features** per clip — 8 log-mel band energies + RMS,
  zero-crossing rate, spectral centroid, rolloff and flatness, each summarized
  by mean & std across frames.
- Trained the same small MLP (26 → 32 ReLU → 4 softmax) on **4,800 synthetic
  clips**. **Test accuracy 0.999** (synthetic — pipeline proof, not field
  accuracy; see the caveat in §1).
- **Parity verified numerically**: the device port
  (`apps/mobile/src/services/ml/AudioFeatures.ts`) reproduces Python's features
  to ~4e-12 (floating-point noise). The mel filterbank and Hann window are
  **exported inside `audio_model.json`**, so the device uses the exact numbers
  training used — this removes filterbank-parity risk entirely.
- Shipped to `apps/mobile/assets/models/audio_model.json`. On-device pieces:
  `AudioFeatures.ts` (features + a self-contained FFT), `AudioClassifier.ts`
  (inference), `AudioModelLoader.ts` (bundled + OTA), `audioModelConfig.ts`.

### 7b. Update it — same commands, `audio_` prefix
```bash
cd services/ml-training
python audio_train.py --out models                 # synthetic retrain
copy models\audio_model.json ..\..\apps\mobile\assets\models\audio_model.json
```
Real-data loop and OTA are identical to §3–§4, using:
`python audio_pull_samples.py --out data\audio_real` →
`python audio_train.py --real data\audio_real --out models`, bump
`MODEL_VERSION` in **`audio_config.py`**, upload to Admin Portal → ML Models
(kind = `audio`) → Activate. Parity rule (§5) applies to the pair
`audio_features.py` ↔ `AudioFeatures.ts`.

> **Note (sandbox only):** on a normal machine `python audio_train.py` finishes
> in a few minutes. Synthetic *generation* is the slow part (voiced harmonics);
> feature extraction is fast.

### 7c. The remaining native piece — the raw-PCM bridge ⚠️
The classifier needs raw PCM **samples**, but Expo's recorder produces an encoded
file (m4a), and RN has no reliable pure-JS decoder. So `AudioProcessor.ts`
**skips inference until a PCM provider is registered** (it no longer fabricates
detections — the old `Math.random()` placeholder is gone). To activate voice
detection, add a native audio-stream module and wire it once:

```ts
import { audioProcessor } from './services/ml/AudioProcessor';
audioProcessor.setPcmProvider(async () => myLiveAudioStream.readClip()); // Float, 16kHz, ~3s
```
Recommended: `react-native-live-audio-stream` (emits base64 PCM16 → convert to
Float in JS). Until then, keep voice detection labelled **"beta"** in the UI.

### 7d. Safe Route (still a mock)
Not a trained model — the ML service returns a geometric mock. Real routing needs
a routing engine + a safety-weighting layer over incident data, not a classifier.

---

## Files in this folder

| file | purpose |
|------|---------|
| `train.py` / `audio_train.py` | build dataset → train MLP → export `*_model.json` (+ optional `.tflite`) |
| `synthetic.py` / `audio_synthetic.py` | synthetic data generators (bootstrap v1) |
| `pull_samples.py` / `audio_pull_samples.py` | download real labelled samples collected from devices |
| `features.py` / `audio_features.py` | feature extraction — **source of truth**, mirrored in the `.ts` ports |
| `config.py` / `audio_config.py` | shared constants (window/clip, rate, classes, `MODEL_VERSION`); audio also builds the mel filterbank |
| `models/motion_model.json`, `models/audio_model.json` | the trained models (also copied into the app) |
