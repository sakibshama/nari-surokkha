"""
Feature extraction for the motion model.

Input : a window of shape (WINDOW_SIZE, 6) — columns [ax, ay, az, gx, gy, gz].
Output: a fixed-length feature vector (see FEATURE_NAMES).

This is the SINGLE source of truth for the feature math. The TypeScript
port in apps/mobile/src/services/ml/features.ts must produce identical
values so that a model trained here behaves the same on device.
"""

import numpy as np

# Ordered feature names — the model input columns, in this exact order.
FEATURE_NAMES = [
    # accel magnitude stats
    "acc_mag_mean", "acc_mag_std", "acc_mag_min", "acc_mag_max",
    "acc_mag_range", "acc_mag_energy", "acc_mag_mad",
    # accel jerk (rate of change of magnitude)
    "acc_jerk_mean_abs", "acc_jerk_max_abs",
    # per-axis accel std (posture / orientation change)
    "ax_std", "ay_std", "az_std",
    # per-axis accel mean (gravity orientation)
    "ax_mean", "ay_mean", "az_mean",
    # signal magnitude area (accel)
    "acc_sma",
    # gyro magnitude stats
    "gyro_mag_mean", "gyro_mag_std", "gyro_mag_max", "gyro_mag_energy",
    # per-axis gyro std (rotational agitation)
    "gx_std", "gy_std", "gz_std",
    # gyro signal magnitude area
    "gyro_sma",
]
NUM_FEATURES = len(FEATURE_NAMES)


def extract_features(window: np.ndarray) -> np.ndarray:
    """window: (WINDOW_SIZE, 6) float array -> (NUM_FEATURES,) float array."""
    w = np.asarray(window, dtype=np.float64)
    ax, ay, az = w[:, 0], w[:, 1], w[:, 2]
    gx, gy, gz = w[:, 3], w[:, 4], w[:, 5]

    acc_mag = np.sqrt(ax * ax + ay * ay + az * az)
    gyro_mag = np.sqrt(gx * gx + gy * gy + gz * gz)

    acc_jerk = np.abs(np.diff(acc_mag)) if len(acc_mag) > 1 else np.array([0.0])

    feats = [
        acc_mag.mean(),
        acc_mag.std(),
        acc_mag.min(),
        acc_mag.max(),
        acc_mag.max() - acc_mag.min(),
        np.mean(acc_mag ** 2),
        np.mean(np.abs(acc_mag - acc_mag.mean())),  # mean absolute deviation

        acc_jerk.mean(),
        acc_jerk.max(),

        ax.std(), ay.std(), az.std(),
        ax.mean(), ay.mean(), az.mean(),
        np.mean(np.abs(ax) + np.abs(ay) + np.abs(az)),  # accel SMA

        gyro_mag.mean(),
        gyro_mag.std(),
        gyro_mag.max(),
        np.mean(gyro_mag ** 2),

        gx.std(), gy.std(), gz.std(),
        np.mean(np.abs(gx) + np.abs(gy) + np.abs(gz)),  # gyro SMA
    ]
    return np.array(feats, dtype=np.float64)


def extract_batch(windows: np.ndarray) -> np.ndarray:
    """windows: (N, WINDOW_SIZE, 6) -> (N, NUM_FEATURES)."""
    return np.stack([extract_features(w) for w in windows])
