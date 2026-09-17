"""
Feature extraction for the audio distress model.

Input : a mono waveform (float array, ~[-1, 1]) at SAMPLE_RATE_HZ, CLIP_SIZE long.
Output: a fixed-length feature vector (see FEATURE_NAMES).

This is the SINGLE source of truth for the feature math. The TypeScript port
in apps/mobile/src/services/ml/AudioFeatures.ts must produce identical values
so a model trained here behaves the same on device.

Per frame we compute 13 quantities (8 log-mel band energies + rms + zero-cross
rate + spectral centroid + spectral rolloff + spectral flatness), then take the
mean and std of each across all frames → 26 features. The mel filterbank and
Hann window come from audio_config (and are exported inside the model JSON so
the device uses the identical numbers).
"""

import numpy as np

from audio_config import (
    FRAME_SIZE, HOP_SIZE, MEL_FILTERBANK, HANN_WINDOW, SAMPLE_RATE_HZ,
    N_FFT_BINS, ROLLOFF_PERCENT, N_MEL_BANDS, EPS,
)

# Per-frame quantity names, in order.
_FRAME_QUANTS = (
    [f"mel{i}" for i in range(N_MEL_BANDS)]
    + ["rms", "zcr", "centroid", "rolloff", "flatness"]
)
# Final feature vector: mean of each quantity, then std of each quantity.
FEATURE_NAMES = (
    [f"{q}_mean" for q in _FRAME_QUANTS]
    + [f"{q}_std" for q in _FRAME_QUANTS]
)
NUM_FEATURES = len(FEATURE_NAMES)   # 26

_BIN_FREQS = np.linspace(0.0, SAMPLE_RATE_HZ / 2.0, N_FFT_BINS)


def _frame_signal(x: np.ndarray) -> np.ndarray:
    """Slice waveform into overlapping frames (n_frames, FRAME_SIZE)."""
    if len(x) < FRAME_SIZE:
        x = np.pad(x, (0, FRAME_SIZE - len(x)))
    n_frames = 1 + (len(x) - FRAME_SIZE) // HOP_SIZE
    idx = np.arange(FRAME_SIZE)[None, :] + HOP_SIZE * np.arange(n_frames)[:, None]
    return x[idx]


def extract_features(waveform: np.ndarray) -> np.ndarray:
    """waveform: 1-D float array -> (NUM_FEATURES,) float array."""
    x = np.asarray(waveform, dtype=np.float64).ravel()
    frames = _frame_signal(x)                      # (F, FRAME_SIZE)

    # time-domain per-frame scalars
    rms = np.sqrt(np.mean(frames ** 2, axis=1) + EPS)
    signs = np.sign(frames)
    signs[signs == 0] = 1.0
    zcr = np.mean(np.abs(np.diff(signs, axis=1)) > 0, axis=1)

    # spectral
    windowed = frames * HANN_WINDOW[None, :]
    spec = np.abs(np.fft.rfft(windowed, axis=1))   # (F, N_FFT_BINS) magnitude
    power = spec ** 2

    band_energy = spec @ MEL_FILTERBANK.T          # (F, N_MEL_BANDS)
    log_band = np.log(band_energy + EPS)

    mag_sum = np.sum(spec, axis=1) + EPS
    centroid = np.sum(spec * _BIN_FREQS[None, :], axis=1) / mag_sum

    cumspec = np.cumsum(spec, axis=1)
    thresh = ROLLOFF_PERCENT * cumspec[:, -1][:, None]
    rolloff_bin = np.argmax(cumspec >= thresh, axis=1)
    rolloff = _BIN_FREQS[rolloff_bin]

    geo = np.exp(np.mean(np.log(power + EPS), axis=1))
    arith = np.mean(power, axis=1) + EPS
    flatness = geo / arith

    # stack per-frame quantities: (F, 13) in _FRAME_QUANTS order
    quants = np.concatenate(
        [log_band,
         rms[:, None], zcr[:, None], centroid[:, None],
         rolloff[:, None], flatness[:, None]],
        axis=1,
    )

    feats = np.concatenate([quants.mean(axis=0), quants.std(axis=0)])
    return feats.astype(np.float64)


def extract_batch(waveforms: np.ndarray) -> np.ndarray:
    """waveforms: (N, CLIP_SIZE) -> (N, NUM_FEATURES)."""
    return np.stack([extract_features(w) for w in waveforms])
