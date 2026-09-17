"""
Train the audio distress-detection model.

Mirror of train.py (motion), for audio. Pipeline:
  1. Build a dataset from synthetic clips + any real device clips
     (data/audio_real/*.npz, fetched by audio_pull_samples.py).
  2. Extract features (audio_features.py — identical math to the on-device TS).
  3. Standardize, then train a small MLP (1 hidden layer, ReLU).
  4. Evaluate (accuracy + per-class report + confusion matrix).
  5. Export a compact audio_model.json (weights + metadata + the mel filterbank
     and Hann window) that the mobile app consumes. Runs in pure TypeScript on
     device — no native runtime needed.
  6. (Optional, --tflite) Also export .tflite via TensorFlow.

Usage:
  python audio_train.py                          # synthetic only -> audio_model.json
  python audio_train.py --real data/audio_real   # include collected real clips
  python audio_train.py --out ../../apps/mobile/assets/models   # write into the app

Requires: numpy, scikit-learn  (tensorflow only for --tflite)
"""

import argparse
import glob
import json
import os
from datetime import datetime, timezone

import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.neural_network import MLPClassifier
from sklearn.metrics import classification_report, confusion_matrix, accuracy_score

import audio_config as config
import audio_synthetic as synthetic
from audio_features import extract_batch, FEATURE_NAMES, NUM_FEATURES


def load_real(real_dir):
    """Load real collected clips saved as .npz with arrays X (N,CLIP_SIZE), y (N,)."""
    X_all, y_all = [], []
    if not real_dir or not os.path.isdir(real_dir):
        return None, None
    for path in sorted(glob.glob(os.path.join(real_dir, "*.npz"))):
        d = np.load(path)
        if "X" in d and "y" in d and len(d["X"]):
            X_all.append(d["X"].astype(np.float32))
            y_all.append(d["y"].astype(np.int64))
    if not X_all:
        return None, None
    return np.concatenate(X_all), np.concatenate(y_all)


def build_dataset(per_class, real_dir):
    Xs, ys = synthetic.generate(per_class=per_class)
    Xr, yr = load_real(real_dir)
    if Xr is not None:
        print(f"[data] real clips: {len(yr)}  (bincount {np.bincount(yr, minlength=len(config.CLASSES)).tolist()})")
        # Oversample real data 3x so the small real set meaningfully shapes the model.
        Xs = np.concatenate([Xs, np.repeat(Xr, 3, axis=0)])
        ys = np.concatenate([ys, np.repeat(yr, 3, axis=0)])
    else:
        print("[data] no real clips found — training on synthetic only")
    return Xs, ys


def export_json(scaler, clf, out_dir, metrics):
    """Serialize standardization + MLP layers + mel filterbank to compact JSON."""
    os.makedirs(out_dir, exist_ok=True)
    layers = []
    for W, b in zip(clf.coefs_, clf.intercepts_):
        layers.append({"W": W.astype(float).tolist(), "b": b.astype(float).tolist()})
    activations = ["relu"] * (len(layers) - 1) + ["softmax"]

    model = {
        "kind": config.MODEL_KIND,
        "version": config.MODEL_VERSION,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "sampleRateHz": config.SAMPLE_RATE_HZ,
        "clipSize": config.CLIP_SIZE,
        "frameSize": config.FRAME_SIZE,
        "hopSize": config.HOP_SIZE,
        "nFftBins": config.N_FFT_BINS,
        "nMelBands": config.N_MEL_BANDS,
        "rolloffPercent": config.ROLLOFF_PERCENT,
        "eps": config.EPS,
        "classes": config.CLASSES,
        "emergencyClasses": config.EMERGENCY_CLASSES,
        "featureNames": FEATURE_NAMES,
        # exported so the device uses identical numbers (parity guarantee)
        "melFilterbank": config.MEL_FILTERBANK.astype(float).tolist(),   # (8, 257)
        "hannWindow": config.HANN_WINDOW.astype(float).tolist(),         # (512,)
        "standardize": {
            "mean": scaler.mean_.astype(float).tolist(),
            "std": scaler.scale_.astype(float).tolist(),
        },
        "layers": layers,
        "activations": activations,
        "metrics": metrics,
    }
    path = os.path.join(out_dir, "audio_model.json")
    with open(path, "w") as f:
        json.dump(model, f)
    size = os.path.getsize(path)
    print(f"[export] wrote {path}  ({size/1024:.1f} KB)")
    return path


def export_tflite(scaler, clf, out_dir):
    try:
        import tensorflow as tf
    except ImportError:
        print("[tflite] TensorFlow not installed — skipping .tflite export. "
              "Install with: pip install tensorflow")
        return None

    inp = tf.keras.Input(shape=(NUM_FEATURES,), name="features")
    mean = tf.constant(scaler.mean_, dtype=tf.float32)
    std = tf.constant(scaler.scale_, dtype=tf.float32)
    x = (inp - mean) / std
    for i, (W, b) in enumerate(zip(clf.coefs_, clf.intercepts_)):
        dense = tf.keras.layers.Dense(
            W.shape[1],
            activation="relu" if i < len(clf.coefs_) - 1 else "softmax",
        )
        x = dense(x)
        dense.set_weights([W.astype(np.float32), b.astype(np.float32)])
    model = tf.keras.Model(inp, x)

    conv = tf.lite.TFLiteConverter.from_keras_model(model)
    conv.optimizations = [tf.lite.Optimize.DEFAULT]
    tfl = conv.convert()
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, "audio_model.tflite")
    with open(path, "wb") as f:
        f.write(tfl)
    print(f"[export] wrote {path}  ({len(tfl)/1024:.1f} KB)")
    return path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-class", type=int, default=1200)
    ap.add_argument("--real", default="data/audio_real", help="dir of collected real .npz clips")
    ap.add_argument("--out", default="models", help="output dir for the model")
    ap.add_argument("--tflite", action="store_true", help="also export .tflite (needs tensorflow)")
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    print("[1/4] building dataset…")
    X, y = build_dataset(args.per_class, args.real)
    print(f"      clips={len(y)}  classes={config.CLASSES}")

    print("[2/4] extracting features…")
    F = extract_batch(X)

    Xtr, Xte, ytr, yte = train_test_split(F, y, test_size=0.2, random_state=args.seed, stratify=y)
    scaler = StandardScaler().fit(Xtr)
    Xtr_s, Xte_s = scaler.transform(Xtr), scaler.transform(Xte)

    print("[3/4] training MLP…")
    clf = MLPClassifier(
        hidden_layer_sizes=(32,),
        activation="relu",
        alpha=1e-3,
        max_iter=500,
        early_stopping=True,
        n_iter_no_change=15,
        random_state=args.seed,
    )
    clf.fit(Xtr_s, ytr)

    pred = clf.predict(Xte_s)
    acc = float(accuracy_score(yte, pred))
    print(f"      test accuracy = {acc:.3f}")
    print(classification_report(yte, pred, target_names=config.CLASSES, digits=3))
    print("confusion matrix:\n", confusion_matrix(yte, pred))

    metrics = {"testAccuracy": round(acc, 4), "trainedAt": datetime.now(timezone.utc).isoformat(),
               "nClips": int(len(y)), "dataSource": "synthetic" if not os.path.isdir(args.real) else "synthetic+real"}

    print("[4/4] exporting…")
    export_json(scaler, clf, args.out, metrics)
    if args.tflite:
        export_tflite(scaler, clf, args.out)

    print("done.")


if __name__ == "__main__":
    main()
