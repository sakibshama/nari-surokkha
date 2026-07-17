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

  beforeEach(() => {
    alertsRepo = {
      findNearestPoliceStation: vi.fn(),
      createAlert: vi.fn(),
      createAuditLog: vi.fn(),
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
        notifications: {
          add: vi.fn(),
        },
      },
      io: {
        to: vi.fn().mockReturnThis(),
        emit: vi.fn(),
      },
    };

    const responderRepo = {
      findNearbyResponders: vi.fn().mockResolvedValue([]),
      createDispatch: vi.fn(),
    };

    const casesService = {
      createCaseFromAlert: vi.fn(),
    };

    service = new AlertsService(
      alertsRepo,
      contactsRepo,
      responderRepo as any,
      casesService as any,
      fastifyMock as unknown as FastifyInstance
    );
  });

  describe('triggerManualSos', () => {
    it('throws ForbiddenError if user has no trusted contacts', async () => {
      contactsRepo.getContactsByUserId.mockResolvedValue([]);

      await expect(
        service.triggerManualSos('user-123', { latitude: 23.7, longitude: 90.4 })
      ).rejects.toThrow(ForbiddenError);

      expect(contactsRepo.getContactsByUserId).toHaveBeenCalledWith('user-123');
      expect(alertsRepo.createAlert).not.toHaveBeenCalled();
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

      // Verify audit log
      expect(alertsRepo.createAuditLog).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'user-123',
        action: 'sos_triggered',
        entityId: 'alert-123',
      }));

      // Verify Queue
      expect(fastifyMock.queues.notifications.add).toHaveBeenCalledWith('notify_trusted_contacts', {
        alertId: 'alert-123',
        userId: 'user-123',
      });

      // Verify WebSocket
      expect(fastifyMock.io.to).toHaveBeenCalledWith('station:station-123');
      expect(fastifyMock.io.emit).toHaveBeenCalledWith('alert:created', expect.objectContaining({
        alertId: 'alert-123',
      }));

      expect(result).toEqual(mockAlert);
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
    it('throws ForbiddenError if alert is not found', async () => {
      alertsRepo.getAlertById = vi.fn().mockResolvedValue(null);

      await expect(
        service.updateLocation('user-123', 'alert-404', { latitude: 23.7, longitude: 90.4 })
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError if user is not the owner', async () => {
      alertsRepo.getAlertById = vi.fn().mockResolvedValue({ userId: 'other-user' });

      await expect(
        service.updateLocation('user-123', 'alert-123', { latitude: 23.7, longitude: 90.4 })
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError if alert is closed', async () => {
      alertsRepo.getAlertById = vi.fn().mockResolvedValue({ userId: 'user-123', status: 'closed' });

      await expect(
        service.updateLocation('user-123', 'alert-123', { latitude: 23.7, longitude: 90.4 })
      ).rejects.toThrow(ForbiddenError);
    });

    it('adds location update and emits websocket event', async () => {
      alertsRepo.getAlertById = vi.fn().mockResolvedValue({ 
        userId: 'user-123', 
        status: 'in_progress', 
        assignedStationId: 'station-456' 
      });
      alertsRepo.addLocationUpdate = vi.fn().mockResolvedValue(undefined);

      await service.updateLocation('user-123', 'alert-123', { latitude: 23.8, longitude: 90.5 });

      expect(alertsRepo.addLocationUpdate).toHaveBeenCalledWith('alert-123', 23.8, 90.5, undefined);
      expect(fastifyMock.io.to).toHaveBeenCalledWith('station:station-456');
      expect(fastifyMock.io.emit).toHaveBeenCalledWith('alert:location_update', expect.objectContaining({
        alertId: 'alert-123',
        latitude: 23.8,
        longitude: 90.5
      }));
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
      expect(alertsRepo.createAuditLog).toHaveBeenCalled();
      expect(fastifyMock.io.to).toHaveBeenCalledWith('station:station-123');
    });
  });
});
