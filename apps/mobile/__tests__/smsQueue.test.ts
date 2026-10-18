import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone, prepareRecipients, sendSequentially, MAX_SMS_RECIPIENTS } from '../src/services/smsQueue';

test('normalizePhone keeps a leading + and digits only', () => {
  assert.equal(normalizePhone(' +880 1711-000 111 '), '+8801711000111');
  assert.equal(normalizePhone('(017) 11000111'), '01711000111');
  assert.equal(normalizePhone('ab'), '');
  assert.equal(normalizePhone(''), '');
});

test('prepareRecipients de-duplicates, drops junk and caps the list', () => {
  assert.deepEqual(prepareRecipients(['01711 000111', '01711000111', 'x', '+8801811000222']), [
    '01711000111',
    '+8801811000222',
  ]);
  const many = Array.from({ length: 25 }, (_, i) => `0171100${String(i).padStart(4, '0')}`);
  assert.equal(prepareRecipients(many).length, MAX_SMS_RECIPIENTS);
});

test('sendSequentially sends one at a time, in order, with a gap', async () => {
  const log: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const res = await sendSequentially(
    ['a1', 'b2', 'c3'],
    async (n) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      log.push(`send ${n}`);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      return 'sent';
    },
    { gapMs: 5, sleep: async (ms) => void log.push(`sleep ${ms}`) },
  );
  assert.equal(maxInFlight, 1);
  assert.deepEqual(log, ['send a1', 'sleep 5', 'send b2', 'sleep 5', 'send c3']);
  assert.deepEqual(res, { sent: ['a1', 'b2', 'c3'], failed: [] });
});

test('one failing number does not stop the others; first error is kept', async () => {
  const res = await sendSequentially(
    ['a', 'b', 'c'],
    async (n) => {
      if (n === 'a') throw new Error('SMS part failed: no mobile service');
      if (n === 'b') return 'nope';
      return 'sent';
    },
    { gapMs: 0 },
  );
  assert.deepEqual(res.sent, ['c']);
  assert.deepEqual(res.failed, ['a', 'b']);
  assert.equal(res.error, 'SMS part failed: no mobile service');
});
