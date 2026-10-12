import { FakeClock, flush } from './helpers';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ConfirmResult,
  NetworkUnavailableError,
  SoftAlertDeps,
  SoftAlertManager,
} from '../src/services/emergency/SoftAlertManager';
import type { AlertHistoryEntry } from '../src/services/emergency/alertHistory';

function setup(over: Partial<SoftAlertDeps> = {}, apiOver: Partial<SoftAlertDeps['api']> = {}) {
  const clock = new FakeClock();
  const history = new Map<string, AlertHistoryEntry>();
  const calls: string[] = [];
  let sosActive = false;
  let resolveCreate: ((id: string) => void) | null = null;
  const deps: SoftAlertDeps = {
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    getLocation: async () => ({ latitude: 23.8, longitude: 90.4, accuracy: 10 }),
    api: {
      createSoftAlert: async (_c, meta) => {
        calls.push(`create:${meta.trigger}`);
        return 'srv-1';
      },
      cancelSoftAlert: async (id) => {
        calls.push(`cancel:${id}`);
      },
      confirmSoftAlert: async (id) => {
        calls.push(`confirm:${id}`);
        return { alertId: id, trackingToken: 'tok', contactPhones: ['+8801'] };
      },
      createSos: async () => {
        calls.push('sos');
        return { alertId: 'sos-1' };
      },
      ...apiOver,
    },
    sendOfflineSms: async () => {
      calls.push('offline-sms');
      return true;
    },
    sendFallbackSms: async () => {
      calls.push('fallback-sms');
    },
    isSosActive: () => sosActive,
    onSosActivated: (r: ConfirmResult, off: boolean) => {
      calls.push(`activated:${r.alertId}:${off}`);
      sosActive = !off;
    },
    history: {
      add: (e) => history.set(e.id, { ...e }),
      update: (id, p) => history.set(id, { ...(history.get(id) as AlertHistoryEntry), ...p }),
    },
    feedback: { start: () => calls.push('feedback:start'), stop: (_a, o) => calls.push(`feedback:stop:${o}`) },
    isBackground: () => false,
    cooldownMs: () => 60_000,
    ...over,
  };
  const m = new SoftAlertManager(deps);
  return {
    m,
    clock,
    history,
    calls,
    setSos: (v: boolean) => (sosActive = v),
    deferCreate: () => {
      deps.api.createSoftAlert = () => new Promise((r) => (resolveCreate = r));
      return (id: string) => resolveCreate?.(id);
    },
  };
}

test('no answer for 15 s → soft alert confirmed on the server, SOS activated', async () => {
  const { m, clock, history, calls } = setup();
  const r = m.trigger('shout', { confidence: 0.9 });
  assert.equal(r.accepted, true);
  await flush();
  assert.ok(calls.includes('create:shout'));
  await clock.advance(14_000);
  assert.ok(!calls.some((c) => c.startsWith('confirm')), 'must not send before 15 s');
  await clock.advance(1_500);
  assert.ok(calls.includes('confirm:srv-1'));
  assert.ok(calls.includes('activated:srv-1:false'));
  const e = [...history.values()][0];
  assert.equal(e.outcome, 'auto_confirmed');
  assert.equal(e.alertId, 'srv-1');
  assert.equal(m.active, null);
});

test('"I\'m okay" cancels on the server and starts the cooldown', async () => {
  const { m, clock, history, calls } = setup();
  m.trigger('help', { confidence: 0.8 });
  await flush();
  await m.cancel();
  assert.ok(calls.includes('cancel:srv-1'));
  await clock.advance(20_000);
  assert.ok(!calls.some((c) => c.startsWith('confirm')), 'cancelled alert must never be confirmed');
  assert.equal([...history.values()][0].outcome, 'cancelled');

  const again = m.trigger('help');
  assert.deepEqual(again, { accepted: false, reason: 'cooldown' });
  // the user's own silent alert ignores the cooldown
  assert.equal(m.trigger('manual', { manual: true }).accepted, true);
});

