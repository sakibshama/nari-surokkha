/**
 * Alerts Module — Unit Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AlertsService,
  SoftAlertNotPendingError,
  SOFT_ALERT_ESCALATION_DELAY_MS,
  clampClientTimestamp,
} from '@/modules/alerts/alerts.service';
import { ForbiddenError } from '@/utils/errors';
import { EmergencyAlert } from '@prisma/client';
import { FastifyInstance } from 'fastify';

describe('AlertsService', () => {
  let service: AlertsService;
  let alertsRepo: any;
  let contactsRepo: any;
  let fastifyMock: any;
  let responderRepo: any;

  beforeEach(() => {
    alertsRepo = {
      createAlert: vi.fn(),
      createAuditLog: vi.fn(),
      addLocationUpdate: vi.fn(),
    };

    contactsRepo = {
      getContactsByUserId: vi.fn(),
    };

    fastifyMock = {
      log: {
        warn: vi.fn(),
        info: vi.fn(),
        error: vi.fn(),
      },
      queues: {
        // The service now bounds every enqueue with a timeout, so these must
        // resolve like the real BullMQ Queue.add() does.
        notifications: { add: vi.fn().mockResolvedValue({ id: 'job-notify' }) },
        // The heavy fan-out now goes here instead of running on the request.
        dispatch: { add: vi.fn().mockResolvedValue({ id: 'job-dispatch' }) },
      },
      prisma: {
        responderDispatch: { createMany: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
        deviceToken: { findMany: vi.fn().mockResolvedValue([]) },
        // Location pings authorise through a Redis-cached record that falls
        // back to this lookup.
        emergencyAlert: { findUnique: vi.fn().mockResolvedValue(null) },
      },
      // Live positions are buffered in Redis and flushed by the worker, so the
      // ping path talks to Redis rather than the database.
      redis: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue('OK'),
        del: vi.fn().mockResolvedValue(1),
        multi: vi.fn(),
      },
      io: {
        to: vi.fn().mockReturnThis(),
        emit: vi.fn(),
      },
    };

    responderRepo = {
      findNearbyResponders: vi.fn().mockResolvedValue([]),
      createDispatch: vi.fn(),
    };

    // Chainable pipeline stub for the buffered-write path.
    const pipeline: any = {};
    for (const m of ['set', 'rpush', 'ltrim', 'expire', 'sadd']) {
      pipeline[m] = vi.fn(() => pipeline);
    }
    pipeline.exec = vi.fn().mockResolvedValue([]);
    fastifyMock.redis.multi.mockReturnValue(pipeline);
    fastifyMock.__pipeline = pipeline;

    service = new AlertsService(
      alertsRepo,
      contactsRepo,
      responderRepo as any,
      fastifyMock as unknown as FastifyInstance
    );
  });

  describe('SMS quota → SMS from the phone\'s SIM', () => {
    const alert = { id: 'alert-9', status: 'confirmed', userId: 'user-9', type: 'manual', latitude: 23.7, longitude: 90.4 };
    beforeEach(() => {
      contactsRepo.getContactsByUserId.mockResolvedValue([{ phone: '+8801711111111' }]);
      alertsRepo.createAlert.mockResolvedValue(alert as any);
      fastifyMock.prisma.userProfile = { findUnique: vi.fn().mockResolvedValue({ fullName: 'Rina' }) };
      fastifyMock.settings = { getSmsTemplate: vi.fn().mockResolvedValue('{name} needs help. Live: {trackLink} Map: {mapLink}') };
    });

    it('quota left → server sends the SMS, phone does nothing', async () => {
      fastifyMock.prisma.subscription = { findUnique: vi.fn().mockResolvedValue({ status: 'active', smsRemaining: 5 }) };
      const r = await service.triggerManualSos('user-9', { latitude: 23.7, longitude: 90.4 });
      expect(fastifyMock.queues.notifications.add).toHaveBeenCalledWith(
        'notify_trusted_contacts', expect.objectContaining({ mode: 'all' }), { jobId: 'fanout-alert-9' });
      expect(r.smsViaDevice).toBe(false);
      expect(r.deviceSmsMessage).toBeUndefined();
    });

    it.each([
      ['quota used up', { status: 'active', smsRemaining: 0 }],
      ['plan expired', { status: 'expired', smsRemaining: 40 }],
      ['no plan at all', null],
    ])('%s → phone texts contacts from its SIM; server only pushes', async (_n, sub) => {
      fastifyMock.prisma.subscription = { findUnique: vi.fn().mockResolvedValue(sub) };
      const r = await service.triggerManualSos('user-9', { latitude: 23.7, longitude: 90.4 });
      expect(fastifyMock.queues.notifications.add).toHaveBeenCalledWith(
        'notify_trusted_contacts', expect.objectContaining({ mode: 'push_only' }), { jobId: 'fanout-alert-9' });
      expect(r.smsViaDevice).toBe(true);
      expect(r.contactPhones).toEqual(['+8801711111111']);
      // Same admin template the server would have used, with a live tracking link.
      expect(r.deviceSmsMessage).toMatch(/^Rina needs help\. Live: \S+\/t\/\S{12} Map: https:\/\/maps\.google\.com\/\?q=23\.7,90\.4$/);
    });

    it('contacts already texted from the SIM (offline SOS gone online) → no second SMS', async () => {
      fastifyMock.prisma.subscription = { findUnique: vi.fn().mockResolvedValue({ status: 'active', smsRemaining: 5 }) };
      const r = await service.triggerManualSos('user-9', { latitude: 23.7, longitude: 90.4, contactsTexted: true });
      expect(fastifyMock.queues.notifications.add).toHaveBeenCalledWith(
        'notify_trusted_contacts', expect.objectContaining({ mode: 'push_only' }), { jobId: 'fanout-alert-9' });
      expect(r.smsViaDevice).toBe(false);
    });

    it('same clientSosId twice → one alert, contacts notified once', async () => {
      fastifyMock.prisma.subscription = { findUnique: vi.fn().mockResolvedValue({ status: 'active', smsRemaining: 5 }) };
      const store = new Map<string, string>();
      fastifyMock.redis.set = vi.fn(async (k: string, v: string, ...rest: unknown[]) => {
        if (rest.includes('NX') && store.has(k)) return null;
        store.set(k, v);
        return 'OK';
      });
      fastifyMock.redis.get = vi.fn(async (k: string) => store.get(k) ?? null);
      alertsRepo.getAlertById = vi.fn().mockResolvedValue(alert);

      const first = await service.triggerManualSos('user-9', { latitude: 23.7, longitude: 90.4, clientSosId: 'press-1234' });
      const second = await service.triggerManualSos('user-9', { latitude: 23.7, longitude: 90.4, clientSosId: 'press-1234' });

      expect(alertsRepo.createAlert).toHaveBeenCalledTimes(1);
      expect(fastifyMock.queues.notifications.add).toHaveBeenCalledTimes(1);
      expect(second.id).toBe(first.id);
      expect(second.smsViaDevice).toBe(false);
    });

    it('unreadable subscription fails open (server sends)', async () => {
      fastifyMock.prisma.subscription = { findUnique: vi.fn().mockRejectedValue(new Error('db')) };
      const r = await service.triggerManualSos('user-9', { latitude: 23.7, longitude: 90.4 });
      expect(r.smsViaDevice).toBe(false);
    });

    it('server-side auto-escalation always sends from the server (the phone is not answering)', async () => {
      fastifyMock.prisma.subscription = { findUnique: vi.fn().mockResolvedValue(null) };
      alertsRepo.getAlertById = vi.fn().mockResolvedValue({ ...alert, status: 'created' });
      alertsRepo.updateIfSoftAlertPending = vi.fn().mockResolvedValue({ ...alert, status: 'confirmed' });
      const r = await service.confirmSoftAlert('user-9', 'alert-9', { forceServerSms: true });
      expect(fastifyMock.queues.notifications.add).toHaveBeenCalledWith(
        'notify_trusted_contacts', expect.objectContaining({ mode: 'all' }), { jobId: 'fanout-alert-9' });
      expect(r.smsViaDevice).toBe(false);
    });

    it('phone could not send → server sends anyway (sms_retry)', async () => {
      alertsRepo.getAlertById = vi.fn().mockResolvedValue({ ...alert, status: 'confirmed' });
      const r = await service.requestServerSms('user-9', 'alert-9');
      expect(r.queued).toBe(true);
      expect(fastifyMock.queues.notifications.add).toHaveBeenCalledWith(
        'notify_trusted_contacts', { alertId: 'alert-9', userId: 'user-9', mode: 'sms_retry' }, { jobId: 'fanout-sms-alert-9' });
    });

    it('sms fallback refuses other users\' alerts and closed alerts', async () => {
      alertsRepo.getAlertById = vi.fn().mockResolvedValue({ ...alert, userId: 'someone-else' });
      await expect(service.requestServerSms('user-9', 'alert-9')).rejects.toThrow(ForbiddenError);
      alertsRepo.getAlertById = vi.fn().mockResolvedValue({ ...alert, status: 'resolved' });
      await expect(service.requestServerSms('user-9', 'alert-9')).rejects.toThrow(ForbiddenError);
    });
  });

  describe('triggerManualSos', () => {
    it('allows SOS creation even if user has no trusted contacts', async () => {
      contactsRepo.getContactsByUserId.mockResolvedValue([]);
      alertsRepo.createAlert.mockResolvedValue({ id: 'alert-123', status: 'confirmed', userId: 'user-123', type: 'manual' } as any);

      const result = await service.triggerManualSos('user-123', { latitude: 23.7, longitude: 90.4 });
      expect(result.id).toBe('alert-123');
    });

    it('creates SOS alert successfully and notifies', async () => {
      contactsRepo.getContactsByUserId.mockResolvedValue([{ phone: '+880123' }, { phone: '+880124' }]);
      
      const mockAlert: Partial<EmergencyAlert> = { id: 'alert-123', status: 'confirmed', userId: 'user-123', type: 'manual' };
      alertsRepo.createAlert.mockResolvedValue(mockAlert);

      const result = await service.triggerManualSos(
        'user-123',
        { latitude: 23.7, longitude: 90.4 },
        '192.168.1.1'
      );

      // Verify contact check
      expect(contactsRepo.getContactsByUserId).toHaveBeenCalledWith('user-123');
      
      // Verify DB insertion
      expect(alertsRepo.createAlert).toHaveBeenCalledWith({
        userId: 'user-123',
        latitude: 23.7,
        longitude: 90.4,
        accuracy: undefined,
        status: 'confirmed',
      });

      // Verify trusted-contact notifications are queued (kept on the request
      // path — it is only a Redis push, and it is the most time-critical
      // downstream action). The deterministic jobId is what makes a retried
      // SOS unable to double-notify.
      expect(fastifyMock.queues.notifications.add).toHaveBeenCalledWith(
        'notify_trusted_contacts',
        // No subscription data available → fails open: the server sends the SMS.
        { alertId: 'alert-123', userId: 'user-123', mode: 'all' },
        { jobId: 'fanout-alert-123' },
      );

      // The heavy fan-out (audit log, responder dispatch) is handed to
      // the dispatch queue rather than run inline.
      expect(fastifyMock.queues.dispatch.add).toHaveBeenCalledWith(
        'fan_out_alert',
        expect.objectContaining({
          alertId: 'alert-123',
          userId: 'user-123',
          ipAddress: '192.168.1.1',
        }),
        { jobId: 'dispatch-alert-123' },
      );

      // ...and therefore does NOT happen on the request itself.
      expect(alertsRepo.createAuditLog).not.toHaveBeenCalled();
      expect(responderRepo.findNearbyResponders).not.toHaveBeenCalled();

      // Verify WebSocket
      expect(fastifyMock.io.to).toHaveBeenCalledWith('admin:global');
      expect(fastifyMock.io.emit).toHaveBeenCalledWith('alert:created', expect.objectContaining({
        alertId: 'alert-123',
      }));

      expect(result.id).toBe(mockAlert.id);
    });

  });

  describe('updateLocation', () => {
    /** Seed the authorisation record the ping path reads from Redis. */
    const cacheMeta = (meta: unknown) =>
      fastifyMock.redis.get.mockResolvedValue(JSON.stringify(meta));

    it('throws ForbiddenError if alert is not found', async () => {
      fastifyMock.redis.get.mockResolvedValue(null);
      fastifyMock.prisma.emergencyAlert.findUnique.mockResolvedValue(null);

      await expect(
        service.updateLocation('user-123', 'alert-404', { latitude: 23.7, longitude: 90.4 })
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError if user is not the owner', async () => {
      cacheMeta({ userId: 'other-user', status: 'in_progress' });

      await expect(
        service.updateLocation('user-123', 'alert-123', { latitude: 23.7, longitude: 90.4 })
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError if alert is closed', async () => {
      cacheMeta({ userId: 'user-123', status: 'closed' });

      await expect(
        service.updateLocation('user-123', 'alert-123', { latitude: 23.7, longitude: 90.4 })
      ).rejects.toThrow(ForbiddenError);
    });

    it('buffers the position and emits to the admin room immediately', async () => {
      cacheMeta({ userId: 'user-123', status: 'in_progress' });

      await service.updateLocation('user-123', 'alert-123', { latitude: 23.8, longitude: 90.5 });

      // Written to Redis, not straight to Postgres.
      expect(fastifyMock.__pipeline.rpush).toHaveBeenCalled();
      expect(fastifyMock.__pipeline.exec).toHaveBeenCalled();

      // Liveness is unchanged: the portal still hears about it on this request.
      expect(fastifyMock.io.to).toHaveBeenCalledWith(
        expect.arrayContaining(['alert:alert-123', 'admin:global']),
      );
      expect(fastifyMock.io.emit).toHaveBeenCalledWith('alert:location_update', expect.objectContaining({
        alertId: 'alert-123',
        latitude: 23.8,
        longitude: 90.5
      }));
    });

    it('costs no database round trip when the alert is cached', async () => {
      cacheMeta({ userId: 'user-123', status: 'in_progress' });

      await service.updateLocation('user-123', 'alert-123', { latitude: 23.8, longitude: 90.5 });

      // This is the whole point of the change: the highest-frequency write path
      // in the system no longer touches Postgres on the happy path.
      expect(fastifyMock.prisma.emergencyAlert.findUnique).not.toHaveBeenCalled();
      expect(alertsRepo.addLocationUpdate).not.toHaveBeenCalled();
    });
  });

  describe('createSoftAlert', () => {
    it('creates an alert with status created and isSoftAlert true', async () => {
      alertsRepo.createAlert.mockResolvedValue({ id: 'alert-soft' });

      await service.createSoftAlert('user-123', { latitude: 23, longitude: 90 });

      expect(alertsRepo.createAlert).toHaveBeenCalledWith(expect.objectContaining({
        type: 'sensor_triggered',
        status: 'created',
        isSoftAlert: true,
      }));
    });
  });

  describe('cancelSoftAlert', () => {
    it('sets status to false_alarm, conditionally on the alert still being soft', async () => {
      alertsRepo.getAlertById = vi.fn().mockResolvedValue({ userId: 'user-123', status: 'created' });
      alertsRepo.updateIfSoftAlertPending = vi.fn().mockResolvedValue({ id: 'alert-soft' });

      await service.cancelSoftAlert('user-123', 'alert-soft');

      expect(alertsRepo.updateIfSoftAlertPending).toHaveBeenCalledWith('alert-soft', expect.objectContaining({
        status: 'false_alarm',
      }), expect.objectContaining({ actorKind: 'user', actorId: 'user-123' }));
    });

    it('throws if not created status', async () => {
      alertsRepo.getAlertById = vi.fn().mockResolvedValue({ userId: 'user-123', status: 'confirmed' });
      await expect(service.cancelSoftAlert('user-123', 'alert-soft')).rejects.toThrow(ForbiddenError);
    });

    it('loses cleanly to an escalation that landed between the read and the write', async () => {
      alertsRepo.getAlertById = vi.fn().mockResolvedValue({ userId: 'user-123', status: 'created' });
      alertsRepo.updateIfSoftAlertPending = vi.fn().mockResolvedValue(null);
      await expect(service.cancelSoftAlert('user-123', 'alert-soft')).rejects.toBeInstanceOf(SoftAlertNotPendingError);
    });
  });

  describe('confirmSoftAlert', () => {
    it('updates status to confirmed and dispatches', async () => {
      alertsRepo.getAlertById = vi.fn().mockResolvedValue({
        id: 'alert-soft',
        userId: 'user-123',
        status: 'created',
        latitude: 23,
        longitude: 90,
      });
      contactsRepo.getContactsByUserId.mockResolvedValue([{ phone: '+880123' }]);
      alertsRepo.updateIfSoftAlertPending = vi.fn().mockResolvedValue({
        id: 'alert-soft',
        userId: 'user-123',
        status: 'confirmed',
        latitude: 23,
        longitude: 90,
      });

      await service.confirmSoftAlert('user-123', 'alert-soft');

      expect(alertsRepo.updateIfSoftAlertPending).toHaveBeenCalledWith('alert-soft', expect.objectContaining({
        status: 'confirmed',
      }), expect.objectContaining({ actorKind: 'user', actorId: 'user-123' }));
      // The audit log now lives in the queued fan-out, not on the request.
      expect(fastifyMock.queues.dispatch.add).toHaveBeenCalledWith(
        'fan_out_alert',
        expect.objectContaining({ alertId: 'alert-soft' }),
        { jobId: 'dispatch-alert-soft' },
      );
      expect(fastifyMock.io.to).toHaveBeenCalledWith('admin:global');
    });

    it('auto-escalation after a cancel is a no-op, not an SOS', async () => {
      alertsRepo.getAlertById = vi.fn().mockResolvedValue({ id: 'a', userId: 'user-123', status: 'created' });
      alertsRepo.updateIfSoftAlertPending = vi.fn().mockResolvedValue(null); // cancel won the race
      fastifyMock.log.debug = vi.fn();

      await expect(service.autoEscalateSoftAlert('a', 'user-123')).resolves.toBe(false);
      expect(fastifyMock.queues.dispatch.add).not.toHaveBeenCalled();
      expect(fastifyMock.queues.notifications.add).not.toHaveBeenCalled();
    });
  });

  describe('soft-alert escalation scheduling', () => {
    afterEach(() => vi.useRealTimers());

    it('queues a delayed, de-duplicated escalation job', async () => {
      fastifyMock.queues.escalations = { add: vi.fn().mockResolvedValue({ id: 'j' }) };
      alertsRepo.createAlert.mockResolvedValue({ id: 'alert-soft' });
      await service.createSoftAlert('user-1', { latitude: 23, longitude: 90 });
      expect(fastifyMock.queues.escalations.add).toHaveBeenCalledWith(
        'auto_escalate_soft_alert',
        { alertId: 'alert-soft', userId: 'user-1' },
        { delay: SOFT_ALERT_ESCALATION_DELAY_MS, jobId: 'escalate-alert-soft' },
      );
    });

    it('falls back to an in-process timer when the queue is unavailable', async () => {
      vi.useFakeTimers();
      fastifyMock.queues.escalations = { add: vi.fn().mockRejectedValue(new Error('redis down')) };
      alertsRepo.createAlert.mockResolvedValue({ id: 'alert-soft' });
      const escalate = vi.spyOn(service, 'autoEscalateSoftAlert').mockResolvedValue(true);

      await service.createSoftAlert('user-1', { latitude: 23, longitude: 90 });
      expect(escalate).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(SOFT_ALERT_ESCALATION_DELAY_MS);
      expect(escalate).toHaveBeenCalledWith('alert-soft', 'user-1');
      expect(fastifyMock.log.error).toHaveBeenCalled();
    });
  });

  describe('updateRouteLocation (safe-route deviation)', () => {
    const waypoints = [{ lat: 23.70, lng: 90.40 }, { lat: 23.71, lng: 90.40 }];
    beforeEach(() => {
      fastifyMock.redis.get.mockResolvedValue(JSON.stringify({ userId: 'user-1', waypoints }));
      fastifyMock.prisma.activeRoute = { updateMany: vi.fn() };
      alertsRepo.createAlert.mockResolvedValue({ id: 'soft-1' });
      fastifyMock.queues.escalations = { add: vi.fn().mockResolvedValue({ id: 'j' }) };
    });

    it('on route: no status change, no alert', async () => {
      const r = await service.updateRouteLocation('user-1', 'route-1', 23.705, 90.4001);
      expect(r.deviated).toBe(false);
      expect(r.alertId).toBeUndefined();
      expect(fastifyMock.prisma.activeRoute.updateMany).not.toHaveBeenCalled();
    });

    it('raises exactly one soft alert on the active→deviated transition', async () => {
      fastifyMock.prisma.activeRoute.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValue({ count: 0 });

      const first = await service.updateRouteLocation('user-1', 'route-1', 23.705, 90.42);
      const second = await service.updateRouteLocation('user-1', 'route-1', 23.705, 90.43);

      expect(first).toMatchObject({ deviated: true, alertId: 'soft-1' });
      expect(first.distanceM).toBeGreaterThan(500);
      expect(second.deviated).toBe(true);
      expect(second.alertId).toBeUndefined();
      expect(alertsRepo.createAlert).toHaveBeenCalledTimes(1);
      expect(fastifyMock.prisma.activeRoute.updateMany).toHaveBeenCalledWith({
        where: { id: 'route-1', status: 'active' },
        data: { status: 'deviated' },
      });
    });

    it("rejects someone else's route", async () => {
      await expect(service.updateRouteLocation('intruder', 'route-1', 23.7, 90.4)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('resolveOwnAlert', () => {
    it("owner marks an active alert resolved and the alert room hears it", async () => {
      alertsRepo.getAlertById = vi.fn().mockResolvedValue({ id: 'a1', userId: 'user-1', status: 'confirmed' });
      alertsRepo.updateAlert = vi.fn().mockResolvedValue({ id: 'a1', status: 'resolved' });

      const r = await service.resolveOwnAlert('user-1', 'a1');

      expect(r.status).toBe('resolved');
      expect(alertsRepo.updateAlert).toHaveBeenCalledWith('a1', expect.objectContaining({ status: 'resolved' }),
        expect.objectContaining({ fromStatus: 'confirmed', actorKind: 'user', actorId: 'user-1' }));
      expect(fastifyMock.io.to).toHaveBeenCalledWith(['alert:a1', 'admin:global']);
      expect(fastifyMock.io.emit).toHaveBeenCalledWith('alert_status_update', { alertId: 'a1', status: 'resolved' });
    });

    it('is idempotent for an already-closed alert and forbidden for others', async () => {
      alertsRepo.getAlertById = vi.fn().mockResolvedValue({ id: 'a1', userId: 'user-1', status: 'false_alarm' });
      alertsRepo.updateAlert = vi.fn();
      await service.resolveOwnAlert('user-1', 'a1');
      expect(alertsRepo.updateAlert).not.toHaveBeenCalled();
      await expect(service.resolveOwnAlert('user-2', 'a1')).rejects.toThrow(ForbiddenError);
    });
  });

  describe('ending an SOS closes its responder dispatches', () => {
    const open = [
      { id: 'd1', responderId: 'r1', status: 'pending', responder: { userId: 'u1' } },
      { id: 'd2', responderId: 'r2', status: 'accepted', responder: { userId: 'u2' } },
    ];
    beforeEach(() => {
      fastifyMock.prisma.responderDispatch.findMany.mockResolvedValue(open);
      fastifyMock.prisma.responderDispatch.updateMany = vi.fn().mockResolvedValue({ count: 2 });
      fastifyMock.prisma.responder = { updateMany: vi.fn().mockResolvedValue({ count: 1 }) };
    });

    it.each([
      ['cancelSosAlert', 'false_alarm'],
      ['resolveOwnAlert', 'resolved'],
    ] as const)('%s → dispatches closed, responders told, alert room hears it', async (method, status) => {
      alertsRepo.getAlertById = vi.fn().mockResolvedValue({ id: 'a1', userId: 'user-1', status: 'in_progress' });
      alertsRepo.updateAlert = vi.fn().mockResolvedValue({ id: 'a1', status });

      await (service as any)[method]('user-1', 'a1');

      expect(fastifyMock.prisma.responderDispatch.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['d1', 'd2'] }, status: { in: ['pending', 'accepted', 'arrived'] } },
        data: { status: 'closed', closedAt: expect.any(Date) },
      });
      expect(fastifyMock.prisma.responder.updateMany).toHaveBeenCalledTimes(1); // only the accepted one was busy
      expect(fastifyMock.io.to).toHaveBeenCalledWith('user:u1');
      expect(fastifyMock.io.to).toHaveBeenCalledWith('user:u2');
      expect(fastifyMock.io.emit).toHaveBeenCalledWith('responder:dispatch_closed',
        expect.objectContaining({ alertId: 'a1', status: 'closed', alertStatus: status }));
      expect(fastifyMock.io.to).toHaveBeenCalledWith(['alert:a1', 'admin:global']);
      expect(fastifyMock.io.emit).toHaveBeenCalledWith('alert_status_update', { alertId: 'a1', status });
    });

    it('a failing close never fails the cancel', async () => {
      alertsRepo.getAlertById = vi.fn().mockResolvedValue({ id: 'a1', userId: 'user-1', status: 'confirmed' });
      alertsRepo.updateAlert = vi.fn().mockResolvedValue({ id: 'a1', status: 'false_alarm' });
      fastifyMock.prisma.responderDispatch.findMany.mockRejectedValue(new Error('db down'));
      await expect(service.cancelSosAlert('user-1', 'a1')).resolves.toBeUndefined();
    });
  });

  describe('clampClientTimestamp', () => {
    const now = Date.parse('2026-10-12T12:00:00.000Z');
    it('accepts ISO strings and epoch milliseconds', () => {
      expect(clampClientTimestamp('2026-10-12T11:50:00.000Z', now)).toBe('2026-10-12T11:50:00.000Z');
      expect(clampClientTimestamp(now - 60_000, now)).toBe('2026-10-12T11:59:00.000Z');
      expect(clampClientTimestamp(String(now - 60_000), now)).toBe('2026-10-12T11:59:00.000Z');
    });
    it('clamps the future to now and the distant past to one hour', () => {
      expect(clampClientTimestamp(now + 60_000, now)).toBe('2026-10-12T12:00:00.000Z');
      expect(clampClientTimestamp('2026-10-11T00:00:00Z', now)).toBe('2026-10-12T11:00:00.000Z');
      expect(clampClientTimestamp('garbage', now)).toBe('2026-10-12T12:00:00.000Z');
      expect(clampClientTimestamp(undefined, now)).toBe('2026-10-12T12:00:00.000Z');
    });
  });

  // ── The queued half of an SOS ────────────────────────────────────────────
  describe('fanOutAlert', () => {
    const payload = {
      alertId: 'alert-1',
      userId: 'user-1',
      latitude: 23.7,
      longitude: 90.4,
      alertType: 'manual',
      ipAddress: '10.0.0.1',
    };

    it('writes the audit log', async () => {
      await service.fanOutAlert(payload);

      expect(alertsRepo.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          action: 'sos_triggered',
          entityId: 'alert-1',
        }),
      );
    });

    it('inserts every responder dispatch in ONE query, not one per responder', async () => {
      responderRepo.findNearbyResponders.mockResolvedValue([
        { id: 'r1', userId: 'u1', distanceMeters: 100 },
        { id: 'r2', userId: 'u2', distanceMeters: 250 },
        { id: 'r3', userId: 'u3', distanceMeters: 900 },
      ]);
      fastifyMock.prisma.responderDispatch.findMany.mockResolvedValue([
        { id: 'd1', responderId: 'r1' },
        { id: 'd2', responderId: 'r2' },
        { id: 'd3', responderId: 'r3' },
      ]);

      await service.fanOutAlert(payload);

      expect(fastifyMock.prisma.responderDispatch.createMany).toHaveBeenCalledTimes(1);
      expect(fastifyMock.prisma.responderDispatch.createMany).toHaveBeenCalledWith({
        data: [
          { responderId: 'r1', alertId: 'alert-1', distanceMeters: 100 },
          { responderId: 'r2', alertId: 'alert-1', distanceMeters: 250 },
          { responderId: 'r3', alertId: 'alert-1', distanceMeters: 900 },
        ],
        skipDuplicates: true,
      });
      // The old code called createDispatch once per responder.
      expect(responderRepo.createDispatch).not.toHaveBeenCalled();
    });

    it('looks up device tokens once for all responders (no N+1)', async () => {
      responderRepo.findNearbyResponders.mockResolvedValue([
        { id: 'r1', userId: 'u1', distanceMeters: 100 },
        { id: 'r2', userId: 'u2', distanceMeters: 250 },
      ]);
      fastifyMock.prisma.responderDispatch.findMany.mockResolvedValue([
        { id: 'd1', responderId: 'r1' },
        { id: 'd2', responderId: 'r2' },
      ]);

      await service.fanOutAlert(payload);

      expect(fastifyMock.prisma.deviceToken.findMany).toHaveBeenCalledTimes(1);
      expect(fastifyMock.prisma.deviceToken.findMany).toHaveBeenCalledWith({
        where: { userId: { in: ['u1', 'u2'] }, isActive: true },
        select: { token: true },
      });
    });

    it('masks the location it sends to responders', async () => {
      responderRepo.findNearbyResponders.mockResolvedValue([
        { id: 'r1', userId: 'u1', distanceMeters: 100 },
      ]);
      fastifyMock.prisma.responderDispatch.findMany.mockResolvedValue([
        { id: 'd1', responderId: 'r1' },
      ]);

      await service.fanOutAlert({ ...payload, latitude: 23.7891, longitude: 90.4123 });

      expect(fastifyMock.io.emit).toHaveBeenCalledWith(
        'responder:dispatch_received',
        expect.objectContaining({ latitude: 23.79, longitude: 90.41 }),
      );
    });

    it('never dispatches the SOS owner, even if they are a nearby verified responder', async () => {
      responderRepo.findNearbyResponders.mockResolvedValue([
        // The SQL excludes the owner; a stale/buggy result is filtered again.
        { id: 'r-own', userId: 'user-1', distanceMeters: 0 },
        { id: 'r2', userId: 'u2', distanceMeters: 250 },
      ]);
      fastifyMock.prisma.responderDispatch.findMany.mockResolvedValue([{ id: 'd2', responderId: 'r2' }]);
      fastifyMock.prisma.deviceToken.findMany.mockResolvedValue([{ token: 'ExponentPushToken[x]' }]);
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ status: 'ok' }] }) });
      vi.stubGlobal('fetch', fetchMock);

      await service.fanOutAlert(payload);
      vi.unstubAllGlobals();

      // Owner passed to the query so SQL excludes them.
      expect(responderRepo.findNearbyResponders).toHaveBeenCalledWith(23.7, 90.4, expect.any(Number), expect.any(Number), 'user-1');
      // No dispatch row for the owner.
      const rows = fastifyMock.prisma.responderDispatch.createMany.mock.calls[0][0].data;
      expect(rows.map((r: any) => r.responderId)).toEqual(['r2']);
      // No socket event to the owner's user room.
      expect(fastifyMock.io.to).not.toHaveBeenCalledWith('user:user-1');
      expect(fastifyMock.io.to).toHaveBeenCalledWith('user:u2');
      expect(fastifyMock.io.emit).toHaveBeenCalledWith('responder:dispatch_received',
        expect.objectContaining({ dispatchId: 'd2', alertId: 'alert-1', alertUserId: 'user-1' }));
      // No push to the owner's devices.
      expect(fastifyMock.prisma.deviceToken.findMany).toHaveBeenCalledWith({
        where: { userId: { in: ['u2'] }, isActive: true },
        select: { token: true },
      });
    });

    it('does not page anyone when the only nearby responder is the owner', async () => {
      responderRepo.findNearbyResponders.mockResolvedValue([{ id: 'r-own', userId: 'user-1', distanceMeters: 0 }]);
      await service.fanOutAlert(payload);
      expect(fastifyMock.prisma.responderDispatch.createMany).not.toHaveBeenCalled();
      expect(fastifyMock.io.emit).not.toHaveBeenCalledWith('responder:dispatch_received', expect.anything());
    });

    it('stores the distance with each dispatch', async () => {
      responderRepo.findNearbyResponders.mockResolvedValue([{ id: 'r1', userId: 'u1', distanceMeters: 123.6 }]);
      await service.fanOutAlert(payload);
      expect(fastifyMock.prisma.responderDispatch.createMany).toHaveBeenCalledWith({
        data: [{ responderId: 'r1', alertId: 'alert-1', distanceMeters: 124 }],
        skipDuplicates: true,
      });
    });

    it('pages nobody when the SOS ended before the queued fan-out ran', async () => {
      fastifyMock.prisma.emergencyAlert.findUnique.mockResolvedValue({ status: 'false_alarm' });
      responderRepo.findNearbyResponders.mockResolvedValue([{ id: 'r1', userId: 'u1', distanceMeters: 100 }]);
      await service.fanOutAlert(payload);
      expect(responderRepo.findNearbyResponders).not.toHaveBeenCalled();
      expect(fastifyMock.prisma.responderDispatch.createMany).not.toHaveBeenCalled();
    });

    it('does nothing further when no responders are nearby', async () => {
      responderRepo.findNearbyResponders.mockResolvedValue([]);

      await service.fanOutAlert(payload);

      expect(fastifyMock.prisma.responderDispatch.createMany).not.toHaveBeenCalled();
      expect(fastifyMock.prisma.deviceToken.findMany).not.toHaveBeenCalled();
    });
  });
});

