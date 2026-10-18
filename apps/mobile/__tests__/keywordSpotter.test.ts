import './helpers';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KeywordSpotter } from '../src/services/emergency/KeywordSpotter';
import { SoundEventClassifier, soundEvidence, SoundEventScores } from '../src/services/emergency/SoundEventClassifier';
import type { TensorModel } from '../src/services/emergency/TensorModel';
import {
  COMPETITOR_DOMINANCE,
  GATE_OPEN_DBFS,
  KWS_HOP,
  KWS_INPUT_SCALE,
  KWS_RECEPTIVE_HOPS,
  SHOUT_MIN_DBFS,
  SHOUT_MIN_PROMINENCE_DB,
  YAMNET_HOP,
  YAMNET_INPUT,
} from '../src/services/emergency/constants';

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
  // all-zero input: disable the silence gate, this test is about the buffers
  const k = new KeywordSpotter(f.mel, f.emb, f.head, { gateDb: -Infinity });
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

// ── silence gate ──

/**
 * Deterministic stand-ins whose outputs depend on their whole input, so any
 * difference in buffered state shows up in the score.
 */
function hashModels() {
  let runs = 0;
  const sum = (x: Float32Array, w = 1) => {
    let s = 0;
    for (let i = 0; i < x.length; i++) s += x[i] * ((i % 7) + w);
    return s;
  };
  const mel: TensorModel = {
    async run([x]) {
      runs++;
      const o = new Float32Array(256);
      for (let j = 0; j < 256; j++) o[j] = Math.tanh(sum(x.subarray((j * 6) % 1700, ((j * 6) % 1700) + 60), j % 3) / 1e5);
      return [o];
    },
  };
  const emb: TensorModel = {
    async run([x]) {
      runs++;
      const o = new Float32Array(96);
      for (let j = 0; j < 96; j++) o[j] = Math.tanh(sum(x.subarray(j * 25, j * 25 + 32), j % 5) / 10);
      return [o];
    },
  };
  const head: TensorModel = {
    async run([x]) {
      runs++;
      return [Float32Array.from([Math.tanh(sum(x, 1) / 100), Math.tanh(sum(x, 2) / 100)])];
    },
  };
  return { mel, emb, head, runs: () => runs };
}

/** Speech-like bursts separated by long silences (with a -80 dBFS floor). */
function burstyAudio(): Float32Array {
  const parts: [number, number][] = [
    [1.5, 0.0001], // silence
    [1.2, 0.2], // loud
    [8.0, 0.0001], // long silence: gate closes
    [0.6, 0.15], // short burst: gate re-opens
    [0.7, 0.0001], // short gap: gate stays open
    [1.0, 0.3],
    [8.0, 0.0001],
  ];
  const n = parts.reduce((a, [sec]) => a + Math.round(sec * 16000), 0);
  const x = new Float32Array(n);
  let o = 0;
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;
  for (const [sec, amp] of parts) {
    const m = Math.round(sec * 16000);
    for (let i = 0; i < m; i++) x[o + i] = amp * (rnd() * 0.5 + 0.5 * Math.sin((o + i) * 0.07));
    o += m;
  }
  return x;
}

test('silence gate: identical scores to continuous processing, far fewer model runs', async () => {
  const audio = burstyAudio();
  const a = hashModels();
  const b = hashModels();
  const ungated = new KeywordSpotter(a.mel, a.emb, a.head, { gateDb: -Infinity });
  const gated = new KeywordSpotter(b.mel, b.emb, b.head);
  const ref = [];
  const got = [];
  for (let i = 0; i < audio.length; i += 2048) {
    const chunk = audio.subarray(i, i + 2048);
    ref.push(...(await ungated.push(chunk)));
    got.push(...(await gated.push(chunk)));
  }
  assert.equal(got.length, ref.length, 'one result per hop either way');
  let compared = 0;
  got.forEach((g, i) => {
    if (g.gated) {
      assert.equal(g.help, 0);
      assert.equal(g.bachao, 0);
    } else {
      assert.ok(Math.abs(g.help - ref[i].help) < 1e-6 && Math.abs(g.bachao - ref[i].bachao) < 1e-6, `hop ${i} differs`);
      compared++;
    }
  });
  assert.ok(compared > 20, 'the loud parts were scored');
  assert.ok(gated.stats.gated > 50, 'silent stretches were skipped');
  assert.ok(gated.stats.replayed > 0, 'the gate re-opened at least once with a replay');
  assert.ok(b.runs() < a.runs() * 0.6, `gated ran ${b.runs()} models vs ${a.runs()}`);
});

