"""
Shared constants for the Nari Surokkha AUDIO distress model.

Mirror of config.py, but for the audio pipeline. These MUST stay in sync with
the on-device TypeScript implementation:
  - apps/mobile/src/services/ml/audioModelConfig.ts
  - apps/mobile/src/services/ml/AudioFeatures.ts

The mel filterbank built here is the single source of truth. It is EXPORTED
inside audio_model.json so the device uses the exact same filter weights — this
removes the biggest feature-parity risk (no need to re-derive the filterbank in
TypeScript; the device just reads the numbers we trained with).
"""

import numpy as np

# ─── Signal geometry ────────────────────────────────────────────
SAMPLE_RATE_HZ = 16000       # mic downsampled to 16 kHz (speech standard)
CLIP_SECONDS = 3.0           # inference on 3-second chunks (matches AudioProcessor)
CLIP_SIZE = int(SAMPLE_RATE_HZ * CLIP_SECONDS)   # 48000 samples

FRAME_SIZE = 512             # 32 ms analysis frame (power of 2 for FFT)
HOP_SIZE = 256               # 16 ms hop (50% overlap)
N_FFT_BINS = FRAME_SIZE // 2 + 1                 # 257 rfft bins

# ─── Mel filterbank ─────────────────────────────────────────────
N_MEL_BANDS = 8              # coarse log-frequency energy bands
MEL_FMIN = 100.0            # Hz
MEL_FMAX = 7800.0           # Hz (< Nyquist 8000)


def _hz_to_mel(f):
    return 2595.0 * np.log10(1.0 + f / 700.0)


def _mel_to_hz(m):
    return 700.0 * (10.0 ** (m / 2595.0) - 1.0)


def build_mel_filterbank():
    """(N_MEL_BANDS, N_FFT_BINS) triangular mel filterbank — the exported truth."""
    mel_min, mel_max = _hz_to_mel(MEL_FMIN), _hz_to_mel(MEL_FMAX)
    mel_points = np.linspace(mel_min, mel_max, N_MEL_BANDS + 2)
    hz_points = _mel_to_hz(mel_points)
    bin_freqs = np.linspace(0.0, SAMPLE_RATE_HZ / 2.0, N_FFT_BINS)

    fb = np.zeros((N_MEL_BANDS, N_FFT_BINS), dtype=np.float64)
    for m in range(1, N_MEL_BANDS + 1):
        f_left, f_center, f_right = hz_points[m - 1], hz_points[m], hz_points[m + 1]
        for k, f in enumerate(bin_freqs):
            if f_left <= f <= f_center and f_center > f_left:
                fb[m - 1, k] = (f - f_left) / (f_center - f_left)
            elif f_center < f <= f_right and f_right > f_center:
                fb[m - 1, k] = (f_right - f) / (f_right - f_center)
    return fb


MEL_FILTERBANK = build_mel_filterbank()   # (8, 257)

# Hann window used on every frame (deterministic, mirrored in TS).
HANN_WINDOW = (0.5 - 0.5 * np.cos(2.0 * np.pi * np.arange(FRAME_SIZE) / (FRAME_SIZE - 1)))

# Spectral rolloff fraction.
ROLLOFF_PERCENT = 0.85

# ─── Classes ────────────────────────────────────────────────────
# Order defines the model's output vector order — do not reorder.
CLASSES = ["background", "speech", "scream", "distress_keyword"]
# Classes that should raise a soft alert.
EMERGENCY_CLASSES = ["scream", "distress_keyword"]

MODEL_VERSION = 1
MODEL_KIND = "audio"

EPS = 1e-6
