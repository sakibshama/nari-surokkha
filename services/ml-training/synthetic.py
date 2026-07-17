"""
Synthetic motion data generator.

Produces labelled 2-second windows of 6-axis IMU data (accelerometer in g,
gyroscope in rad/s) that roughly resemble four states:

  normal    — phone held/pocketed, gravity ~1g on one axis, tiny noise
  walking   — periodic ~2 Hz bounce on accel, mild gyro sway
  fall      — brief free-fall dip (~0g) then a sharp impact spike, then still
  struggle  — high-frequency, high-amplitude chaotic shaking on all axes

This bootstraps a working v1 model. It is deliberately simple; the real-data
loop (pull_samples.py) collects genuine device windows to retrain better
versions over time.
"""

import numpy as np
from config import WINDOW_SIZE, SAMPLE_RATE_HZ, CLASSES

G = 1.0  # gravity in "g" units (accelerometer reports ~1g at rest)


def _rng(seed):
    return np.random.default_rng(seed)


def _gravity_vector(rng):
    """A random unit-ish gravity direction, mostly on one axis."""
    v = rng.normal(0, 0.15, 3)
    dominant = rng.integers(0, 3)
    v[dominant] += rng.choice([-1.0, 1.0])
    v = v / (np.linalg.norm(v) + 1e-9)
    return v * G


def gen_normal(rng):
    t = np.arange(WINDOW_SIZE)
    g = _gravity_vector(rng)
    acc = np.tile(g, (WINDOW_SIZE, 1)) + rng.normal(0, 0.02, (WINDOW_SIZE, 3))
    gyro = rng.normal(0, 0.02, (WINDOW_SIZE, 3))
    return np.hstack([acc, gyro])


def gen_walking(rng):
    t = np.arange(WINDOW_SIZE) / SAMPLE_RATE_HZ
    g = _gravity_vector(rng)
    freq = rng.uniform(1.6, 2.4)          # steps ~2 Hz
    amp = rng.uniform(0.25, 0.5)
    bounce = amp * np.sin(2 * np.pi * freq * t)
    acc = np.tile(g, (WINDOW_SIZE, 1))
    acc[:, 2] += bounce
    acc[:, 0] += 0.15 * np.sin(2 * np.pi * freq * t + 0.5)
    acc += rng.normal(0, 0.05, (WINDOW_SIZE, 3))
    gyro = np.zeros((WINDOW_SIZE, 3))
    for a in range(3):
        gyro[:, a] = rng.uniform(0.05, 0.2) * np.sin(2 * np.pi * freq * t + rng.uniform(0, 3))
    gyro += rng.normal(0, 0.03, (WINDOW_SIZE, 3))
    return np.hstack([acc, gyro])


def gen_fall(rng):
    g = _gravity_vector(rng)
    acc = np.tile(g, (WINDOW_SIZE, 1)) + rng.normal(0, 0.03, (WINDOW_SIZE, 3))
    # free-fall dip then impact then settle
    start = rng.integers(int(WINDOW_SIZE * 0.25), int(WINDOW_SIZE * 0.5))
    fall_len = rng.integers(6, 12)         # ~0.12-0.24s free fall
    acc[start:start + fall_len, :] = rng.normal(0, 0.05, (fall_len, 3))  # ~0g
    impact = start + fall_len
    spike_len = rng.integers(3, 6)
    mag = rng.uniform(3.5, 6.0)            # sharp impact (multi-g)
    for i in range(spike_len):
        if impact + i < WINDOW_SIZE:
            acc[impact + i] += rng.normal(0, 1.0, 3) * mag * (1 - i / spike_len)
    # after impact, a new (often different) resting orientation
    if impact + spike_len < WINDOW_SIZE:
        g2 = _gravity_vector(rng)
        acc[impact + spike_len:] = np.tile(g2, (WINDOW_SIZE - impact - spike_len, 1)) \
            + rng.normal(0, 0.05, (WINDOW_SIZE - impact - spike_len, 3))
    gyro = rng.normal(0, 0.05, (WINDOW_SIZE, 3))
    gyro[impact:impact + spike_len] += rng.normal(0, 3.0, (min(spike_len, WINDOW_SIZE - impact), 3))
    return np.hstack([acc, gyro])


def gen_struggle(rng):
    t = np.arange(WINDOW_SIZE) / SAMPLE_RATE_HZ
    g = _gravity_vector(rng)
    acc = np.tile(g, (WINDOW_SIZE, 1))
    # sum of several high-freq components + heavy noise
    for a in range(3):
        for _ in range(rng.integers(2, 4)):
            f = rng.uniform(3, 9)
            acc[:, a] += rng.uniform(0.4, 1.2) * np.sin(2 * np.pi * f * t + rng.uniform(0, 6))
    acc += rng.normal(0, 0.4, (WINDOW_SIZE, 3))
    gyro = np.zeros((WINDOW_SIZE, 3))
    for a in range(3):
        for _ in range(rng.integers(2, 4)):
            f = rng.uniform(3, 10)
            gyro[:, a] += rng.uniform(0.8, 2.5) * np.sin(2 * np.pi * f * t + rng.uniform(0, 6))
    gyro += rng.normal(0, 0.3, (WINDOW_SIZE, 3))
    return np.hstack([acc, gyro])


_GENERATORS = {
    "normal": gen_normal,
    "walking": gen_walking,
    "fall": gen_fall,
    "struggle": gen_struggle,
}


def generate(per_class=1500, seed=42):
    """Returns X: (N, WINDOW_SIZE, 6), y: (N,) int labels."""
    rng = _rng(seed)
    X, y = [], []
    for ci, cls in enumerate(CLASSES):
        gen = _GENERATORS[cls]
        for _ in range(per_class):
            X.append(gen(rng))
            y.append(ci)
    X = np.array(X, dtype=np.float32)
    y = np.array(y, dtype=np.int64)
    perm = rng.permutation(len(y))
    return X[perm], y[perm]


if __name__ == "__main__":
    X, y = generate(per_class=50)
    print("Generated", X.shape, "labels", np.bincount(y))
