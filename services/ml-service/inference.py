"""
Real inference for Nari Surokkha's on-device models, run server-side.

Loads the SAME trained JSON models the mobile app ships
(motion_model.json, audio_model.json) and runs genuine feature extraction +
MLP forward pass — no random numbers. Feature math mirrors
services/ml-training/features.py and audio_features.py exactly; the audio mel
filterbank and Hann window are read straight from the model JSON, so this is
guaranteed consistent with training.

The models are small MLPs (scikit-learn layout): each layer W is [nIn][nOut],
out[j] = sum_i x[i]*W[i][j] + b[j]; hidden = ReLU, output = softmax.
"""

import json
import os
from functools import lru_cache

import numpy as np

MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")


# ─── model loading ──────────────────────────────────────────────
@lru_cache(maxsize=4)
def load_model(kind: str) -> dict:
    path = os.path.join(MODELS_DIR, f"{kind}_model.json")
    with open(path, "r") as f:
        return json.load(f)


# ─── MLP forward pass ───────────────────────────────────────────
def _forward(model: dict, features: np.ndarray) -> np.ndarray:
    mean = np.asarray(model["standardize"]["mean"], dtype=np.float64)
    std = np.asarray(model["standardize"]["std"], dtype=np.float64)
    std = np.where(std == 0, 1.0, std)
    x = (features - mean) / std
    for layer, act in zip(model["layers"], model["activations"]):
        W = np.asarray(layer["W"], dtype=np.float64)
        b = np.asarray(layer["b"], dtype=np.float64)
        x = x @ W + b
        if act == "relu":
            x = np.maximum(x, 0.0)
        elif act == "softmax":
            e = np.exp(x - np.max(x))
            x = e / (np.sum(e) + 1e-12)
    return x


def _classify(model: dict, features: np.ndarray) -> dict:
    probs = _forward(model, features)
    classes = model["classes"]
    idx = int(np.argmax(probs))
    label = classes[idx]
    emergency = model.get("emergencyClasses", [])
    emergency_conf = max((float(probs[classes.index(c)]) for c in emergency if c in classes), default=0.0)
    return {
        "label": label,
        "confidence": round(float(probs[idx]), 4),
        "probs": {c: round(float(p), 4) for c, p in zip(classes, probs)},
        "is_emergency": label in emergency,
        "emergency_confidence": round(emergency_conf, 4),
    }


# ─── MOTION features (mirror of ml-training/features.py) ────────
def motion_features(window: np.ndarray) -> np.ndarray:
    """window: (WINDOW_SIZE, 6) [ax,ay,az,gx,gy,gz] -> (24,)."""
    w = np.asarray(window, dtype=np.float64)
    ax, ay, az = w[:, 0], w[:, 1], w[:, 2]
    gx, gy, gz = w[:, 3], w[:, 4], w[:, 5]
    acc_mag = np.sqrt(ax * ax + ay * ay + az * az)
    gyro_mag = np.sqrt(gx * gx + gy * gy + gz * gz)
    acc_jerk = np.abs(np.diff(acc_mag)) if len(acc_mag) > 1 else np.array([0.0])
    feats = [
        acc_mag.mean(), acc_mag.std(), acc_mag.min(), acc_mag.max(),
        acc_mag.max() - acc_mag.min(), np.mean(acc_mag ** 2),
        np.mean(np.abs(acc_mag - acc_mag.mean())),
        acc_jerk.mean(), acc_jerk.max(),
        ax.std(), ay.std(), az.std(),
        ax.mean(), ay.mean(), az.mean(),
        np.mean(np.abs(ax) + np.abs(ay) + np.abs(az)),
        gyro_mag.mean(), gyro_mag.std(), gyro_mag.max(), np.mean(gyro_mag ** 2),
        gx.std(), gy.std(), gz.std(),
        np.mean(np.abs(gx) + np.abs(gy) + np.abs(gz)),
    ]
    return np.array(feats, dtype=np.float64)


