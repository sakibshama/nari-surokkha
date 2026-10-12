"""False alerts on isolated held-out utterances: each negative utterance alone,
after 2.5 s of quiet room noise (-65 dBFS), at -20 dBFS — the situation a phone in a
quiet room actually sees. Run after train.py / finetune_hard.py."""
from paths import WORK  # noqa: E402
import numpy as np, tensorflow as tf
import feats
from augment import level
RULES = {"low": (0.95, 3, 4), "medium": (0.9, 3, 4), "high": (0.8, 2, 4)}
clips = list(np.load(f'{WORK}/clips/neg_test.npy', allow_pickle=True)) + list(np.load(f'{WORK}/clips/neg2_test.npy', allow_pickle=True))
m = tf.keras.models.load_model(f'{WORK}/head.keras')
fa = {r: 0 for r in RULES}
for c in clips:
    x = np.concatenate([np.zeros(40000, np.float32), level(c, -20), np.zeros(16000, np.float32)])
    x = x + level(np.random.default_rng(len(x)).standard_normal(len(x)).astype(np.float32), -65)
    W, _ = feats.windows(feats.embeddings(x)); p = m.predict(W, verbose=0)
    for r, (thr, h, w) in RULES.items():
        hit = any((p[max(0, i - w + 1):i + 1, col] >= thr).sum() >= h for col in (0, 1) for i in range(len(p)))
        fa[r] += hit
print({r: f"{v}/{len(clips)} ({100*v/len(clips):.1f}%)" for r, v in fa.items()})
