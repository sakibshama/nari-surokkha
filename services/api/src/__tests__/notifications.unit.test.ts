import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { PrismaClient } from '@prisma/client';
import { FastifyInstance } from 'fastify';

class MockSmsProvider {
  async sendSms(_to: string, _body: string) {
    return { success: true, messageId: '1' } as any;
  }
}

vi.mock('@/modules/notifications/providers/push.provider');

const ALERT = {
  id: 'alert-1',
  userId: 'user-1',
  latitude: 23.81,
  longitude: 90.41,
  user: { profile: { fullName: 'John Doe' } },
};

describe('NotificationsService', () => {
  let db: any;
  let fastifyMock: any;
  let service: NotificationsService;
  let sms: MockSmsProvider;

  beforeEach(() => {
    db = {
      emergencyAlert: { findUnique: vi.fn().mockResolvedValue(ALERT) },
      trustedContact: { findMany: vi.fn(), findUnique: vi.fn() },
      notificationLog: {
        create: vi.fn().mockResolvedValue({ id: 'log-1' }),
        update: vi.fn(),
        // No prior delivery by default.
        findFirst: vi.fn().mockResolvedValue(null),
      },
      user: { findFirst: vi.fn().mockResolvedValue(null) },
    };

    fastifyMock = {
      log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
      redis: { set: vi.fn().mockResolvedValue('OK') },
      settings: {
        getSmsTemplate: vi
          .fn()
          .mockResolvedValue('{name} has triggered an SOS alert. Track: {trackLink}'),
      },
      queues: { notifications: { addBulk: vi.fn().mockResolvedValue([]) } },
    };

    service = new NotificationsService(
      db as unknown as PrismaClient,
      fastifyMock as unknown as FastifyInstance,
    );

    sms = new MockSmsProvider();
    sms.sendSms = vi.fn().mockResolvedValue({ success: true, messageId: '123' });
    vi.spyOn(service as any, 'resolveSmsProvider').mockResolvedValue(sms);
  });

  // ── Fan-out ──────────────────────────────────────────────────────────────
  describe('processTrustedContactsNotification (fan-out)', () => {
    it('aborts if user has no trusted contacts', async () => {
      db.trustedContact.findMany.mockResolvedValue([]);
      await service.processTrustedContactsNotification('alert-1', 'user-1');
      expect(fastifyMock.log.warn).toHaveBeenCalledWith(
        'No trusted contacts found for user user-1.',
      );
      expect(fastifyMock.queues.notifications.addBulk).not.toHaveBeenCalled();
    });

    it('enqueues one job per contact, each with a deterministic jobId', async () => {
      db.trustedContact.findMany.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }]);

      await service.processTrustedContactsNotification('alert-1', 'user-1');

      expect(fastifyMock.queues.notifications.addBulk).toHaveBeenCalledTimes(1);
      const jobs = fastifyMock.queues.notifications.addBulk.mock.calls[0][0];
      expect(jobs).toHaveLength(3);
      expect(jobs[0]).toEqual({
        name: 'notify_trusted_contact',
        data: { alertId: 'alert-1', contactId: 'c1', mode: 'all' },
        opts: { jobId: 'notify:alert-1:c1' },
      });
      // Deterministic ids are what make a retry idempotent.
      expect(jobs.map((j: any) => j.opts.jobId)).toEqual([
        'notify:alert-1:c1',
        'notify:alert-1:c2',
        'notify:alert-1:c3',
      ]);
    });

    it('falls back to inline delivery when no queue is available', async () => {
      fastifyMock.queues = undefined;
      db.trustedContact.findMany.mockResolvedValue([{ id: 'c1' }]);
      db.trustedContact.findUnique.mockResolvedValue({ id: 'c1', phone: '+8801712345678' });

      await service.processTrustedContactsNotification('alert-1', 'user-1');

      expect(sms.sendSms).toHaveBeenCalledOnce();
    });
  });

  // ── Per-contact delivery ─────────────────────────────────────────────────
  describe('notifyTrustedContact (delivery)', () => {
    beforeEach(() => {
      db.trustedContact.findUnique.mockResolvedValue({ id: 'c1', phone: '+8801712345678' });
    });

    it('aborts without retrying if the alert is gone', async () => {
      db.emergencyAlert.findUnique.mockResolvedValue(null);
      await expect(service.notifyTrustedContact('alert-1', 'c1')).resolves.toBeUndefined();
      expect(sms.sendSms).not.toHaveBeenCalled();
    });

    it('aborts without retrying if the contact was deleted', async () => {
      db.trustedContact.findUnique.mockResolvedValue(null);
      await expect(service.notifyTrustedContact('alert-1', 'c1')).resolves.toBeUndefined();
      expect(sms.sendSms).not.toHaveBeenCalled();
    });

    it('sends SMS and records a sent log', async () => {
      await service.notifyTrustedContact('alert-1', 'c1');

      expect(db.notificationLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          alertId: 'alert-1',
          channel: 'sms',
          recipient: '+8801712345678',
          status: 'queued',
          attempts: 1,
        }),
      });

      expect(sms.sendSms).toHaveBeenCalledWith(
        '+8801712345678',
        expect.stringContaining('John Doe has triggered an SOS alert'),
      );

      expect(db.notificationLog.update).toHaveBeenCalledWith({
        where: { id: 'log-1' },
        data: expect.objectContaining({ status: 'sent' }),
      });
    });

    it("push_only (quota used up — the phone texts from its SIM): no server SMS, push still goes", async () => {
      const push = vi.spyOn(service as any, 'deliverPush').mockResolvedValue(undefined);
      await service.notifyTrustedContact('alert-1', 'c1', 'push_only');
      expect(sms.sendSms).not.toHaveBeenCalled();
      expect(push).toHaveBeenCalledOnce();
    });

    it('sms_retry (the phone could not send): server sends the SMS', async () => {
      await service.notifyTrustedContact('alert-1', 'c1', 'sms_retry');
      expect(sms.sendSms).toHaveBeenCalledOnce();
    });

    // ── Emergency SMS must never depend on a paid plan ──────────────────
    it('texts contacts of a user with NO subscription', async () => {
      db.subscription = { updateMany: vi.fn().mockResolvedValue({ count: 0 }) };
      await service.notifyTrustedContact('alert-1', 'c1');
      expect(sms.sendSms).toHaveBeenCalledOnce();
      expect(db.notificationLog.update).toHaveBeenCalledWith({
        where: { id: 'log-1' },
        data: expect.objectContaining({ status: 'sent' }),
      });
    });

    it('counts SMS against an active plan only after it was sent, and only while quota remains', async () => {
      db.subscription = { updateMany: vi.fn().mockResolvedValue({ count: 1 }) };
      await service.notifyTrustedContact('alert-1', 'c1');
      expect(sms.sendSms).toHaveBeenCalledOnce();
      expect(db.subscription.updateMany).toHaveBeenCalledWith({
        where: { userId: ALERT.userId, status: 'active', smsRemaining: { gt: 0 }, endDate: { gt: expect.any(Date) } },
        data: { smsRemaining: { decrement: 1 } },
      });
    });

    it('a failing quota write neither blocks nor fails a delivered SMS (no duplicate retry)', async () => {
      db.subscription = { updateMany: vi.fn().mockRejectedValue(new Error('db down')) };
      await expect(service.notifyTrustedContact('alert-1', 'c1')).resolves.toBeUndefined();
      expect(sms.sendSms).toHaveBeenCalledOnce();
      expect(db.notificationLog.update).not.toHaveBeenCalledWith({
        where: { id: 'log-1' },
        data: expect.objectContaining({ status: 'failed' }),
      });
    });

    it('does not count usage when the SMS failed', async () => {
      db.subscription = { updateMany: vi.fn() };
      sms.sendSms = vi.fn().mockResolvedValue({ success: false, error: 'Network Error' });
      await expect(service.notifyTrustedContact('alert-1', 'c1')).rejects.toThrow();
      expect(db.subscription.updateMany).not.toHaveBeenCalled();
    });

    it('throws so BullMQ retries THIS contact when SMS fails', async () => {
      sms.sendSms = vi.fn().mockResolvedValue({ success: false, error: 'Network Error' });

      await expect(service.notifyTrustedContact('alert-1', 'c1')).rejects.toThrow(
        /channel failure/,
      );

      expect(db.notificationLog.update).toHaveBeenCalledWith({
        where: { id: 'log-1' },
        data: expect.objectContaining({ status: 'failed', lastError: 'Network Error' }),
      });
    });

    // This is the bug the rewrite exists to fix: a retry must not re-send.
    it('does not re-send SMS that was already delivered for this alert', async () => {
      db.notificationLog.findFirst.mockResolvedValue({ id: 'previous-log' });

      await service.notifyTrustedContact('alert-1', 'c1');

      expect(sms.sendSms).not.toHaveBeenCalled();
      expect(db.notificationLog.create).not.toHaveBeenCalled();
    });

    it('matches a contact to a registered user across phone formats', async () => {
      await service.notifyTrustedContact('alert-1', 'c1');

      expect(db.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { phone: { in: expect.arrayContaining(['+8801712345678', '01712345678']) } },
        }),
      );
    });

    it('creates a stable tracking token for the same alert+contact', async () => {
      await service.notifyTrustedContact('alert-1', 'c1');
      const firstKey = fastifyMock.redis.set.mock.calls[0][0];

      fastifyMock.redis.set.mockClear();
      await service.notifyTrustedContact('alert-1', 'c1');
      const secondKey = fastifyMock.redis.set.mock.calls[0][0];

      expect(secondKey).toBe(firstKey);
    });
  });
});
