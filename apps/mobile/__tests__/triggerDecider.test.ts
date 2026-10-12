import './helpers';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TriggerDecider, TriggerConfig } from '../src/services/emergency/TriggerDecider';
import { TRIGGER_RULES, TriggerId } from '../src/services/emergency/constants';

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

test('refractory: one burst = one detection', () => {
  const d = new TriggerDecider(cfg(), 8000);
  let n = 0;
  for (let i = 0; i < 50; i++) if (d.push('help', 0.99, i * 80)) n++;
  assert.equal(n, 1);
  // after the refractory period it can fire again
  for (let i = 0; i < 10; i++) if (d.push('help', 0.99, 9000 + i * 80)) n++;
  assert.equal(n, 2);
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
