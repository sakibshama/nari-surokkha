"""
Shared constants for the Nari Surokkha motion model.

These MUST stay in sync with the on-device TypeScript implementation
(apps/mobile/src/services/ml/features.ts and modelConfig.ts). If you change
the window size, sample rate, channel order, class list, or feature order
here, update the TS side too — the device extracts features the exact same
way before running the model.
"""

# ─── Signal geometry ────────────────────────────────────────────
SAMPLE_RATE_HZ = 50          # sensors sampled at 50 Hz on device
WINDOW_SECONDS = 2.0         # 2 second sliding window
WINDOW_SIZE = int(SAMPLE_RATE_HZ * WINDOW_SECONDS)   # 100 samples
# Channel order per sample: accelerometer (g) then gyroscope (rad/s)
CHANNELS = ["ax", "ay", "az", "gx", "gy", "gz"]
NUM_CHANNELS = len(CHANNELS)

# ─── Classes ────────────────────────────────────────────────────
# Order defines the model's output vector order — do not reorder.
CLASSES = ["normal", "walking", "fall", "struggle"]
# Classes that should raise a soft alert.
EMERGENCY_CLASSES = ["fall", "struggle"]

MODEL_VERSION = 1
MODEL_KIND = "motion"