test('cancel before the server alert exists → it is cancelled the moment it is created', async () => {
  const s = setup();
  const resolve = s.deferCreate();
  s.m.trigger('cry');
  await flush();
  await s.m.cancel();
  assert.ok(!s.calls.some((c) => c.startsWith('cancel')));
  resolve('late-1');
  await flush();
  assert.ok(s.calls.includes('cancel:late-1'), 'a late server alert must be cancelled, or the server would escalate it');
});

test('duplicate detections during a countdown are merged, not stacked', async () => {
  const { m, history } = setup();
  m.trigger('shout');
  assert.deepEqual(m.trigger('shout'), { accepted: false, reason: 'active' });
  assert.deepEqual(m.trigger('bachao'), { accepted: false, reason: 'active' });
  assert.equal(history.size, 1);
  assert.equal([...history.values()][0].duplicates, 2);
});

test('detections while an SOS is live are suppressed and logged once per burst', async () => {
  const { m, history, setSos, clock } = setup();
  setSos(true);
  for (let i = 0; i < 5; i++) {
    assert.deepEqual(m.trigger('shout'), { accepted: false, reason: 'sos_active' });
    await clock.advance(1000);
  }
  const rows = [...history.values()];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].outcome, 'suppressed');
  assert.equal(rows[0].count, 5);
});

test('server unreachable → SMS from the phone, recorded as sent_offline', async () => {
  const { m, clock, history, calls } = setup(
    {},
    {
      createSoftAlert: async () => {
        throw new NetworkUnavailableError();
      },
      createSos: async () => {
        throw new NetworkUnavailableError();
      },
    },
  );
  m.trigger('bachao');
  await clock.advance(16_000);
  assert.ok(calls.includes('offline-sms'));
  assert.ok(calls.includes('activated::true'));
  assert.equal([...history.values()][0].outcome, 'sent_offline');
});

test('"I need help" sends immediately; server reports SMS degraded → phone sends the SMS', async () => {
  const confirmed: string[] = [];
  const { m, calls, history } = setup(
    {},
    {
      confirmSoftAlert: async (id) => {
        confirmed.push(id);
        return { alertId: id, degradedNotifications: true, contactPhones: ['+8801'] };
      },
    },
  );
  m.trigger('help');
  await flush();
  await m.confirmNow();
  assert.deepEqual(confirmed, ['srv-1']);
  assert.ok(calls.includes('fallback-sms'));
  assert.equal([...history.values()][0].outcome, 'confirmed');
});

test('nothing works → failed, and the failure stays visible until dismissed', async () => {
  const { m, clock, history } = setup(
    { sendOfflineSms: async () => false },
    {
      confirmSoftAlert: async () => {
        throw new Error('500');
      },
    },
  );
  m.trigger('shout');
  await clock.advance(16_000);
  assert.equal(m.active?.phase, 'failed');
  assert.equal([...history.values()][0].outcome, 'failed');
  m.dismissFailure();
  assert.equal(m.active, null);
});

test('no location fix at all → direct SOS impossible → offline SMS', async () => {
  const { m, clock, calls } = setup({ getLocation: async () => null });
  m.trigger('cry');
  await clock.advance(16_000);
  assert.ok(!calls.some((c) => c.startsWith('create:')));
  assert.ok(calls.includes('offline-sms'));
});

test('SMS limit reached (smsViaDevice) → the phone texts the contacts from its SIM', async () => {
  const { m, calls, history } = setup(
    {},
    {
      confirmSoftAlert: async (id) => ({ alertId: id, smsViaDevice: true, deviceSmsMessage: 'Rina needs help', contactPhones: ['+8801'] }),
    },
  );
  m.trigger('bachao');
  await flush();
  await m.confirmNow();
  assert.ok(calls.includes('fallback-sms'));
  assert.equal([...history.values()][0].outcome, 'confirmed');
});

test('quota available → no phone SMS', async () => {
  const { m, calls } = setup();
  m.trigger('help');
  await flush();
  await m.confirmNow();
  assert.ok(!calls.includes('fallback-sms'));
});
