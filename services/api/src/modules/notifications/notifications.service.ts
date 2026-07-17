/**
 * Notifications Service
 */

import { PrismaClient, NotificationStatus, NotificationChannel } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { MockPushProvider, PushProvider } from './providers/push.provider';
import { FirebasePushProvider } from './providers/firebase-push.provider';
import { createSmsProvider } from './providers/sms/sms.factory';
import { MockSmsProvider } from './providers/sms/mock-sms.provider';
import { SmsProvider } from './providers/sms/sms.provider';
import { generateTrackingToken } from '../alerts/alerts.tokens';
import { env } from '@/config/env';

export class NotificationsService {
  private pushProvider: PushProvider;

  constructor(
    private readonly db: PrismaClient,
    private readonly fastify: FastifyInstance
  ) {
    if (env.FIREBASE_PROJECT_ID) {
      this.pushProvider = new FirebasePushProvider();
    } else {
      this.pushProvider = new MockPushProvider();
    }
  }

  /**
   * Build the outbound SMS provider from the live admin config. Rebuilt per
   * job so provider/key changes take effect without a restart. Returns
   * null (SMS disabled) or a Mock provider if the settings service or a
   * provider key is unavailable — an SOS must never fail to dispatch.
   */
  private async resolveSmsProvider(): Promise<SmsProvider | null> {
    try {
      const cfg = await this.fastify.settings.getSmsConfig();
      if (!cfg.enabled) return null;
      return createSmsProvider(cfg);
    } catch (err) {
      this.fastify.log.error(err, 'Failed to resolve SMS provider config; using mock');
      return new MockSmsProvider();
    }
  }

  async processTrustedContactsNotification(alertId: string, userId: string): Promise<void> {
    const alert = await this.db.emergencyAlert.findUnique({
      where: { id: alertId },
      include: { user: { include: { profile: true } } },
    });

    if (!alert) {
      this.fastify.log.error(`Alert ${alertId} not found for notification job.`);
      return;
    }

    const contacts = await this.db.trustedContact.findMany({
      where: { userId },
    });

    if (contacts.length === 0) {
      this.fastify.log.warn(`No trusted contacts found for user ${userId}.`);
      return;
    }

    const userName = alert.user.profile?.fullName || 'A user';
    const emergencyMessageBase = `EMERGENCY: ${userName} has triggered an SOS alert via Nari Surokkha.`;
    const mapsLink = `https://maps.google.com/?q=${alert.latitude},${alert.longitude}`;

    // Resolve the outbound SMS provider once (from live admin config).
    const smsProvider = await this.resolveSmsProvider();

    const errors: Error[] = [];

    for (const contact of contacts) {
      // 1. Generate Tracking Token
      const token = generateTrackingToken(alert.id, contact.id);
      const trackingLink = `https://narisurokkha.app/track?token=${token}`;
      const message = `${emergencyMessageBase} Live location: ${mapsLink} — Track: ${trackingLink}`;

      // 2. Send SMS to EVERY trusted contact (this is the primary channel —
      //    most contacts will not have the app installed).
      if (smsProvider) {
        const smsLog = await this.createNotificationLog(alert.id, 'sms', contact.phone, message);
        try {
          const smsResult = await smsProvider.sendSms(contact.phone, message);
          await this.updateNotificationLog(
            smsLog.id,
            smsResult.success ? 'sent' : 'failed',
            smsResult.error,
          );
          if (!smsResult.success) {
            errors.push(new Error(`SMS to ${contact.phone} failed: ${smsResult.error}`));
          }
        } catch (err: any) {
          await this.updateNotificationLog(smsLog.id, 'failed', err.message);
          errors.push(err);
        }
      }

      // 3. Additionally send Push if the contact is also a registered user.
      // Assuming phone numbers match EXACTLY. In a real app, normalize phone numbers.
      const contactUser = await this.db.user.findUnique({
        where: { phone: contact.phone },
        include: { deviceTokens: { where: { isActive: true } } },
      });

      if (contactUser && contactUser.deviceTokens.length > 0) {
        for (const device of contactUser.deviceTokens) {
          const pushLog = await this.createNotificationLog(alert.id, 'push', device.token, message);

          try {
            const pushResult = await this.pushProvider.sendPush(
              device.token,
              `SOS Alert: ${userName}`,
              message
            );

            await this.updateNotificationLog(pushLog.id, pushResult.success ? 'sent' : 'failed', pushResult.error);

            if (!pushResult.success) {
              errors.push(new Error(`Push to FCM token ${device.token.substring(0, 5)}... failed: ${pushResult.error}`));
            }
          } catch (err: any) {
            await this.updateNotificationLog(pushLog.id, 'failed', err.message);
            errors.push(err);
          }
        }
      }
    }

    // 5. Throw an aggregate error if ANY provider failed, triggering BullMQ retry
    // In production, we might want to handle partial failures more gracefully.
    if (errors.length > 0) {
      this.fastify.log.error({ errors }, 'Some notifications failed to send');
      throw new Error(`Notification processing had ${errors.length} failures.`);
    }
  }

  private async createNotificationLog(
    alertId: string, 
    channel: NotificationChannel, 
    recipient: string, 
    message: string
  ) {
    return this.db.notificationLog.create({
      data: {
        alertId,
        channel,
        recipient,
        message,
        status: 'queued',
        attempts: 1,
      },
    });
  }

  private async updateNotificationLog(
    logId: string, 
    status: NotificationStatus, 
    error?: string
  ) {
    return this.db.notificationLog.update({
      where: { id: logId },
      data: {
        status,
        lastError: error,
        sentAt: status === 'sent' ? new Date() : undefined,
      },
    });
  }
}
