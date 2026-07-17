# Nari Surokkha — Motion Model Training

On-device motion detection (fall / struggle) for the mobile app. The model is
tiny (~20 KB), runs **entirely on the phone** (no server round-trip for
inference), and is retrained from **real device data** as it is collected.

## What the model does

Input: a 2-second window of 6-axis IMU data at 50 Hz — `[ax, ay, az, gx, gy, gz]`,
shape `(100, 6)`. On device this window is reduced to a fixed feature vector
(`features.py` / `features.ts` — identical math), then classified into:

| class      | emergency? |
|------------|------------|
| `normal`   | no  |
| `walking`  | no  |
| `fall`     | **yes** |
| `struggle` | **yes** |

If `fall` or `struggle` wins with high confidence, the app raises a soft alert.

## Files

| file | purpose |
|------|---------|
| `config.py` | shared constants (window size, sample rate, classes) — keep in sync with `apps/mobile/src/services/ml/modelConfig.ts` |
| `features.py` | feature extraction — **source of truth**, mirrored in `features.ts` |
| `synthetic.py` | generates realistic synthetic windows to bootstrap v1 |
| `train.py` | builds dataset → trains MLP → exports `motion_model.json` (+ optional `.tflite`) |
| `pull_samples.py` | downloads real labelled windows collected from devices |

## Quick start

```bash
pip install -r requirements.txt

# 1) Train v1 from synthetic data
python train.py --out models

# 2) Ship it: copy the model into the app + register it on the backend
cp models/motion_model.json ../../apps/mobile/assets/models/motion_model.json
#   then upload models/motion_model.json in the Admin Portal → ML Models (OTA)
```

## Retraining with real data (the loop)

1. Devices upload labelled windows automatically:
   - **positive** (`fall`/`struggle`) when a user confirms a real SOS,
   - **negative** (`normal`) when a user dismisses a false auto-alert.
2. Pull them down and retrain:

```bash
export API_URL=https://api.narisurokkha.com/api/v1
export ADMIN_TOKEN=<admin JWT>
python pull_samples.py --out data/real      # -> data/real/real_samples.npz
python train.py --real data/real --out models
```

3. Upload the new `models/motion_model.json` in **Admin Portal → ML Models**
   and click **Activate**. Phones pick it up over-the-air on next launch — no
   app-store release needed. A copy stays bundled in the app as a fallback.

## Optional: TensorFlow Lite export

`python train.py --tflite` also writes `models/motion_model.tflite` (needs
`pip install tensorflow`) for the `react-native-fast-tflite` path. The JSON
model is the default and requires no native runtime.
