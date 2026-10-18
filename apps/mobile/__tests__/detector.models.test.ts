/**
 * End-to-end check of the real detection pipeline (EmergencySoundDetector →
 * KeywordSpotter + SoundEventClassifier → TriggerDecider) on recorded audio,
 * using ONNX conversions of the exact .tflite models the app ships.
 *
 * Needs the fixture folder produced by
 *   services/ml-training/keywords/export_test_fixtures.py
 * Run:  NS_TEST_MODELS=/path/to/fixtures npm test
 * Skipped when NS_TEST_MODELS is not set (fixtures are ~70 MB, not committed).
 */
import './helpers';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EmergencySoundDetector, AudioSource } from '../src/services/emergency/EmergencySoundDetector';
import { KeywordSpotter } from '../src/services/emergency/KeywordSpotter';
import type { TensorModel } from '../src/services/emergency/TensorModel';
import type { EmergencyModels } from '../src/services/emergency/tfliteModels';
import type { Detection } from '../src/services/emergency/TriggerDecider';
import type { TriggerId } from '../src/services/emergency/constants';

const DIR = process.env.NS_TEST_MODELS;

function readWav16k(file: string): Float32Array {
  const b = fs.readFileSync(file);
  let off = 12;
  let fmtOk = false;
  while (off < b.length) {
    const id = b.toString('ascii', off, off + 4);
    const size = b.readUInt32LE(off + 4);
    if (id === 'fmt ') {
      const ch = b.readUInt16LE(off + 10);
      const sr = b.readUInt32LE(off + 12);
      const bits = b.readUInt16LE(off + 22);
      if (ch !== 1 || sr !== 16000 || bits !== 16) throw new Error(`${file}: need 16 kHz mono PCM16`);
      fmtOk = true;
    } else if (id === 'data' && fmtOk) {
      const n = size / 2;
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = b.readInt16LE(off + 8 + 2 * i) / 32768;
      return out;
    }
    off += 8 + size + (size % 2);
  }
  throw new Error(`${file}: no data chunk`);
}

async function loadOnnx(): Promise<EmergencyModels> {
  const ort = await import('onnxruntime-web');
  ort.env.wasm.numThreads = 1;
  const mk = async (name: string, shape: number[]): Promise<TensorModel> => {
    const s = await ort.InferenceSession.create(path.join(DIR!, `${name}.onnx`));
    return {
      async run([x]) {
        const out = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', x, shape) });
        return [out[s.outputNames[0]].data as Float32Array];
      },
    };
  };
  return {
    yamnet: await mk('yamnet', [15600]),
    kwsMel: await mk('kws_mel', [1760]),
    kwsEmbedding: await mk('kws_embedding', [1, 76, 32, 1]),
    kwsHead: await mk('kws_head', [1, 16, 96]),
  };
}

const silentSource = (): AudioSource => ({ start: async () => {}, stop: () => {}, addListener: () => () => {} });
const allOn = () => ({
  shout: { enabled: true, sensitivity: 'medium' as const },
  help: { enabled: true, sensitivity: 'medium' as const },
  cry: { enabled: true, sensitivity: 'medium' as const },
  bachao: { enabled: true, sensitivity: 'medium' as const },
});

interface Case {
  file: string;
  expect: TriggerId | null;
  group: string;
}

test('real audio through the full detector', { skip: !DIR && 'NS_TEST_MODELS not set' }, async () => {
  const models = await loadOnnx();
  const cases: Case[] = JSON.parse(fs.readFileSync(path.join(DIR!, 'cases.json'), 'utf8'));
  const tally: Record<string, { n: number; ok: number }> = {};
  const failures: string[] = [];
  let clock = 0;
  for (const c of cases) {
    const det = new EmergencySoundDetector(silentSource(), async () => models, allOn(), () => clock);
    const seen: Detection[] = [];
    det.onDetection((d) => seen.push(d));
    await det.start();
    const audio = readWav16k(path.join(DIR!, c.file));
    const padded = new Float32Array(audio.length + 16000);
    padded.set(audio);
    // Real time: one 128 ms chunk at a time (the detector drops backlog older
    // than 3 s, exactly as it would if the phone could not keep up).
    for (let i = 0; i < padded.length; i += 2048) {
      det.enqueue(padded.subarray(i, i + 2048));
      await det.flush();
      clock += 128;
    }
    await det.flush();
    det.stop();
    const fired = new Set(seen.map((d) => d.trigger));
    const ok = c.expect ? fired.has(c.expect) : fired.size === 0;
    const t = (tally[c.group] ??= { n: 0, ok: 0 });
    t.n++;
    if (ok) t.ok++;
    else failures.push(`${c.file}: expected ${c.expect ?? 'nothing'}, got [${[...fired].join(',')}]`);
  }
  const lines = Object.entries(tally).map(([g, t]) => `${g}: ${t.ok}/${t.n}`);
  console.log(lines.join('\n'));
  if (process.env.NS_TEST_VERBOSE) console.log(failures.join('\n'));
  fs.writeFileSync(path.join(DIR!, 'ts_results.json'), JSON.stringify({ tally, failures }, null, 1));
  // Gates (see REPORT.md for how they were set): every group must clear its bar.
  const bars = JSON.parse(fs.readFileSync(path.join(DIR!, 'bars.json'), 'utf8')) as Record<string, number>;
  for (const [g, bar] of Object.entries(bars)) {
    const t = tally[g];
    assert.ok(t, `group ${g} missing`);
    assert.ok(t.ok / t.n >= bar, `${g}: ${t.ok}/${t.n} below ${bar}`);
  }
});

test('TypeScript keyword front-end matches the Python reference used for training', { skip: !DIR && 'NS_TEST_MODELS not set' }, async () => {
  const models = await loadOnnx();
  const ref = JSON.parse(fs.readFileSync(path.join(DIR!, 'kws_reference.json'), 'utf8')) as {
    file: string;
    scores: [number, number][];
  }[];
  let maxDiff = 0;
  let gatedDiff = 0;
  let gatedHops = 0;
  for (const r of ref) {
    // The reference has no silence gate: compare with it disabled …
    const k = new KeywordSpotter(models.kwsMel, models.kwsEmbedding, models.kwsHead, { gateDb: -Infinity });
    const audio = readWav16k(path.join(DIR!, r.file));
    const got = await k.push(audio);
    assert.equal(got.length, r.scores.length, `${r.file}: score count`);
    got.forEach((s, i) => {
      maxDiff = Math.max(maxDiff, Math.abs(s.help - r.scores[i][0]), Math.abs(s.bachao - r.scores[i][1]));
    });
    // … and check that the gated spotter (what the app runs) gives the same
    // scores wherever it ran, in real-time sized chunks.
    const g = new KeywordSpotter(models.kwsMel, models.kwsEmbedding, models.kwsHead);
    const gotGated = [];
    for (let i = 0; i < audio.length; i += 2048) gotGated.push(...(await g.push(audio.subarray(i, i + 2048))));
    assert.equal(gotGated.length, got.length, `${r.file}: gated score count`);
    gotGated.forEach((s, i) => {
      if (s.gated) gatedHops++;
      else gatedDiff = Math.max(gatedDiff, Math.abs(s.help - got[i].help), Math.abs(s.bachao - got[i].bachao));
    });
  }
  console.log(`max |TS − Python| keyword score difference: ${maxDiff.toExponential(2)}`);
  console.log(`max |gated − ungated| difference: ${gatedDiff.toExponential(2)} (${gatedHops} silent hops skipped)`);
  assert.ok(maxDiff < 2e-3);
  assert.ok(gatedDiff < 1e-5);
});
