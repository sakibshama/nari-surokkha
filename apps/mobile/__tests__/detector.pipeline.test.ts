/**
 * EmergencySoundDetector plumbing with fake models: no overlapping model
 * runs, bounded backlog without splicing, stop/restart while a run is in
 * flight, combined cues end to end.
 */
import './helpers';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EmergencySoundDetector, AudioSource } from '../src/services/emergency/EmergencySoundDetector';
import type { TensorModel } from '../src/services/emergency/TensorModel';
import type { EmergencyModels } from '../src/services/emergency/tfliteModels';
import type { Detection } from '../src/services/emergency/TriggerDecider';

const allOn = () => ({
  shout: { enabled: true, sensitivity: 'medium' as const },
  help: { enabled: true, sensitivity: 'medium' as const },
  cry: { enabled: true, sensitivity: 'medium' as const },
  bachao: { enabled: true, sensitivity: 'medium' as const },
});
const silentSource = (): AudioSource => ({ start: async () => {}, stop: () => {}, addListener: () => () => {} });
const tick = (ms = 1) => new Promise((r) => setTimeout(r, ms));

interface Probe {
  models: EmergencyModels;
  maxInFlight: number;
  yamInputs: Float32Array[];
}

function slowModels(opts: { delayMs?: number; scream?: number; help?: number } = {}): Probe {
  const p: Probe = { models: null as unknown as EmergencyModels, maxInFlight: 0, yamInputs: [] };
  let inFlight = 0;
  const mk = (out: (x: Float32Array) => Float32Array, record?: (x: Float32Array) => void): TensorModel => ({
    async run([x]) {
      record?.(x.slice());
      inFlight++;
      p.maxInFlight = Math.max(p.maxInFlight, inFlight);
      await tick(opts.delayMs ?? 0);
      inFlight--;
      return [out(x)];
    },
  });
  p.models = {
    yamnet: mk(
      () => {
        const s = new Float32Array(521);
        s[11] = opts.scream ?? 0; // Screaming
        return s;
      },
      (x) => p.yamInputs.push(x),
    ),
    kwsMel: mk(() => new Float32Array(256)),
    kwsEmbedding: mk(() => new Float32Array(96)),
    kwsHead: mk(() => Float32Array.from([opts.help ?? 0, 0])),
  };
  return p;
}

test('model runs never overlap, the backlog is bounded, and dropped audio is never spliced into a window', async () => {
  const p = slowModels({ delayMs: 2 });
  const det = new EmergencySoundDetector(silentSource(), async () => p.models, allOn());
  await det.start();
  // 20 s of audio arriving all at once (the phone could not keep up)
  for (let k = 0; k < 160; k++) det.enqueue(new Float32Array(2048).fill(0.1 + k / 10000));
  await det.flush();
  det.stop();
  // KWS (mel→emb→head) and YAMNet run side by side, but never two of the same pipeline
  assert.ok(p.maxInFlight <= 2, `max in flight ${p.maxInFlight}`);
  assert.ok(det.stats.droppedSeconds > 10, 'old audio was dropped');
  assert.ok(det.stats.processedSeconds <= 3.2, `processed ${det.stats.processedSeconds}s`);
  // each YAMNet window must come from one contiguous run of chunks
  for (const w of p.yamInputs) {
    const ids = [...new Set(Array.from(w, (v) => Math.round((v - 0.1) * 10000)))].sort((a, b) => a - b);
    for (let i = 1; i < ids.length; i++) assert.equal(ids[i], ids[i - 1] + 1, `window spans a gap: ${ids}`);
  }
});

test('stop() while a model run is in flight: nothing is reported afterwards, restart resumes at once', async () => {
  const p = slowModels({ delayMs: 5, scream: 0.95 });
  const det = new EmergencySoundDetector(silentSource(), async () => p.models, allOn());
  const seen: Detection[] = [];
  det.onDetection((d) => seen.push(d));
  await det.start();
  for (let k = 0; k < 20; k++) det.enqueue(new Float32Array(2048).fill(k % 2 ? 0.5 : -0.5));
  await tick(3);
  det.stop();
  await tick(50);
  assert.equal(seen.length, 0, 'no detection after stop()');
  assert.equal(det.getStatus().state, 'stopped');

  await det.start();
  for (let k = 0; k < 20; k++) det.enqueue(new Float32Array(2048).fill(k % 2 ? 0.5 : -0.5));
  await det.flush();
  assert.equal(det.getStatus().state, 'listening');
  assert.ok(seen.some((d) => d.trigger === 'shout'), 'a loud scream is detected after the restart');
  det.stop();
});

test('silence: models stay idle, nothing fires', async () => {
  const p = slowModels({ scream: 0.95, help: 0.99 });
  let runs = 0;
  for (const m of Object.values(p.models)) {
    const run = m.run.bind(m);
    m.run = (x) => {
      runs++;
      return run(x);
    };
  }
  const det = new EmergencySoundDetector(silentSource(), async () => p.models, allOn());
  const seen: Detection[] = [];
  det.onDetection((d) => seen.push(d));
  await det.start();
  for (let k = 0; k < 80; k++) det.enqueue(new Float32Array(2048).fill(0.00005)); // ≈ -86 dBFS, 10 s
  await det.flush();
  det.stop();
  assert.equal(runs, 0);
  assert.equal(seen.length, 0);
  assert.ok(det.stats.gatedHops > 0 && det.stats.gatedWindows > 0);
});

test('a quiet "scream" (below the loudness rule) is ignored; the same scores when loud fire', async () => {
  const run = async (amp: number) => {
    const p = slowModels({ scream: 0.95 });
    const det = new EmergencySoundDetector(silentSource(), async () => p.models, allOn());
    const seen: Detection[] = [];
    det.onDetection((d) => seen.push(d));
    await det.start();
    // 3 s of quiet background, then 2 s at `amp`
    for (let k = 0; k < 24; k++) det.enqueue(new Float32Array(2048).fill(0.0003)); // ≈ -70 dBFS
    for (let k = 0; k < 16; k++) det.enqueue(new Float32Array(2048).fill(amp));
    await det.flush();
    det.stop();
    return { seen, suppressed: det.stats.suppressedShout };
  };
  const quiet = await run(0.003); // ≈ -50 dBFS: above the silence gate, below SHOUT_MIN_DBFS
  assert.equal(quiet.seen.length, 0);
  assert.ok(quiet.suppressed > 0);
  const loud = await run(0.3);
  assert.deepEqual(
    loud.seen.map((d) => d.trigger),
    ['shout'],
  );
});