def analyze_motion(accelerometer, gyroscope) -> dict:
    """accelerometer/gyroscope: lists of [x,y,z] rows (equal length window)."""
    model = load_model("motion")
    win_size = model["windowSize"]
    acc = np.asarray(accelerometer, dtype=np.float64)
    gyr = np.asarray(gyroscope, dtype=np.float64)
    n = min(len(acc), len(gyr))
    if n == 0:
        raise ValueError("empty motion window")
    # trim/pad to the model's window size
    acc, gyr = acc[:n], gyr[:n]
    window = np.hstack([acc, gyr])
    if len(window) < win_size:
        pad = np.repeat(window[-1:], win_size - len(window), axis=0)
        window = np.vstack([window, pad])
    else:
        window = window[:win_size]
    result = _classify(model, motion_features(window))
    result["model_version"] = model["version"]
    return result


# ─── AUDIO features (mirror of ml-training/audio_features.py) ───
def _frame(x: np.ndarray, frame: int, hop: int) -> np.ndarray:
    if len(x) < frame:
        x = np.pad(x, (0, frame - len(x)))
    n = 1 + (len(x) - frame) // hop
    idx = np.arange(frame)[None, :] + hop * np.arange(n)[:, None]
    return x[idx]


def audio_features(waveform: np.ndarray, model: dict) -> np.ndarray:
    frame = model["frameSize"]; hop = model["hopSize"]; nfft = model["nFftBins"]
    eps = model["eps"]; rolloff_pct = model["rolloffPercent"]
    fb = np.asarray(model["melFilterbank"], dtype=np.float64)     # (nMel, nfft)
    hann = np.asarray(model["hannWindow"], dtype=np.float64)      # (frame,)
    sr = model["sampleRateHz"]
    bin_freqs = np.linspace(0.0, sr / 2.0, nfft)

    x = np.asarray(waveform, dtype=np.float64).ravel()
    frames = _frame(x, frame, hop)

    rms = np.sqrt(np.mean(frames ** 2, axis=1) + eps)
    signs = np.sign(frames); signs[signs == 0] = 1.0
    zcr = np.mean(np.abs(np.diff(signs, axis=1)) > 0, axis=1)

    spec = np.abs(np.fft.rfft(frames * hann[None, :], axis=1))
    power = spec ** 2
    log_band = np.log(spec @ fb.T + eps)
    mag_sum = np.sum(spec, axis=1) + eps
    centroid = np.sum(spec * bin_freqs[None, :], axis=1) / mag_sum
    cumspec = np.cumsum(spec, axis=1)
    thresh = rolloff_pct * cumspec[:, -1][:, None]
    rolloff = bin_freqs[np.argmax(cumspec >= thresh, axis=1)]
    geo = np.exp(np.mean(np.log(power + eps), axis=1))
    arith = np.mean(power, axis=1) + eps
    flatness = geo / arith

    quants = np.concatenate(
        [log_band, rms[:, None], zcr[:, None], centroid[:, None],
         rolloff[:, None], flatness[:, None]], axis=1)
    return np.concatenate([quants.mean(axis=0), quants.std(axis=0)])


def _pcm_from_base64(audio_base64: str) -> np.ndarray:
    """Decode base64 PCM16 little-endian mono -> float [-1,1]."""
    import base64
    raw = base64.b64decode(audio_base64)
    pcm = np.frombuffer(raw, dtype="<i2").astype(np.float64) / 32768.0
    return pcm


def analyze_audio(audio_base64: str = None, samples=None) -> dict:
    """Accepts either base64 PCM16 (`audio_base64`) or raw float `samples`."""
    model = load_model("audio")
    if samples is not None:
        wave = np.asarray(samples, dtype=np.float64).ravel()
    elif audio_base64:
        wave = _pcm_from_base64(audio_base64)
    else:
        raise ValueError("provide audio_base64 or samples")
    if wave.size == 0:
        raise ValueError("empty audio")
    result = _classify(model, audio_features(wave, model))
    result["model_version"] = model["version"]
    return result
