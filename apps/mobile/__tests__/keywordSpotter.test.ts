import './helpers';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KeywordSpotter } from '../src/services/emergency/KeywordSpotter';
import { SoundEventClassifier } from '../src/services/emergency/SoundEventClassifier';
import type { TensorModel } from '../src/services/emergency/TensorModel';
import { KWS_HOP, KWS_INPUT_SCALE, YAMNET_HOP, YAMNET_INPUT } from '../src/services/emergency/constants';

/** Fake models that record their inputs and emit traceable outputs. */
function fakes() {
  const melInputs: Float32Array[] = [];
  const embInputs: Float32Array[] = [];
  let hop = 0;
  const mel: TensorModel = {
    async run([x]) {
      melInputs.push(x.slice());
      hop++;
      // 8 frames × 32 bins, every value = hop number
      return [new Float32Array(256).fill(hop)];
    },
  };
  const emb: TensorModel = {
    async run([x]) {
      embInputs.push(x.slice());
      return [new Float32Array(96).fill(x[x.length - 1])]; // newest mel value
    },
  };
  const head: TensorModel = {
    async run([x]) {
      return [Float32Array.from([x[x.length - 1] / 100, x[0] / 100])];
    },
  };
  return { mel, emb, head, melInputs, embInputs };
}

test('one score per 80 ms hop, starting once 76 mel frames and 16 embeddings exist', async () => {
  const f = fakes();
  const k = new KeywordSpotter(f.mel, f.emb, f.head);
  const scores = [];
  // feed 3 s in odd-sized chunks to exercise the hop accumulator
  const total = 16000 * 3;
  let fed = 0;
  while (fed < total) {
    const n = Math.min(997, total - fed);
    scores.push(...(await k.push(new Float32Array(n).fill(0.25))));
    fed += n;
  }
  const hops = Math.floor(total / KWS_HOP);
  assert.equal(f.melInputs.length, hops);
  // 76 frames need ceil(76/8) = 10 hops; the 16th embedding arrives 15 hops later
  assert.equal(f.embInputs.length, hops - 9);
  assert.equal(scores.length, hops - 9 - 15);
});

test('mel input = newest 1760 samples, int16-scaled, oldest first', async () => {
  const f = fakes();
  const k = new KeywordSpotter(f.mel, f.emb, f.head);
  const ramp = Float32Array.from({ length: KWS_HOP * 2 }, (_, i) => i / 100000);
  await k.push(ramp);
  const second = f.melInputs[1];
  // last 1760 of the 2560 samples seen so far
  for (let i = 0; i < 1760; i++) {
    const src = ramp[ramp.length - 1760 + i];
    assert.ok(Math.abs(second[i] - src * KWS_INPUT_SCALE) < 1e-3);
  }
});

test('embedding window holds the newest 76 frames in order', async () => {
  const f = fakes();
  const k = new KeywordSpotter(f.mel, f.emb, f.head);
  await k.push(new Float32Array(KWS_HOP * 11));
  const last = f.embInputs[f.embInputs.length - 1]; // after hop 11
  // frames 0..75 = newest 76 frames of hops 2..11 (hop 1 partly dropped: 88 frames → keep 76)
  assert.equal(last[0], 2); // oldest kept frame came from hop 2 (frames 8..15 of 88 → 12 dropped)
  assert.equal(last[last.length - 1], 11);
});

test('YAMNet runs every 0.5 s on the newest 0.975 s once the window is full', async () => {
  const inputs: Float32Array[] = [];
  const m: TensorModel = {
    async run([x]) {
      inputs.push(x.slice());
      const s = new Float32Array(521);
      s[6] = 0.7; // Shout
      s[19] = 0.2; // Crying
      s[20] = 0.9; // Baby cry — must NOT count as "cry"
      return [s];
    },
  };
  const c = new SoundEventClassifier(m);
  const out = await c.push(new Float32Array(16000 * 2).fill(0.1));
  assert.equal(inputs.length, Math.floor(32000 / YAMNET_HOP) - 1); // first hop: window not full yet
  assert.equal(inputs[0].length, YAMNET_INPUT);
  assert.ok(Math.abs(out[0].shout - 0.7) < 1e-6);
  assert.ok(Math.abs(out[0].cry - 0.2) < 1e-6);
  assert.ok(Math.abs(out[0].levelDb - -20) < 0.01);
});
