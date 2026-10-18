import './helpers';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TriggerDecider, TriggerConfig } from '../src/services/emergency/TriggerDecider';
import {
  COMBINE_WINDOW_MS,
  REARM_MAX_MS,
  REARM_RATIO,
  TRIGGER_RULES,
  TriggerId,
  WEAK_THRESHOLD_RATIO,
} from '../src/services/emergency/constants';

const cfg = (over: Partial<Record<TriggerId, TriggerConfig>> = {}): Record<TriggerId, TriggerConfig> => ({
  shout: { enabled: true, sensitivity: 'medium' },
  help: { enabled: true, sensitivity: 'medium' },
  cry: { enabled: true, sensitivity: 'medium' },
  bachao: { enabled: true, sensitivity: 'medium' },
  ...over,
});

test('fires only when enough of the recent scores pass the threshold', () => {
  const d = new TriggerDecider(cfg());
  const r = TRIGGER_RULES.help.medium;
  let t = 0;
  const fired: number[] = [];
  // one isolated hit, then silence, then `hits` consecutive hits
  const scores = [0.1, r.threshold + 0.01, ...Array(r.window).fill(0.1), ...Array(r.hits).fill(r.threshold + 0.02)];
  for (const s of scores) {
    const det = d.push('help', s, (t += 80));
    if (det) fired.push(t);
  }
  assert.equal(fired.length, 1, 'one isolated hit must not fire; `hits` close hits must');
});

test('refractory + hysteresis: one burst = one detection, a new burst fires again', () => {
  const d = new TriggerDecider(cfg(), 8000);
  let n = 0;
  for (let i = 0; i < 50; i++) if (d.push('help', 0.99, i * 80)) n++;
  assert.equal(n, 1);
  // the event ends (score falls well below the threshold) …
  for (let i = 0; i < 10; i++) if (d.push('help', 0.01, 4000 + i * 80)) n++;
  // … and a new burst after the refractory period fires again
  for (let i = 0; i < 10; i++) if (d.push('help', 0.99, 9000 + i * 80)) n++;
  assert.equal(n, 2);
});

test('hysteresis: a score that never drops does not re-fire every refractory period', () => {
  const d = new TriggerDecider(cfg(), 8000);
  const times: number[] = [];
  // continuous crying at 0.9 for 30 s, one YAMNet score every 500 ms
  for (let t = 0; t <= 30_000; t += 500) if (d.push('cry', 0.9, t)) times.push(t);
  assert.ok(times.length >= 1 && times.length <= 2, `fired at ${times}`);
  assert.equal(times[0], 1000, 'first detection as soon as 3 of 5 scores pass');
  if (times.length === 2) assert.ok(times[1] - times[0] >= REARM_MAX_MS, 'only re-fires after REARM_MAX_MS');
});

test('hysteresis: a dip that stays above the re-arm level does not re-arm', () => {
  const d = new TriggerDecider(cfg(), 0); // no refractory, isolate hysteresis
  const thr = TRIGGER_RULES.help.medium.threshold;
  let n = 0;
  for (let i = 0; i < 4; i++) if (d.push('help', 0.99, i * 80)) n++;
  for (let i = 0; i < 8; i++) if (d.push('help', thr * REARM_RATIO + 0.05, 400 + i * 80)) n++;
  for (let i = 0; i < 4; i++) if (d.push('help', 0.99, 1200 + i * 80)) n++;
  assert.equal(n, 1);
});

test('disabled trigger never fires; others unaffected', () => {
  const d = new TriggerDecider(cfg({ cry: { enabled: false, sensitivity: 'high' } }));
  let cry = 0;
  let shout = 0;
  for (let i = 0; i < 20; i++) {
    if (d.push('cry', 0.99, i * 500)) cry++;
    if (d.push('shout', 0.99, i * 500)) shout++;
  }
  assert.equal(cry, 0);
  assert.ok(shout >= 1);
});

test('sensitivity changes the threshold', () => {
  const s = 0.5 * (TRIGGER_RULES.shout.low.threshold + TRIGGER_RULES.shout.high.threshold);
  const run = (sens: 'low' | 'high') => {
    const d = new TriggerDecider(cfg({ shout: { enabled: true, sensitivity: sens } }));
    let n = 0;
    for (let i = 0; i < 6; i++) if (d.push('shout', s, i * 500)) n++;
    return n;
  };
  assert.equal(run('low'), 0);
  assert.ok(run('high') >= 1);
});

// ── combined cues ──

const weak = (t: TriggerId) => TRIGGER_RULES[t].medium.threshold * WEAK_THRESHOLD_RATIO + 0.01;
const belowStrong = (t: TriggerId) => TRIGGER_RULES[t].medium.threshold - 0.01;

test('a weak keyword cue alone never fires', () => {
  const d = new TriggerDecider(cfg());
  let n = 0;
  for (let i = 0; i < 40; i++) if (d.push('help', belowStrong('help'), i * 80)) n++;
  assert.equal(n, 0);
});

test('a weak shout cue alone never fires', () => {
  const d = new TriggerDecider(cfg());
  let n = 0;
  for (let i = 0; i < 20; i++) if (d.push('shout', i % 3 === 0 ? weak('shout') : 0, i * 500)) n++;
  assert.equal(n, 0);
});

test('weak "help" + weak scream within the combine window fire together', () => {
  const d = new TriggerDecider(cfg());
  assert.equal(d.push('shout', weak('shout'), 1000), null);
  let det = null;
  for (let i = 0; i < 4 && !det; i++) det = d.push('help', weak('help'), 1500 + i * 80);
  assert.ok(det, 'combined detection');
  assert.deepEqual([...det!.combined!].sort(), ['help', 'shout']);
  // both triggers are now in their refractory period
  assert.equal(d.push('shout', 0.99, 1800), null);
});

test('cues further apart than the combine window do not combine', () => {
  const d = new TriggerDecider(cfg());
  d.push('cry', weak('cry'), 0);
  d.push('cry', weak('cry'), 500); // cry weak rule (2 hits) reached at t=500
  let n = 0;
  for (let i = 0; i < 4; i++) if (d.push('bachao', weak('bachao'), 500 + COMBINE_WINDOW_MS + 100 + i * 80)) n++;
  assert.equal(n, 0);
});

test('two keyword cues (same family) do not combine', () => {
  const d = new TriggerDecider(cfg());
  let n = 0;
  for (let i = 0; i < 6; i++) {
    if (d.push('help', weak('help'), i * 80)) n++;
    if (d.push('bachao', weak('bachao'), i * 80)) n++;
  }
  assert.equal(n, 0);
});

test('a disabled trigger cannot be half of a combination', () => {
  const d = new TriggerDecider(cfg({ shout: { enabled: false, sensitivity: 'medium' } }));
  d.push('shout', weak('shout'), 1000);
  let n = 0;
  for (let i = 0; i < 4; i++) if (d.push('help', weak('help'), 1200 + i * 80)) n++;
  assert.equal(n, 0);
});
