import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { PrismaClient } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import * as tokens from '@/modules/alerts/alerts.tokens';

class MockSmsProvider {
  async sendSms(_to: string, _body: string) { return { success: true, messageId: '1' } as any; }
}

vi.mock('@/modules/notifications/providers/push.provider');

describe('NotificationsService', () => {
  let db: any;
  let fastifyMock: any;
  let service: NotificationsService;

  beforeEach(() => {
    db = {
      emergencyAlert: { findUnique: vi.fn() },
      trustedContact: { findMany: vi.fn() },
      notificationLog: { create: vi.fn(), update: vi.fn() },
      user: { findUnique: vi.fn() },
    };

    fastifyMock = {
      log: { error: vi.fn(), warn: vi.fn() },
    };

    service = new NotificationsService(db as unknown as PrismaClient, fastifyMock as unknown as FastifyInstance);
    
    // Mock the generated token
    vi.spyOn(tokens, 'generateTrackingToken').mockReturnValue('mock-jwt-token');
  });

  it('aborts if alert is not found', async () => {
    db.emergencyAlert.findUnique.mockResolvedValue(null);
    await service.processTrustedContactsNotification('alert-1', 'user-1');
    expect(fastifyMock.log.error).toHaveBeenCalledWith('Alert alert-1 not found for notification job.');
  });

  it('aborts if user has no trusted contacts', async () => {
    db.emergencyAlert.findUnique.mockResolvedValue({ id: 'alert-1', user: { profile: { fullName: 'Test' } } });
    db.trustedContact.findMany.mockResolvedValue([]);
    await service.processTrustedContactsNotification('alert-1', 'user-1');
    expect(fastifyMock.log.warn).toHaveBeenCalledWith('No trusted contacts found for user user-1.');
  });

  it('sends SMS successfully', async () => {
    const contact = { id: 'contact-1', phone: '+123456789' };
    
    db.emergencyAlert.findUnique.mockResolvedValue({ 
      id: 'alert-1', 
      user: { profile: { fullName: 'John Doe' } } 
    });
    db.trustedContact.findMany.mockResolvedValue([contact]);
    
    // SMS provider mock
    const mockSmsInstance = new MockSmsProvider();
    mockSmsInstance.sendSms = vi.fn().mockResolvedValue({ success: true, messageId: '123' });
    (service as any).smsProvider = mockSmsInstance;

    // DB mocks for logs
    db.notificationLog.create.mockResolvedValue({ id: 'log-1' });
    db.user.findUnique.mockResolvedValue(null); // No push device for this contact

    await service.processTrustedContactsNotification('alert-1', 'user-1');

    // Assert SMS Intent Log
    expect(db.notificationLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        alertId: 'alert-1',
        channel: 'sms',
        recipient: '+123456789',
        status: 'queued',
        attempts: 1,
      })
    });

    // Assert actual SMS was sent
    expect(mockSmsInstance.sendSms).toHaveBeenCalledWith(
      '+123456789',
      expect.stringContaining('John Doe has triggered an SOS alert')
    );

    // Assert SMS Success Log
    expect(db.notificationLog.update).toHaveBeenCalledWith({
      where: { id: 'log-1' },
      data: expect.objectContaining({
        status: 'sent',
      })
    });
  });

  it('throws an error if SMS fails (to trigger BullMQ retry)', async () => {
    const contact = { id: 'contact-1', phone: '+123456789' };
    
    db.emergencyAlert.findUnique.mockResolvedValue({ 
      id: 'alert-1', 
      user: { profile: { fullName: 'John Doe' } } 
    });
    db.trustedContact.findMany.mockResolvedValue([contact]);
    
    // SMS provider mock returning false
    const mockSmsInstance = new MockSmsProvider();
    mockSmsInstance.sendSms = vi.fn().mockResolvedValue({ success: false, error: 'Network Error' });
    (service as any).smsProvider = mockSmsInstance;

    db.notificationLog.create.mockResolvedValue({ id: 'log-1' });
    db.user.findUnique.mockResolvedValue(null);

    await expect(service.processTrustedContactsNotification('alert-1', 'user-1')).rejects.toThrow(/Notification processing had 1 failures/);

    // Assert Failed Log
    expect(db.notificationLog.update).toHaveBeenCalledWith({
      where: { id: 'log-1' },
      data: expect.objectContaining({
        status: 'failed',
        lastError: 'Network Error',
      })
    });
  });
});
