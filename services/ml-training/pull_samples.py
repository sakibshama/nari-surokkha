"""
Pull real labelled motion windows collected from devices, so they can be
folded into the next training run.

The mobile app uploads windows (via POST /api/v1/ml/samples) whenever a user
confirms a real SOS (positive) or dismisses a false alarm (negative). An admin
can also relabel samples. This script exports the labelled ones and saves them
as .npz for train.py to pick up from data/real/.

Usage:
  export API_URL=https://api.narisurokkha.com/api/v1
  export ADMIN_TOKEN=<admin JWT>
  python pull_samples.py --out data/real
"""

import argparse
import os

import numpy as np
import requests

import config


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data/real")
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
        timeout=60,
    )
    resp.raise_for_status()
    payload = resp.json()
    samples = payload.get("data", payload)

    label_index = {c: i for i, c in enumerate(config.CLASSES)}
    X, y = [], []
    for s in samples:
        window = s.get("window")
        label = s.get("label")
        if window is None or label not in label_index:
            continue
        arr = np.asarray(window, dtype=np.float32)
        if arr.shape == (config.WINDOW_SIZE, len(config.CHANNELS)):
            X.append(arr)
            y.append(label_index[label])

    if not X:
        print("No usable labelled samples returned.")
        return

    os.makedirs(args.out, exist_ok=True)
    out = os.path.join(args.out, "real_samples.npz")
    np.savez_compressed(out, X=np.stack(X), y=np.array(y, dtype=np.int64))
    print(f"Saved {len(y)} labelled windows -> {out}")
    print("Class counts:", np.bincount(np.array(y), minlength=len(config.CLASSES)).tolist())


if __name__ == "__main__":
    main()
