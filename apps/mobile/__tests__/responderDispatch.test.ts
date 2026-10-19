import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  actionsFor,
  classifyDispatchError,
  closeDispatch,
  formatDistance,
  isOwnSos,
  partitionDispatches,
  upsertDispatch,
  type Dispatch,
} from '../src/services/responderDispatch';

function d(id: string, status: Dispatch['status'], alert: Partial<Dispatch['alert']> = {}): Dispatch {
  return {
    id,
    alertId: alert.id ?? `alert-${id}`,
    status,
    dispatchedAt: '2026-10-19T10:00:00Z',
    alert: { id: `alert-${id}`, userId: 'victim', latitude: 23.79, longitude: 90.41, ...alert },
  };
}

test('own SOS is recognised by owner id or by the active SOS id', () => {
  assert.equal(isOwnSos({ alertId: 'a1', alertUserId: 'me' }, { userId: 'me' }), true);
  assert.equal(isOwnSos(d('1', 'pending', { userId: 'me' }), { userId: 'me' }), true);
  assert.equal(isOwnSos({ alertId: 'a1' }, { userId: 'me', activeAlertId: 'a1' }), true);
  assert.equal(isOwnSos({ alertId: 'a1', alertUserId: 'someone' }, { userId: 'me', activeAlertId: 'a2' }), false);
  assert.equal(isOwnSos(null, { userId: 'me' }), false);
  // Unknown viewer: never claims ownership.
  assert.equal(isOwnSos({ alertId: 'a1', alertUserId: 'x' }, {}), false);
});

test('partition drops own SOS, puts pending first, separates history', () => {
  const list = [
    d('accepted', 'accepted'),
    d('own', 'pending', { userId: 'me' }),
    d('pending', 'pending'),
    d('done', 'completed'),
    d('closed', 'closed'),
    d('declined', 'declined'),
  ];
  const { active, past } = partitionDispatches(list, { userId: 'me' });
  assert.deepEqual(active.map((x) => x.id), ['pending', 'accepted']);
  assert.deepEqual(past.map((x) => x.id), ['done', 'closed', 'declined']);
  assert.deepEqual(partitionDispatches(undefined, {}), { active: [], past: [] });
});

test('actions mirror the server transitions', () => {
  assert.deepEqual(actionsFor('pending'), ['accept', 'reject']);
  assert.deepEqual(actionsFor('accepted'), ['arrive', 'complete', 'withdraw']);
  assert.deepEqual(actionsFor('arrived'), ['complete', 'withdraw']);
  for (const s of ['completed', 'declined', 'withdrawn', 'closed'] as const) assert.deepEqual(actionsFor(s), []);
});

test('upsert replaces in place or prepends', () => {
  const list = [d('1', 'pending'), d('2', 'pending')];
  const next = upsertDispatch(list, d('2', 'accepted'));
  assert.equal(next[1].status, 'accepted');
  assert.equal(list[1].status, 'pending'); // not mutated
  assert.equal(upsertDispatch(list, d('3', 'pending'))[0].id, '3');
  assert.equal(upsertDispatch(list, null), list);
});

test('the SOS ending closes its open dispatches only', () => {
  const list = [d('1', 'accepted', { id: 'A' }), d('2', 'completed', { id: 'A' }), d('3', 'pending', { id: 'B' })];
  list[0].alertId = 'A';
  list[1].alertId = 'A';
  list[2].alertId = 'B';
  const next = closeDispatch(list, { alertId: 'A' });
  assert.deepEqual(next.map((x) => x.status), ['closed', 'completed', 'pending']);
  assert.equal(closeDispatch(list, { dispatchId: '3' })[2].status, 'closed');
});

test('error classification: 409 codes are not errors', () => {
  const err = (status: number, code?: string) => ({ response: { status, data: { error: { code, message: 'm' } } } });
  assert.deepEqual(classifyDispatchError(err(409, 'SOS_ENDED')), { kind: 'ended' });
  assert.deepEqual(classifyDispatchError(err(409, 'OWN_ALERT')), { kind: 'own' });
  assert.deepEqual(classifyDispatchError(err(409, 'DISPATCH_STATE')), { kind: 'stale', message: 'm' });
  assert.deepEqual(classifyDispatchError(err(404)), { kind: 'not_responder' });
  assert.deepEqual(classifyDispatchError(err(500)), { kind: 'error', message: 'm' });
  assert.deepEqual(classifyDispatchError(new Error('Network Error')), { kind: 'offline' });
});

test('distance formatting', () => {
  assert.equal(formatDistance(342), '340 m');
  assert.equal(formatDistance(3), '10 m');
  assert.equal(formatDistance(1234), '1.2 km');
  assert.equal(formatDistance(null), null);
  assert.equal(formatDistance(Number.NaN), null);
});
