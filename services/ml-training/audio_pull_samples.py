"""
Pull real labelled audio clips collected from devices, so they can be folded
into the next training run. Mirror of pull_samples.py (motion).

The mobile app uploads a short clip (raw 16 kHz mono PCM, CLIP_SIZE samples)
whenever a user confirms a real voice-triggered SOS (positive) or dismisses a
false alarm (negative). An admin can also relabel clips. This script exports
the labelled ones and saves them as .npz for audio_train.py to pick up from
data/audio_real/.

Usage:
  export API_URL=https://api.mystrix-soft.com/api/v1
  export ADMIN_TOKEN=<admin JWT>
  python audio_pull_samples.py --out data/audio_real
"""

import argparse
import os

import numpy as np
import requests

import audio_config as config


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data/audio_real")
    ap.add_argument("--kind", default=config.MODEL_KIND)
    ap.add_argument("--limit", type=int, default=5000)
    args = ap.parse_args()

    api = os.environ.get("API_URL", "http://localhost:3001/api/v1").rstrip("/")
    token = os.environ.get("ADMIN_TOKEN", "")
    if not token:
        raise SystemExit("Set ADMIN_TOKEN (an admin JWT) in the environment.")

    url = f"{api}/ml/samples/export"
    resp = requests.get(
        url,
        params={"kind": args.kind, "limit": args.limit, "labeledOnly": "true"},
        headers={"Authorization": f"Bearer {token}"},
        timeout=120,
    )
    resp.raise_for_status()
    payload = resp.json()
    samples = payload.get("data", payload)

    label_index = {c: i for i, c in enumerate(config.CLASSES)}
    X, y = [], []
    for s in samples:
        clip = s.get("clip") or s.get("window")   # raw PCM float samples
        label = s.get("label")
        if clip is None or label not in label_index:
            continue
        arr = np.asarray(clip, dtype=np.float32).ravel()
        # accept clips of the right length (pad/trim tolerated slightly)
        if abs(len(arr) - config.CLIP_SIZE) <= config.HOP_SIZE:
            if len(arr) < config.CLIP_SIZE:
                arr = np.pad(arr, (0, config.CLIP_SIZE - len(arr)))
            else:
                arr = arr[:config.CLIP_SIZE]
            X.append(arr)
            y.append(label_index[label])

    if not X:
        print("No usable labelled audio clips returned.")
        return

    os.makedirs(args.out, exist_ok=True)
    out = os.path.join(args.out, "real_audio.npz")
    np.savez_compressed(out, X=np.stack(X), y=np.array(y, dtype=np.int64))
    print(f"Saved {len(y)} labelled clips -> {out}")
    print("Class counts:", np.bincount(np.array(y), minlength=len(config.CLASSES)).tolist())


if __name__ == "__main__":
    main()
