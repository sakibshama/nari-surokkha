/**
 * Alerts Module — Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AlertsService } from '@/modules/alerts/alerts.service';
import { ForbiddenError } from '@/utils/errors';
import { EmergencyAlert, PoliceStation } from '@prisma/client';
import { FastifyInstance } from 'fastify';

describe('AlertsService', () => {
  let service: AlertsService;
  let alertsRepo: any;
  let contactsRepo: any;
  let fastifyMock: any;
  let responderRepo: any;
  let casesService: any;

  beforeEach(() => {
    alertsRepo = {
      findNearestPoliceStation: vi.fn(),
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
        notifications: { add: vi.fn() },
        // The heavy fan-out now goes here instead of running on the request.
        dispatch: { add: vi.fn() },
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

    casesService = {
      createCaseFromAlert: vi.fn(),
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
      casesService as any,
      fastifyMock as unknown as FastifyInstance
    );
  });

  describe('triggerManualSos', () => {
    it('allows SOS creation even if user has no trusted contacts', async () => {
      contactsRepo.getContactsByUserId.mockResolvedValue([]);
      alertsRepo.findNearestPoliceStation.mockResolvedValue(null);
      alertsRepo.createAlert.mockResolvedValue({ id: 'alert-123', status: 'confirmed', userId: 'user-123', type: 'manual' } as any);

      const result = await service.triggerManualSos('user-123', { latitude: 23.7, longitude: 90.4 });
      expect(result.id).toBe('alert-123');
    });

    it('creates SOS alert successfully, matches police station, and notifies', async () => {
      contactsRepo.getContactsByUserId.mockResolvedValue([{ phone: '+880123' }, { phone: '+880124' }]);
      
      const mockStation: Partial<PoliceStation> = { id: 'station-123', name: 'Test Thana' };
      alertsRepo.findNearestPoliceStation.mockResolvedValue(mockStation);
      
      const mockAlert: Partial<EmergencyAlert> = { id: 'alert-123', status: 'confirmed', userId: 'user-123', type: 'manual' };
      alertsRepo.createAlert.mockResolvedValue(mockAlert);

      const result = await service.triggerManualSos(
        'user-123',
        { latitude: 23.7, longitude: 90.4 },
        '192.168.1.1'
      );

      // Verify contact check
      expect(contactsRepo.getContactsByUserId).toHaveBeenCalledWith('user-123');
      
      // Verify PostGIS call
      expect(alertsRepo.findNearestPoliceStation).toHaveBeenCalledWith(23.7, 90.4);

      // Verify DB insertion
      expect(alertsRepo.createAlert).toHaveBeenCalledWith({
        userId: 'user-123',
        latitude: 23.7,
        longitude: 90.4,
        accuracy: undefined,
        assignedStationId: 'station-123',
        status: 'confirmed',
      });

      // Verify trusted-contact notifications are queued (kept on the request
      // path — it is only a Redis push, and it is the most time-critical
      // downstream action). The deterministic jobId is what makes a retried
      // SOS unable to double-notify.
      expect(fastifyMock.queues.notifications.add).toHaveBeenCalledWith(
        'notify_trusted_contacts',
        { alertId: 'alert-123', userId: 'user-123' },
        { jobId: 'fanout:alert-123' },
      );

      // The heavy fan-out (audit log, case, responder dispatch) is handed to
      // the dispatch queue rather than run inline.
      expect(fastifyMock.queues.dispatch.add).toHaveBeenCalledWith(
        'fan_out_alert',
        expect.objectContaining({
          alertId: 'alert-123',
          userId: 'user-123',
          stationId: 'station-123',
          ipAddress: '192.168.1.1',
        }),
        { jobId: 'dispatch:alert-123' },
      );

      // ...and therefore does NOT happen on the request itself.
      expect(alertsRepo.createAuditLog).not.toHaveBeenCalled();
      expect(responderRepo.findNearbyResponders).not.toHaveBeenCalled();
      expect(casesService.createCaseFromAlert).not.toHaveBeenCalled();

      // Verify WebSocket
      expect(fastifyMock.io.to).toHaveBeenCalledWith('station:station-123');
      expect(fastifyMock.io.emit).toHaveBeenCalledWith('alert:created', expect.objectContaining({
        alertId: 'alert-123',
      }));

      expect(result.id).toBe(mockAlert.id);
    });

    it('creates SOS alert successfully even if no nearest station is found', async () => {
      contactsRepo.getContactsByUserId.mockResolvedValue([{ phone: '+880123' }]);
      alertsRepo.findNearestPoliceStation.mockResolvedValue(null);
      
      const mockAlert: Partial<EmergencyAlert> = { id: 'alert-123', userId: 'user-123', type: 'manual' };
      alertsRepo.createAlert.mockResolvedValue(mockAlert);

      await service.triggerManualSos(
        'user-123',
        { latitude: 23.7, longitude: 90.4 }
      );

      // Verify alert created without station
      expect(alertsRepo.createAlert).toHaveBeenCalledWith(expect.objectContaining({
        assignedStationId: null,
      }));

      // Verify WebSocket sent to dispatch fallback
      expect(fastifyMock.io.to).toHaveBeenCalledWith('station:dispatch');
      expect(fastifyMock.io.emit).toHaveBeenCalledWith('alert:created', expect.any(Object));
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
      cacheMeta({ userId: 'other-user', status: 'in_progress', assignedStationId: null });

      await expect(
        service.updateLocation('user-123', 'alert-123', { latitude: 23.7, longitude: 90.4 })
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError if alert is closed', async () => {
      cacheMeta({ userId: 'user-123', status: 'closed', assignedStationId: null });

      await expect(
        service.updateLocation('user-123', 'alert-123', { latitude: 23.7, longitude: 90.4 })
      ).rejects.toThrow(ForbiddenError);
    });

    it('buffers the position and emits to the station immediately', async () => {
      cacheMeta({ userId: 'user-123', status: 'in_progress', assignedStationId: 'station-456' });

      await service.updateLocation('user-123', 'alert-123', { latitude: 23.8, longitude: 90.5 });

      // Written to Redis, not straight to Postgres.
      expect(fastifyMock.__pipeline.rpush).toHaveBeenCalled();
      expect(fastifyMock.__pipeline.exec).toHaveBeenCalled();

      // Liveness is unchanged: the portal still hears about it on this request.
      expect(fastifyMock.io.to).toHaveBeenCalledWith(
        expect.arrayContaining(['alert:alert-123', 'station:dispatch', 'station:station-456']),
      );
      expect(fastifyMock.io.emit).toHaveBeenCalledWith('alert:location_update', expect.objectContaining({
        alertId: 'alert-123',
        latitude: 23.8,
        longitude: 90.5
      }));
    });

    it('costs no database round trip when the alert is cached', async () => {
      cacheMeta({ userId: 'user-123', status: 'in_progress', assignedStationId: null });

      await service.updateLocation('user-123', 'alert-123', { latitude: 23.8, longitude: 90.5 });

      // This is the whole point of the change: the highest-frequency write path
      // in the system no longer touches Postgres on the happy path.
      expect(fastifyMock.prisma.emergencyAlert.findUnique).not.toHaveBeenCalled();
      expect(alertsRepo.addLocationUpdate).not.toHaveBeenCalled();
    });
  });

  describe('generateTrackingToken', () => {
    it('returns a JWT token and an expiry date', () => {
      const { token, expiresAt } = service.generateTrackingToken('user-123', 'alert-123', 'contact-123');
      
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(20);
      expect(expiresAt).toBeInstanceOf(Date);
      expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('createSoftAlert', () => {
    it('creates an alert with status created and isSoftAlert true', async () => {
      alertsRepo.findNearestPoliceStation.mockResolvedValue({ id: 'station-123' });
      alertsRepo.createAlert.mockResolvedValue({ id: 'alert-soft' });

      await service.createSoftAlert('user-123', { latitude: 23, longitude: 90 });

      expect(alertsRepo.createAlert).toHaveBeenCalledWith(expect.objectContaining({
        type: 'sensor_triggered',
        status: 'created',
        isSoftAlert: true,
        assignedStationId: 'station-123',
      }));
    });
  });

  describe('cancelSoftAlert', () => {
    it('sets status to false_alarm', async () => {
      alertsRepo.getAlertById = vi.fn().mockResolvedValue({ userId: 'user-123', status: 'created' });
      alertsRepo.updateAlert = vi.fn().mockResolvedValue({});

      await service.cancelSoftAlert('user-123', 'alert-soft');

      expect(alertsRepo.updateAlert).toHaveBeenCalledWith('alert-soft', expect.objectContaining({
        status: 'false_alarm',
      }));
    });

    it('throws if not created status', async () => {
      alertsRepo.getAlertById = vi.fn().mockResolvedValue({ userId: 'user-123', status: 'confirmed' });
      await expect(service.cancelSoftAlert('user-123', 'alert-soft')).rejects.toThrow(ForbiddenError);
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
        assignedStationId: 'station-123'
      });
      contactsRepo.getContactsByUserId.mockResolvedValue([{ phone: '+880123' }]);
      alertsRepo.updateAlert = vi.fn().mockResolvedValue({
        id: 'alert-soft',
        userId: 'user-123',
        status: 'confirmed',
        latitude: 23,
        longitude: 90,
        assignedStationId: 'station-123'
      });

      await service.confirmSoftAlert('user-123', 'alert-soft');

      expect(alertsRepo.updateAlert).toHaveBeenCalledWith('alert-soft', expect.objectContaining({
        status: 'confirmed',
      }));
      // The audit log now lives in the queued fan-out, not on the request.
      expect(fastifyMock.queues.dispatch.add).toHaveBeenCalledWith(
        'fan_out_alert',
        expect.objectContaining({ alertId: 'alert-soft', stationId: 'station-123' }),
        { jobId: 'dispatch:alert-soft' },
      );
      expect(fastifyMock.io.to).toHaveBeenCalledWith('station:station-123');
    });
  });

  // ── The queued half of an SOS ────────────────────────────────────────────
  describe('fanOutAlert', () => {
    const payload = {
      alertId: 'alert-1',
      userId: 'user-1',
      latitude: 23.7,
      longitude: 90.4,
      stationId: 'station-1',
      alertType: 'manual',
      ipAddress: '10.0.0.1',
    };

    it('writes the audit log and opens a case', async () => {
      await service.fanOutAlert(payload);

      expect(alertsRepo.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          action: 'sos_triggered',
          entityId: 'alert-1',
        }),
      );
      expect(casesService.createCaseFromAlert).toHaveBeenCalledWith('alert-1', 'station-1');
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
          { responderId: 'r1', alertId: 'alert-1' },
          { responderId: 'r2', alertId: 'alert-1' },
          { responderId: 'r3', alertId: 'alert-1' },
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

    it('does nothing further when no responders are nearby', async () => {
      responderRepo.findNearbyResponders.mockResolvedValue([]);

      await service.fanOutAlert(payload);

      expect(fastifyMock.prisma.responderDispatch.createMany).not.toHaveBeenCalled();
      expect(fastifyMock.prisma.deviceToken.findMany).not.toHaveBeenCalled();
    });
  });
});
