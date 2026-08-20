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
import { renderSmsTemplate } from '../settings/settings.types';
import { env } from '@/config/env';
import { phoneVariants } from '@/utils/phone';
import crypto from 'crypto';

const TRACKING_TTL_SECONDS = 24 * 60 * 60; // 24h

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
   * Create a SHORT, opaque tracking token stored in Redis (24h TTL) that maps to
   * the alert. Keeps the SMS link short (~8 chars vs a full JWT) and — unlike the
   * old JWT — is actually resolvable by the public tracking page (/t/:token).
   */
  private async createTrackingToken(alertId: string, contactId: string): Promise<string> {
    // Deterministic, not random: the same (alert, contact) pair always yields
    // the same token. That makes the whole notification job safe to retry —
    // a second attempt refreshes the existing link instead of minting another
    // one — and means a contact who receives two SMS sees one consistent URL.
    //
    // 12 base64url chars ≈ 72 bits of entropy, up from the previous 8 chars
    // (48 bits). This token grants a stranger the live location of someone in
    // danger, so it should not be cheap to guess.
    const token = crypto
      .createHmac('sha256', env.JWT_SECRET)
      .update(`track:${alertId}:${contactId}`)
      .digest('base64url')
      .slice(0, 12);

    await this.fastify.redis.set(
      `track:${token}`,
      JSON.stringify({ alertId, contactId }),
      'EX',
      TRACKING_TTL_SECONDS,
    );
    return token;
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

  /**
   * Fan-out step: turn one alert into one job per trusted contact.
   *
   * Previously this method delivered to every contact inside a single job and
   * threw an aggregate error at the end if ANY channel failed. With
   * `attempts: 3` on the queue, one failed contact meant BullMQ re-ran the
   * whole job — re-sending SMS to every contact who had already received it.
   * For paid SMS during an emergency that is expensive, confusing, and exactly
   * the wrong behaviour.
   *
   * Now each contact is its own job with a deterministic jobId, so a retry
   * retries precisely the delivery that failed.
   */
  async processTrustedContactsNotification(alertId: string, userId: string): Promise<void> {
    const contacts = await this.db.trustedContact.findMany({
      where: { userId },
      select: { id: true },
    });

    if (contacts.length === 0) {
      this.fastify.log.warn(`No trusted contacts found for user ${userId}.`);
      return;
    }

    const queue = this.fastify.queues?.notifications;
    if (!queue) {
      // No queue (tests, or a degraded boot) — deliver inline rather than drop.
      this.fastify.log.warn('Notifications queue unavailable; delivering inline.');
      const results = await Promise.allSettled(
        contacts.map((c) => this.notifyTrustedContact(alertId, c.id)),
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed > 0) throw new Error(`Notification processing had ${failed} failures.`);
      return;
    }

    await queue.addBulk(
      contacts.map((c) => ({
        name: 'notify_trusted_contact',
        data: { alertId, contactId: c.id },
        opts: { jobId: `notify:${alertId}:${c.id}` },
      })),
    );

    this.fastify.log.info(
      { alertId, contacts: contacts.length },
      'Queued trusted-contact notifications',
    );
  }

  /**
   * Deliver one alert to ONE trusted contact, over both channels.
   *
   * Idempotent by design: before sending, each channel checks
   * notification_logs for an already-'sent' record for this
   * (alert, channel, recipient). A retry therefore re-attempts only what
   * genuinely failed, and a contact is never messaged twice for one alert.
   */
  async notifyTrustedContact(alertId: string, contactId: string): Promise<void> {
    const [alert, contact] = await Promise.all([
      this.db.emergencyAlert.findUnique({
        where: { id: alertId },
        include: { user: { include: { profile: true } } },
      }),
      this.db.trustedContact.findUnique({ where: { id: contactId } }),
    ]);

    // Missing rows are permanent conditions, not transient ones — returning
    // (rather than throwing) stops BullMQ burning retries on a lost cause.
    if (!alert) {
      this.fastify.log.error({ alertId }, 'Alert not found for notification job');
      return;
    }
    if (!contact) {
      this.fastify.log.warn({ alertId, contactId }, 'Trusted contact no longer exists; skipping');
      return;
    }

    const userName = alert.user.profile?.fullName || 'A user';
    const mapsLink = `https://maps.google.com/?q=${alert.latitude},${alert.longitude}`;
    const trackingBase = (env.PUBLIC_TRACKING_URL || env.API_BASE_URL).replace(/\/$/, '');

    const [template, token] = await Promise.all([
      this.fastify.settings.getSmsTemplate(),
      this.createTrackingToken(alert.id, contact.id),
    ]);

    const message = renderSmsTemplate(template, {
      name: userName,
      mapLink: mapsLink,
      trackLink: `${trackingBase}/t/${token}`,
      lat: String(alert.latitude),
      lng: String(alert.longitude),
    });

    // SMS and push are independent channels — run them concurrently. Neither
    // should be delayed by the other's provider.
    const outcomes = await Promise.allSettled([
      this.deliverSms(alert.id, contact.phone, message),
      this.deliverPush(alert.id, contact.phone, userName, message),
    ]);

    const failures = outcomes.filter(
      (o): o is PromiseRejectedResult => o.status === 'rejected',
    );

    if (failures.length > 0) {
      this.fastify.log.error(
        { alertId, contactId, errors: failures.map((f) => f.reason?.message ?? String(f.reason)) },
        'Notification delivery failed for contact',
      );
      // Rethrow so BullMQ retries THIS contact only. Channels that already
      // succeeded are skipped on the next attempt by the alreadySent() guard.
      throw new Error(`Notification to contact ${contactId} had ${failures.length} channel failure(s).`);
    }
  }

  /**
   * Has this exact (alert, channel, recipient) already been delivered?
   * Backed by idx_notification_logs_alert_status.
   */
  private async alreadySent(
    alertId: string,
    channel: NotificationChannel,
    recipient: string,
  ): Promise<boolean> {
    const existing = await this.db.notificationLog.findFirst({
      where: { alertId, channel, recipient, status: 'sent' },
      select: { id: true },
    });
    return existing !== null;
  }

  /** SMS — the primary channel, since most contacts will not have the app. */
  private async deliverSms(alertId: string, phone: string, message: string): Promise<void> {
    const smsProvider = await this.resolveSmsProvider();
    if (!smsProvider) return; // SMS disabled in admin settings

    if (await this.alreadySent(alertId, 'sms', phone)) {
      this.fastify.log.debug({ alertId, phone }, 'SMS already sent for this alert; skipping');
      return;
    }

    const log = await this.createNotificationLog(alertId, 'sms', phone, message);
    try {
      const result = await smsProvider.sendSms(phone, message);
      await this.updateNotificationLog(log.id, result.success ? 'sent' : 'failed', result.error);
      if (!result.success) {
        throw new Error(`SMS to ${phone} failed: ${result.error}`);
      }
    } catch (err: any) {
      await this.updateNotificationLog(log.id, 'failed', err?.message);
      throw err;
    }
  }

  /**
   * Push — only reaches contacts who are themselves registered users.
   *
   * The lookup matches on every plausible format of the number rather than an
   * exact string compare. A contact saved as "01712345678" against a user
   * registered as "+8801712345678" is the same person, and the old
   * findUnique({ where: { phone } }) quietly failed to notice.
   */
  private async deliverPush(
    alertId: string,
    phone: string,
    userName: string,
    message: string,
  ): Promise<void> {
    const contactUser = await this.db.user.findFirst({
      where: { phone: { in: phoneVariants(phone) } },
      include: { deviceTokens: { where: { isActive: true } } },
    });

    if (!contactUser || contactUser.deviceTokens.length === 0) return;

    const errors: Error[] = [];

    await Promise.all(
      contactUser.deviceTokens.map(async (device) => {
        if (await this.alreadySent(alertId, 'push', device.token)) return;

        const log = await this.createNotificationLog(alertId, 'push', device.token, message);
        try {
          const result = await this.pushProvider.sendPush(
            device.token,
            `SOS Alert: ${userName}`,
            message,
          );
          await this.updateNotificationLog(log.id, result.success ? 'sent' : 'failed', result.error);
          if (!result.success) {
            errors.push(
              new Error(`Push to token ${device.token.substring(0, 5)}… failed: ${result.error}`),
            );
          }
        } catch (err: any) {
          await this.updateNotificationLog(log.id, 'failed', err?.message);
          errors.push(err);
        }
      }),
    );

    if (errors.length > 0) {
      throw new Error(`${errors.length} push delivery failure(s): ${errors[0].message}`);
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
