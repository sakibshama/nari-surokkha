"""
Synthetic audio data generator.

Produces labelled 3-second mono waveforms at 16 kHz that roughly resemble four
acoustic states:

  background        — room tone / traffic hum: low-energy coloured noise
  speech            — normal conversation: voiced formants ~100-300 Hz F0,
                      moderate energy, syllable-rate amplitude modulation
  scream            — sustained high-pitched loud cry: high F0 (600-1200 Hz),
                      strong high-frequency harmonics, near clipping
  distress_keyword  — a shouted short word ("help" / "বাঁচাও"): a loud voiced
                      burst with a rising then falling envelope, mid-high F0

This bootstraps a working v1 model so the pipeline is real end-to-end. It is
deliberately crude — genuine screams and keywords are collected from devices
via audio_pull_samples.py to retrain far better versions over time. Treat v1 as
"beta": good enough to distinguish loud distress from quiet/normal audio, NOT a
production keyword spotter (that needs real data + likely a sequence model).
"""

import numpy as np

from audio_config import CLIP_SIZE, SAMPLE_RATE_HZ, CLASSES

SR = SAMPLE_RATE_HZ


def _rng(seed):
    return np.random.default_rng(seed)


def _normalize(x, peak):
    m = np.max(np.abs(x)) + 1e-9
    return (x / m) * peak


def _coloured_noise(rng, n, tilt=-1.0):
    """Noise with a spectral tilt (tilt<0 = more low-freq energy)."""
    white = rng.normal(0, 1, n)
    spec = np.fft.rfft(white)
    freqs = np.fft.rfftfreq(n, 1.0 / SR)
    freqs[0] = freqs[1]
    shape = (freqs / freqs[0]) ** (tilt / 2.0)
    return np.fft.irfft(spec * shape, n=n)


def _voiced(rng, n, f0, n_harm, formant_gain, jitter=0.02):
    """A simple harmonic voiced source with slight pitch jitter + formants.

    Vectorized: all harmonics summed in one broadcasted sin() call.
    """
    # pitch contour with jitter
    f0_track = f0 * (1.0 + jitter * rng.normal(0, 1, n).cumsum() / np.sqrt(n))
    phase = 2 * np.pi * np.cumsum(f0_track) / SR          # (n,)
    h = np.arange(1, n_harm + 1)                          # (H,)
    amp = np.array([formant_gain(hi * f0) for hi in h]) / h  # (H,)
    # (H, n) = sin(outer(h, phase)); weighted sum over harmonics
    sig = amp @ np.sin(np.outer(h, phase))
    return sig


def gen_background(rng):
    n = CLIP_SIZE
    x = _coloured_noise(rng, n, tilt=rng.uniform(-1.5, -0.5))
    # occasional faint distant tone (traffic / hum)
    if rng.random() < 0.5:
        f = rng.uniform(50, 200)
        x += 0.2 * np.sin(2 * np.pi * f * np.arange(n) / SR)
    x = _normalize(x, rng.uniform(0.02, 0.12))   # quiet
    return x.astype(np.float32)


def gen_speech(rng):
    n = CLIP_SIZE
    f0 = rng.uniform(100, 260)
    # broad low-mid formant emphasis
    fg = lambda f: np.exp(-((f - rng.uniform(500, 1500)) ** 2) / (2 * 800 ** 2)) + 0.3
    voiced = _voiced(rng, n, f0, n_harm=12, formant_gain=fg, jitter=0.03)
    # syllable-rate amplitude modulation (~3-6 Hz) with pauses
    t = np.arange(n) / SR
    env = 0.5 + 0.5 * np.sin(2 * np.pi * rng.uniform(3, 6) * t + rng.uniform(0, 6))
    env *= (rng.random(n) > 0.05)                # brief gaps
    x = voiced * env + 0.02 * _coloured_noise(rng, n, -1.0)
    x = _normalize(x, rng.uniform(0.2, 0.5))     # moderate
    return x.astype(np.float32)


def gen_scream(rng):
    n = CLIP_SIZE
    f0 = rng.uniform(600, 1200)
    # bright: strong high harmonics
    fg = lambda f: 1.0 if f < 5000 else 0.6
    voiced = _voiced(rng, n, f0, n_harm=8, formant_gain=fg, jitter=0.06)
    # sustained loud envelope, slight tremor
    t = np.arange(n) / SR
    env = 0.8 + 0.2 * np.sin(2 * np.pi * rng.uniform(4, 9) * t)
    x = voiced * env + 0.15 * _coloured_noise(rng, n, 0.0)
    x = _normalize(x, rng.uniform(0.75, 0.99))   # loud, near clipping
    x = np.clip(x * rng.uniform(1.0, 1.4), -1.0, 1.0)   # some distortion
    return x.astype(np.float32)


def gen_distress_keyword(rng):
    n = CLIP_SIZE
    f0 = rng.uniform(300, 650)
    fg = lambda f: np.exp(-((f - rng.uniform(1200, 2600)) ** 2) / (2 * 1000 ** 2)) + 0.4
    voiced = _voiced(rng, n, f0, n_harm=10, formant_gain=fg, jitter=0.05)
    # short shouted word: silence, rising-falling burst (~0.4-0.8s), silence
    t = np.arange(n) / SR
    start = rng.uniform(0.3, 1.2)
    dur = rng.uniform(0.4, 0.8)
    env = np.zeros(n)
    mask = (t >= start) & (t < start + dur)
    tb = (t[mask] - start) / dur
    env[mask] = np.sin(np.pi * tb) ** 0.7        # rise then fall
    # sometimes two syllables ("ba-cha-o")
    if rng.random() < 0.5:
        s2 = start + dur + rng.uniform(0.05, 0.2)
        d2 = rng.uniform(0.2, 0.5)
        m2 = (t >= s2) & (t < s2 + d2)
        if m2.any():
            env[m2] = np.sin(np.pi * (t[m2] - s2) / d2) ** 0.7
    x = voiced * env + 0.03 * _coloured_noise(rng, n, -1.0)
    x = _normalize(x, rng.uniform(0.6, 0.95))    # loud
    return x.astype(np.float32)


_GENERATORS = {
    "background": gen_background,
    "speech": gen_speech,
    "scream": gen_scream,
    "distress_keyword": gen_distress_keyword,
}


def generate(per_class=1200, seed=42):
    """Returns X: (N, CLIP_SIZE) float32, y: (N,) int labels."""
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
    X, y = generate(per_class=20)
    print("Generated", X.shape, "labels", np.bincount(y))