describe('BullMQ job ids', () => {
  // BullMQ throws "Custom Id cannot contain :" for an id with exactly one ':'.
  // That used to make every SOS contact-notification enqueue fail.
  it('every id the alert service enqueues is accepted by BullMQ', async () => {
    const ids: string[] = [];
    const queue = { add: vi.fn(async (_n: string, _d: unknown, o: { jobId: string }) => { ids.push(o.jobId); return { id: o.jobId }; }) };
    const fastify = {
      log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
      queues: { notifications: queue, dispatch: queue, escalations: queue },
      prisma: { subscription: { findUnique: vi.fn().mockResolvedValue({ status: 'active', smsRemaining: 5 }) } },
      io: { to: vi.fn().mockReturnThis(), emit: vi.fn() },
    };
    const repo = {
      createAlert: vi.fn().mockResolvedValue({ id: 'a1', userId: 'u1', status: 'confirmed', type: 'manual', latitude: 1, longitude: 1 }),
      getAlertById: vi.fn().mockResolvedValue({ id: 'a1', userId: 'u1', status: 'confirmed' }),
    };
    const svc = new AlertsService(repo as never, { getContactsByUserId: vi.fn().mockResolvedValue([]) } as never, {} as never, fastify as never);
    await svc.triggerManualSos('u1', { latitude: 1, longitude: 1 });
    await svc.createSoftAlert('u1', { latitude: 1, longitude: 1 });
    await svc.requestServerSms('u1', 'a1');

    expect(ids).toHaveLength(4);
    // BullMQ's rule (classes/job.js validateOptions): no ':' unless it has exactly three parts.
    for (const jobId of ids) {
      expect(!jobId.includes(':') || jobId.split(':').length === 3, jobId).toBe(true);
    }
  });
});
