import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TrackingReasons } from '../src/services/trackingCore';

test('first reason starts tracking, later ones do not', () => {
  const r = new TrackingReasons();
  assert.equal(r.add('sos'), true);
  assert.equal(r.add('route'), false);
  assert.equal(r.add('sos'), false, 'adding the same reason twice is idempotent');
  assert.equal(r.size, 2);
});

test('leaving Safe Route does not stop SOS tracking, and vice versa', () => {
  const r = new TrackingReasons();
  r.add('sos');
  r.add('route');
  assert.equal(r.remove('route'), false, 'SOS still needs it');
  assert.equal(r.has('sos'), true);
  assert.equal(r.remove('sos'), true, 'last reason → stop');
  assert.equal(r.size, 0);
});

test('removing a reason that was never held does not stop anything', () => {
  const r = new TrackingReasons();
  assert.equal(r.remove('route'), false);
  r.add('sos');
  assert.equal(r.remove('route'), false);
  assert.equal(r.has('sos'), true);
});