test('silence gate: pure silence never runs a model', async () => {
  const f = hashModels();
  const k = new KeywordSpotter(f.mel, f.emb, f.head);
  const out = await k.push(new Float32Array(16000 * 4).fill(10 ** ((GATE_OPEN_DBFS - 10) / 20)));
  assert.equal(f.runs(), 0);
  // same number of results as an ungated spotter would give (one per hop after warm-up)
  assert.equal(out.length, Math.floor((16000 * 4) / KWS_HOP) - (KWS_RECEPTIVE_HOPS - 2));
  assert.ok(out.every((s) => s.gated && s.help === 0 && s.bachao === 0));
});

test('YAMNet is skipped on silent windows and reports the loudest block and the floor', async () => {
  let runs = 0;
  const m: TensorModel = {
    async run() {
      runs++;
      const s = new Float32Array(521);
      s[11] = 0.8; // Screaming
      return [s];
    },
  };
  const c = new SoundEventClassifier(m);
  const quiet = await c.push(new Float32Array(16000 * 3).fill(0.0001)); // -80 dBFS
  assert.equal(runs, 0);
  assert.ok(quiet.length > 0 && quiet.every((s) => s.gated && s.shout === 0));
  const loud = await c.push(new Float32Array(16000).fill(0.3)); // ≈ -10.5 dBFS
  assert.ok(runs >= 1);
  const last = loud[loud.length - 1];
  assert.equal(last.gated, false);
  assert.ok(Math.abs(last.peakDb - 20 * Math.log10(0.3)) < 0.1);
  assert.ok(last.floorDb < -70, 'floor still reflects the quiet background');
});

// ── evidence rules (loudness, competitors) ──

const ev = (over: Partial<SoundEventScores>): SoundEventScores => ({
  shout: 0,
  cry: 0,
  speech: 0,
  babyCry: 0,
  shoutCompetitor: 0,
  cryCompetitor: 0,
  levelDb: -20,
  peakDb: -15,
  floorDb: -50,
  gated: false,
  ...over,
});

test('shout must be loud and stand out from the background', () => {
  assert.equal(soundEvidence(ev({ shout: 0.6 })).shout, 0.6);
  const quiet = soundEvidence(ev({ shout: 0.6, peakDb: SHOUT_MIN_DBFS - 1, floorDb: -90 }));
  assert.equal(quiet.shout, 0);
  assert.equal(quiet.shoutSuppressed, 'quiet');
  const flat = soundEvidence(ev({ shout: 0.6, peakDb: -20, floorDb: -20 - SHOUT_MIN_PROMINENCE_DB + 1 }));
  assert.equal(flat.shout, 0);
  assert.equal(flat.shoutSuppressed, 'not_prominent');
});

test('a dominant competing class suppresses shout / cry, a dominant scream survives', () => {
  // cheering crowd / music clearly on top
  const music = soundEvidence(ev({ shout: 0.3, shoutCompetitor: 0.9 }));
  assert.equal(music.shout, 0);
  assert.equal(music.shoutSuppressed, 'competitor');
  // a scream over music: the scream is the stronger class
  assert.equal(soundEvidence(ev({ shout: 0.7, shoutCompetitor: 0.7 * COMPETITOR_DOMINANCE - 0.01 })).shout, 0.7);
  // weak competitor never suppresses
  assert.equal(soundEvidence(ev({ shout: 0.1, shoutCompetitor: 0.25 })).shout, 0.1);
  // laughter mistaken for crying
  const laugh = soundEvidence(ev({ cry: 0.33, cryCompetitor: 0.89 }));
  assert.equal(laugh.cry, 0);
  assert.equal(laugh.crySuppressed, 'competitor');
  // crying is not subject to the loudness rule (sobbing is quiet)
  assert.equal(soundEvidence(ev({ cry: 0.8, peakDb: -50, floorDb: -52 })).cry, 0.8);
});
