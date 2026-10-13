import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideEscalation, ESCALATION_WINDOW_MS } from '../src/services/offlineEscalationCore';

const T0 = 1_700_000_000_000;
const pending = { at: T0, coords: { latitude: 23.8, longitude: 90.4 } };
const ok = { now: T0 + 60_000, online: true, authenticated: true, sosActive: false };

test('escalates once the connection is back within the window', () => {
  assert.deepEqual(decideEscalation(pending, ok), { action: 'escalate' });
});

test('waits while offline or signed out', () => {
  assert.deepEqual(decideEscalation(pending, { ...ok, online: false }), { action: 'wait' });
  assert.deepEqual(decideEscalation(pending, { ...ok, authenticated: false }), { action: 'wait' });
});

test('only once', () => {
  assert.deepEqual(decideEscalation({ ...pending, escalated: true }, ok), { action: 'discard', reason: 'done' });
});

test('not after 30 minutes', () => {
  assert.deepEqual(decideEscalation(pending, { ...ok, now: T0 + ESCALATION_WINDOW_MS }), { action: 'escalate' });
  assert.deepEqual(decideEscalation(pending, { ...ok, now: T0 + ESCALATION_WINDOW_MS + 1 }), {
    action: 'discard',
    reason: 'expired',
  });
  // A clock that moved backwards is not trusted either.
  assert.equal(decideEscalation(pending, { ...ok, now: T0 - 1 }).action, 'discard');
});

test('not when an online SOS is already live', () => {
  assert.deepEqual(decideEscalation(pending, { ...ok, sosActive: true }), { action: 'discard', reason: 'sos_active' });
});

test('nothing pending', () => {
  assert.deepEqual(decideEscalation(null, ok), { action: 'discard', reason: 'none' });
});

test('a pending SOS without coordinates still escalates (the caller finds a position)', () => {
  assert.deepEqual(decideEscalation({ at: T0, coords: null }, ok), { action: 'escalate' });
});
