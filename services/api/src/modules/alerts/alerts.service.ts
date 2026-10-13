/**
 * Alerts Service — Business Logic Layer
 */

import { FastifyInstance } from 'fastify';
import { AlertsRepository } from './alerts.repository';
import { ContactsRepository } from '../contacts/contacts.repository';
import { ResponderRepository } from '../responder/responder.repository';
import { ForbiddenError } from '@/utils/errors';
import { EmergencyAlert } from '@prisma/client';
import { env } from '@/config/env';
import { sendExpoPushBatch } from '../notifications/providers/expo-push.provider';
import {
  ContactNotifyMode,
  createTrackingLinkToken,
  NotificationsService,
  publicTrackingUrl,
} from '../notifications/notifications.service';
import { renderSmsTemplate } from '../settings/settings.types';
import { alertsTotal, respondersDispatched, sosDispatchDuration } from '@/plugins/metrics';
import {
  CLOSED_STATUSES,
  getAlertMeta,
  invalidateAlertMeta,
  recordPing,
} from './alert-location.buffer';

import { ADMIN_ROOM, emitToAlert } from '@/utils/alert-rooms';
import { ACTIVE_ALERT_STATUSES } from './alert-status';

/** A soft alert auto-escalates to a real SOS after this long without an answer. */
export const SOFT_ALERT_ESCALATION_DELAY_MS = 30_000;

/** The soft alert was already cancelled, confirmed or escalated. */
export class SoftAlertNotPendingError extends ForbiddenError {}

/**
 * How long the SOS request will wait for a queue write before giving up on it.
 *
 * The BullMQ Redis client is configured with `maxRetriesPerRequest: null`
 * (BullMQ requires that), which means a command issued while Redis is down
 * queues FOREVER instead of failing. Awaiting one of those on the request path
 * makes the panic button hang with a spinner and never return — the worst
 * possible failure mode for this system. Bound it.
 */
const QUEUE_ENQUEUE_TIMEOUT_MS = 2000;

// BullMQ rejects a custom jobId containing exactly one ':' ("Custom Id cannot
// contain :"), so these ids use '-'. The old 'fanout:<id>' form made every
// contact-notification enqueue fail, silently degrading every SOS.

/** Resolve with the promise, or with `null` if it takes too long. */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    // A late rejection must not become an unhandled rejection, and a queue stub
    // that returns a non-promise must not throw here.
    return await Promise.race([Promise.resolve(promise).catch(() => null), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Responders are dispatched within this radius of the alert. */
const RESPONDER_DISPATCH_RADIUS_M = 5000;
/**
 * Cap on how many responders one alert notifies. Paging every responder in a
 * 5 km radius is noise, not coverage — the nearest few are the ones who can
 * actually arrive, and an unbounded fan-out is an unbounded amount of work.
 */
const RESPONDER_DISPATCH_LIMIT = 20;

/**
 * Everything the 'dispatch' worker needs to complete an SOS fan-out without
 * re-reading the alert. Kept flat and JSON-serialisable because it crosses a
 * BullMQ job boundary.
 */
export interface AlertFanOutPayload {
  alertId: string;
  userId: string;
  latitude: number;
  longitude: number;
  alertType: string;
  ipAddress?: string;
}

/** Great-circle distance in metres between two lat/lng points. */
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Accept a client-supplied fix time only if it is plausible.
 *
 * The mobile app queues location pings it could not deliver and replays them
 * when signal returns, so a legitimately old timestamp is expected. But the
 * value comes from a device clock we do not control, so it is bounded to the
 * last MAX_PING_AGE_MS and never allowed to be in the future.
 */
const MAX_PING_AGE_MS = 60 * 60 * 1000; // 1 hour of offline replay

/** Accepts an ISO string or epoch milliseconds. Exported for tests. */
export function clampClientTimestamp(raw?: string | number | null, now = Date.now()): string {
  if (raw === undefined || raw === null || raw === '') return new Date(now).toISOString();
  const parsed = typeof raw === 'number' ? raw : /^\d+$/.test(raw) ? Number(raw) : Date.parse(raw);
  if (!Number.isFinite(parsed)) return new Date(now).toISOString();
  if (parsed > now) return new Date(now).toISOString();
  if (parsed < now - MAX_PING_AGE_MS) return new Date(now - MAX_PING_AGE_MS).toISOString();
  return new Date(parsed).toISOString();
}

/** Evenly reduce a coordinate list to at most `max` points, keeping the ends. */
function downsample<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const out: T[] = [];
  const step = (arr.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(arr[Math.round(i * step)]);
  return out;
}

/**
 * Shortest distance (metres) from a point to the polyline defined by `path`.
 * Uses a local equirectangular projection (metres) around the point and true
 * point-to-SEGMENT distance — so a user walking between two far-apart waypoints
 * is correctly measured against the line, not just the nearest vertex.
 */
function pointToPathMeters(
  lat: number,
  lng: number,
  path: Array<{ lat: number; lng: number }>,
): number {
  if (!path.length) return Infinity;
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * Math.cos((lat * Math.PI) / 180);
  const px = 0;
  const py = 0;
  const proj = (p: { lat: number; lng: number }) => ({
    x: (p.lng - lng) * mPerDegLng,
    y: (p.lat - lat) * mPerDegLat,
  });
  if (path.length === 1) {
    const a = proj(path[0]);
    return Math.hypot(a.x - px, a.y - py);
  }
  let min = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const a = proj(path[i]);
    const b = proj(path[i + 1]);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq > 0 ? ((px - a.x) * dx + (py - a.y) * dy) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = a.x + t * dx;
    const cy = a.y + t * dy;
    const d = Math.hypot(px - cx, py - cy);
    if (d < min) min = d;
  }
  return min;
}

/** Tells the app to text the trusted contacts from the phone's own SIM. */
export interface DeviceSmsInstruction {
  smsViaDevice: boolean;
  deviceSmsMessage?: string;
}

export class AlertsService {
  constructor(
    private readonly repo: AlertsRepository,
    private readonly contactsRepo: ContactsRepository,
    private readonly responderRepo: ResponderRepository,
    private readonly fastify: FastifyInstance,
  ) {}

  async triggerManualSos(
    userId: string,
    data: { latitude: number; longitude: number; accuracy?: number },
    ipAddress?: string,
  ): Promise<
    EmergencyAlert & {
      contactPhones?: string[];
      /** The server could not queue the contact SMS — the app should send it. */
      degradedNotifications?: boolean;
    } & DeviceSmsInstruction
  > {
    // 1. Verify user has at least one trusted contact
    const contacts = await this.contactsRepo.getContactsByUserId(userId);
    if (contacts.length === 0) {
      this.fastify.log.warn('User has no trusted contacts, but allowing SOS for responder dispatch.');
    }

    // 2. Save the alert
    const alert = await this.repo.createAlert({
      userId,
      latitude: data.latitude,
      longitude: data.longitude,
      accuracy: data.accuracy,
      status: 'confirmed',
    });

    alertsTotal.inc({ type: 'manual' });

    const { degradedNotifications, smsViaDevice } = await this.dispatchConfirmedAlert(alert, data, ipAddress);

    const contactPhones = contacts.map(c => c.phone);
    const device = await this.deviceSmsInstruction(alert, smsViaDevice || degradedNotifications);

    return { ...alert, contactPhones, degradedNotifications, ...device };
  }

  /**
   * Does the user's plan still cover server-sent SMS? Fails OPEN: if the
   * subscription cannot be read, the server sends (an SOS must reach someone).
   */
  private async smsQuotaAvailable(userId: string): Promise<boolean> {
    try {
      const sub = await this.fastify.prisma.subscription.findUnique({ where: { userId } });
      return !!sub && sub.status === 'active' && sub.smsRemaining > 0 && (!sub.endDate || new Date(sub.endDate) > new Date());
    } catch (err) {
      this.fastify.log.warn({ err, userId }, 'Could not read SMS quota; server will send the SMS');
      return true;
    }
  }

  /**
   * When the phone must send the SMS itself (quota used up, or the server could
   * not queue it), give it the exact text the server would have sent — the
   * admin-configured template with a live tracking link.
   */
  private async deviceSmsInstruction(alert: EmergencyAlert, needed: boolean): Promise<DeviceSmsInstruction> {
    if (!needed) return { smsViaDevice: false };
    const mapLink = `https://maps.google.com/?q=${alert.latitude.toString()},${alert.longitude.toString()}`;
    let trackLink = mapLink;
    try {
      trackLink = publicTrackingUrl(await createTrackingLinkToken(this.fastify, alert.id, 'device'));
    } catch (err) {
      // Redis down: the map link still tells contacts where she is.
      this.fastify.log.warn({ err, alertId: alert.id }, 'Could not mint a tracking link for the device SMS');
    }
    let name = 'A user';
    let template = '{name} has triggered an SOS alert. Location: {mapLink} Live: {trackLink}';
    try {
      const profile = await this.fastify.prisma.userProfile.findUnique({ where: { userId: alert.userId } });
      if (profile?.fullName) name = profile.fullName;
      template = await this.fastify.settings.getSmsTemplate();
    } catch {
      /* defaults above */
    }
    const deviceSmsMessage = renderSmsTemplate(template, {
      name,
      mapLink,
      trackLink,
      lat: String(alert.latitude),
      lng: String(alert.longitude),
    });
    return { smsViaDevice: true, deviceSmsMessage };
  }

  /**
   * The phone was told to send the SMS from its SIM but could not (no SMS
   * permission, iOS in the background, no signal…). Send it from the server
   * after all — over quota if need be.
   */
  async requestServerSms(userId: string, alertId: string): Promise<{ queued: boolean }> {
    const alert = await this.repo.getAlertById(alertId);
    if (!alert || alert.userId !== userId) throw new ForbiddenError('Alert not found');
    if (['closed', 'cancelled', 'false_alarm', 'resolved', 'created'].includes(alert.status)) {
      throw new ForbiddenError('Alert is not active');
    }
    const mode: ContactNotifyMode = 'sms_retry';
    if (this.fastify.queues?.notifications) {
      const queued = await withTimeout(
        this.fastify.queues.notifications.add(
          'notify_trusted_contacts',
          { alertId, userId, mode },
          { jobId: `fanout-sms-${alertId}` },
        ),
        QUEUE_ENQUEUE_TIMEOUT_MS,
      );
      if (queued) return { queued: true };
    }
    this.fastify.log.warn({ alertId }, 'Server SMS fallback not queued — delivering in the background');
    void new NotificationsService(this.fastify.prisma, this.fastify)
      .processTrustedContactsNotification(alertId, userId, mode)
      .catch((err) => this.fastify.log.error({ err, alertId }, 'Background server SMS fallback failed'));
    return { queued: false };
  }

  /**
   * Request-path dispatch — deliberately tiny.
   *
   * This used to run the whole fan-out inline: an audit-log insert, a case
   * insert, a nearby-responder scan, then per responder a dispatch insert, a
   * device-token query (N+1) and an un-awaited HTTPS call to Expo. Around
   * fifteen sequential round trips before the citizen's phone got a reply, on
   * the one code path in the system where latency is the whole point.
   *
   * What is left here is only what must happen before the caller returns:
   *   - queue the trusted-contact notifications (a Redis push, ~1 ms — kept on
   *     the request path so it can never be lost, since it is the most
   *     time-critical downstream action)
   *   - light up the admin portal over WebSocket (in-memory, immediate)
   *   - hand the rest to the 'dispatch' queue
   */
  private async dispatchConfirmedAlert(
    alert: EmergencyAlert,
    data: { latitude: number; longitude: number; accuracy?: number },
    ipAddress?: string,
    opts: { forceServerSms?: boolean } = {},
  ): Promise<{ degradedNotifications: boolean; smsViaDevice: boolean }> {
    // ── 0. Who sends the contact SMS? ───────────────────────────────────
    // Within the plan's SMS quota the server sends it. Once the quota is used
    // up (or there is no active plan) the phone sends it from its own SIM,
    // like the offline fallback; the server still pushes to contacts who have
    // the app. Server-side escalations force server SMS: nobody is answering
    // on the phone.
    const smsViaDevice = !opts.forceServerSms && !(await this.smsQuotaAvailable(alert.userId));
    const mode: ContactNotifyMode = smsViaDevice ? 'push_only' : 'all';

    // ── 1. Trusted contacts (SMS + push) ────────────────────────────────
    // Bounded: a queue write that cannot complete must not hold the response.
    // If it fails the caller is told, so the app can fall back to sending the
    // emergency SMS from the phone itself.
    let degradedNotifications = false;
    if (this.fastify.queues?.notifications) {
      const queued = await withTimeout(
        this.fastify.queues.notifications.add(
          'notify_trusted_contacts',
          { alertId: alert.id, userId: alert.userId, mode },
          // Idempotent: re-triggering the same alert cannot double-notify.
          { jobId: `fanout-${alert.id}` },
        ),
        QUEUE_ENQUEUE_TIMEOUT_MS,
      );
      if (!queued) {
        degradedNotifications = true;
        this.fastify.log.error(
          { alertId: alert.id },
          'Could not queue trusted-contact notifications (Redis unavailable?) — the client must send SMS itself',
        );
      }
    } else {
      degradedNotifications = true;
      this.fastify.log.warn('Notifications queue is not initialized. Skipping trusted contact notifications.');
    }

    // ── 2. Admin portal, immediately ────────────────────────────────────
    if (this.fastify.io) {
      const eventPayload = {
        alertId: alert.id,
        userId: alert.userId,
        latitude: data.latitude,
        longitude: data.longitude,
        timestamp: new Date().toISOString(),
      };
      // Admin global view.
      this.fastify.io.to(ADMIN_ROOM).emit('alert:created', eventPayload);
    } else {
      this.fastify.log.warn('WebSocket is not initialized. Skipping admin portal notification.');
    }

    // ── 3. Everything else, off the request path ────────────────────────
    const fanOut: AlertFanOutPayload = {
      alertId: alert.id,
      userId: alert.userId,
      latitude: data.latitude,
      longitude: data.longitude,
      alertType: alert.type,
      ipAddress,
    };

    const dispatchQueued = this.fastify.queues?.dispatch
      ? await withTimeout(
          this.fastify.queues.dispatch.add('fan_out_alert', fanOut, {
            // Idempotent: a retried SOS request cannot double-dispatch responders.
            jobId: `dispatch-${alert.id}`,
          }),
          QUEUE_ENQUEUE_TIMEOUT_MS,
        )
      : null;

    if (!dispatchQueued) {
      // No queue, or Redis is not answering. Run the fan-out in the background
      // rather than dropping it — but never make the caller wait for it.
      this.fastify.log.warn({ alertId: alert.id }, 'Dispatch not queued — running fan-out in the background');
      void this.fanOutAlert(fanOut).catch((err) =>
        this.fastify.log.error(err instanceof Error ? err : { err }, 'Background fan-out failed'),
      );
    }

    return { degradedNotifications, smsViaDevice };
  }

  /**
   * The heavy half of an SOS: audit trail and responder dispatch.
   *
   * Runs in the BullMQ 'dispatch' worker (see plugins/worker.ts). Safe to
   * retry — the audit log is append-only and
   * responder dispatches are de-duplicated by the unique
   * (alert_id, responder_id) index.
   */
  async fanOutAlert(payload: AlertFanOutPayload): Promise<void> {
    // sos_dispatch_duration_seconds is THE service-level indicator for this
    // system: how long after someone presses the button does help actually get
    // told. Alert on its p95, not on CPU.
    const endTimer = sosDispatchDuration.startTimer();
    try {
      await this.doFanOutAlert(payload);
      endTimer({ outcome: 'success' });
    } catch (err) {
      endTimer({ outcome: 'failure' });
      throw err;
    }
  }

  private async doFanOutAlert(payload: AlertFanOutPayload): Promise<void> {
    const { alertId, userId, latitude, longitude, alertType, ipAddress } = payload;

    // ── 1. Audit trail ──────────────────────────────────────────────────
    await this.repo.createAuditLog({
      userId,
      action: 'sos_triggered',
      entityType: 'alert',
      entityId: alertId,
      metadata: { alertType, status: 'confirmed' },
      ipAddress,
    });

    // ── 2. Nearby responders ────────────────────────────────────────────
    try {
      const responders = await this.responderRepo.findNearbyResponders(
        latitude,
        longitude,
        RESPONDER_DISPATCH_RADIUS_M,
        RESPONDER_DISPATCH_LIMIT,
      );
      respondersDispatched.observe(responders.length);
      if (responders.length === 0) {
        // A persistent zero here means dispatch is silently broken — which is
        // exactly the class of failure that used to go unnoticed.
        this.fastify.log.warn({ alertId }, 'No available responders within dispatch radius');
        return;
      }

      const responderIds = responders.map((r) => r.id);
      const responderUserIds = responders.map((r) => r.userId);

      // 3a. One INSERT for every dispatch, not one per responder.
      //     skipDuplicates + the unique (alert_id, responder_id) index make a
      //     job retry a no-op instead of a second dispatch.
      await this.fastify.prisma.responderDispatch.createMany({
        data: responderIds.map((responderId) => ({ responderId, alertId })),
        skipDuplicates: true,
      });

      // 3b. Read the ids back in one query (covers both freshly inserted rows
      //     and rows from a previous attempt).
      const dispatches = await this.fastify.prisma.responderDispatch.findMany({
        where: { alertId, responderId: { in: responderIds } },
        select: { id: true, responderId: true },
      });
      const dispatchIdByResponder = new Map(dispatches.map((d) => [d.responderId, d.id]));

      // 3c. Notify each responder over WebSocket. Location is coarsened to
      //     ~1 km until the responder accepts.
      const maskedLatitude = Math.round(latitude * 100) / 100;
      const maskedLongitude = Math.round(longitude * 100) / 100;
      const timestamp = new Date().toISOString();

      for (const responder of responders) {
        const dispatchId = dispatchIdByResponder.get(responder.id);
        if (!dispatchId) continue;
        this.fastify.io?.to(`user:${responder.userId}`).emit('responder:dispatch_received', {
          dispatchId,
          alertId,
          latitude: maskedLatitude,
          longitude: maskedLongitude,
          distanceMeters: Math.round(responder.distanceMeters),
          timestamp,
          screen: 'ResponderHub',
        });
      }

      // 3d. ONE device-token query for all responders (was N+1), and ONE
      //     batched Expo request (was one un-awaited fetch per responder).
      const deviceTokens = await this.fastify.prisma.deviceToken.findMany({
        where: { userId: { in: responderUserIds }, isActive: true },
        select: { token: true },
      });

      if (deviceTokens.length > 0) {
        const pushResult = await sendExpoPushBatch(
          deviceTokens.map((d) => d.token),
          {
            title: '🚨 EMERGENCY DISPATCH',
            body: 'A citizen nearby has triggered an SOS! Tap to respond.',
            data: { alertId, latitude: maskedLatitude, longitude: maskedLongitude, screen: 'ResponderHub' },
          },
          this.fastify.log,
        );
        this.fastify.log.info(
          { alertId, responders: responders.length, ...pushResult },
          'Responder dispatch push sent',
        );
      }
    } catch (err) {
      this.fastify.log.error(err instanceof Error ? err : { err }, 'Failed to dispatch to nearby responders');
      throw err; // let BullMQ retry the fan-out
    }
  }

  async createSoftAlert(
    userId: string,
    data: { latitude: number; longitude: number; accuracy?: number; mlMetadata?: any }
  ): Promise<EmergencyAlert> {
    // We do NOT verify trusted contacts here because it's a passive sensor event.
    // If they have no contacts, it just won't notify anyone later, but we still record the event.

    // Alerts raised by the on-device audio models (shout, cry, "help",
    // "bachao") are recorded as ml_triggered so the admin portal can tell them
    // apart from motion-sensor and route-deviation alerts.
    const AUDIO_TRIGGERS = ['shout', 'cry', 'help', 'bachao'];
    const trigger = typeof data.mlMetadata?.trigger === 'string' ? data.mlMetadata.trigger : undefined;
    const alert = await this.repo.createAlert({
      userId,
      latitude: data.latitude,
      longitude: data.longitude,
      accuracy: data.accuracy,
      type: trigger && AUDIO_TRIGGERS.includes(trigger) ? 'ml_triggered' : 'sensor_triggered',
      status: 'created',
      isSoftAlert: true,
      softAlertAt: new Date(),
      mlMetadata: data.mlMetadata || null,
    });

    await this.scheduleSoftAlertEscalation(alert.id, userId);

    alertsTotal.inc({ type: 'sensor_triggered' });

    return alert;
  }

  /**
   * Escalate the soft alert if nobody answers. Normally a delayed BullMQ job;
   * if the queue cannot take it, an in-process timer does the same thing, so
   * an unanswered alert is never silently dropped. Either path is safe to race
   * with a cancel: the transition itself is conditional on status 'created'.
   */
  private async scheduleSoftAlertEscalation(alertId: string, userId: string): Promise<void> {
    const queued = this.fastify.queues?.escalations
      ? await withTimeout(
          this.fastify.queues.escalations.add(
            'auto_escalate_soft_alert',
            { alertId, userId },
            { delay: SOFT_ALERT_ESCALATION_DELAY_MS, jobId: `escalate-${alertId}` },
          ),
          QUEUE_ENQUEUE_TIMEOUT_MS,
        )
      : null;
    if (queued) {
      this.fastify.log.info({ alertId }, 'Scheduled auto-escalation for soft alert');
      return;
    }

    this.fastify.log.error({ alertId }, 'Could not queue soft-alert escalation — using an in-process timer');
    setTimeout(() => {
      this.autoEscalateSoftAlert(alertId, userId).catch((err) =>
        this.fastify.log.error({ err, alertId }, 'In-process soft-alert escalation failed'),
      );
    }, SOFT_ALERT_ESCALATION_DELAY_MS).unref();
  }

  /**
   * Nobody answered the soft alert: confirm it as a real SOS. Returns false
   * when it was already cancelled or confirmed (the expected, benign race).
   */
  async autoEscalateSoftAlert(alertId: string, userId: string): Promise<boolean> {
    try {
      // The phone may be dead or out of reach, so the server texts the
      // contacts itself whatever the user's SMS quota.
      await this.confirmSoftAlert(userId, alertId, { forceServerSms: true });
      this.fastify.log.info({ alertId }, 'Soft alert automatically escalated to SOS');
      return true;
    } catch (err) {
      if (err instanceof SoftAlertNotPendingError) {
        this.fastify.log.debug({ alertId }, 'Soft alert was already resolved before auto-escalation');
        return false;
      }
      throw err;
    }
  }

  async cancelSoftAlert(userId: string, alertId: string): Promise<void> {
    const alert = await this.repo.getAlertById(alertId);
    if (!alert || alert.userId !== userId) {
      throw new ForbiddenError('Alert not found');
    }
    // Conditional on status 'created' in the same statement, so a cancel and
    // a concurrent escalation can never both win.
    const cancelled = alert.status === 'created' && (await this.repo.updateIfSoftAlertPending(alertId, {
      status: 'false_alarm',
      softAlertCancelledAt: new Date(),
      closedAt: new Date(),
    }));
    if (!cancelled) {
      throw new SoftAlertNotPendingError('Cannot cancel an alert that is not in soft-alert state');
    }
    // The cached authorisation record carries status — drop it, or the alert
    // would keep accepting location pings after being cancelled.
    await invalidateAlertMeta(this.fastify, alertId);
  }

  async confirmSoftAlert(
    userId: string,
    alertId: string,
    opts: { forceServerSms?: boolean } = {},
  ): Promise<
    EmergencyAlert & { contactPhones?: string[]; degradedNotifications?: boolean } & DeviceSmsInstruction
  > {
    const alert = await this.repo.getAlertById(alertId);
    if (!alert || alert.userId !== userId) {
      throw new ForbiddenError('Alert not found');
    }
    // Conditional transition — see cancelSoftAlert.
    const updatedAlert = alert.status === 'created'
      ? await this.repo.updateIfSoftAlertPending(alertId, { status: 'confirmed', confirmedAt: new Date() })
      : null;
    if (!updatedAlert) {
      throw new SoftAlertNotPendingError('Cannot confirm an alert that is not in soft-alert state');
    }
    await invalidateAlertMeta(this.fastify, alertId);

    // Same rule as manual SOS: no contacts still dispatches responders.
    const contacts = await this.contactsRepo.getContactsByUserId(userId);
    if (contacts.length === 0) {
      this.fastify.log.warn('User has no trusted contacts, but allowing soft alert confirmation.');
    }

    const { degradedNotifications, smsViaDevice } = await this.dispatchConfirmedAlert(
      updatedAlert,
      {
        latitude: Number(updatedAlert.latitude),
        longitude: Number(updatedAlert.longitude),
        accuracy: updatedAlert.accuracy ? Number(updatedAlert.accuracy) : undefined,
      },
      undefined,
      opts,
    );

    const contactPhones = contacts.map(c => c.phone);
    const device = await this.deviceSmsInstruction(updatedAlert, smsViaDevice || degradedNotifications);

    return { ...updatedAlert, contactPhones, degradedNotifications, ...device };
  }

  async cancelSosAlert(userId: string, alertId: string): Promise<void> {
    const alert = await this.repo.getAlertById(alertId);
    if (!alert || alert.userId !== userId) {
      throw new ForbiddenError('Alert not found');
    }
    const closedStatuses = ['closed', 'cancelled', 'false_alarm', 'resolved'];
    if (closedStatuses.includes(alert.status)) {
      return;
    }

    await this.repo.updateAlert(alertId, {
      status: 'false_alarm',
      closedAt: new Date(),
    });
    await invalidateAlertMeta(this.fastify, alertId);

    if (this.fastify.io) {
      const eventPayload = { alertId, status: 'false_alarm' };
      this.fastify.io.to(ADMIN_ROOM).emit('alert_status_update', eventPayload);
    }
  }

  /** The owner says "I'm safe now". Idempotent once the alert is closed. */
  async resolveOwnAlert(userId: string, alertId: string): Promise<EmergencyAlert> {
    const alert = await this.repo.getAlertById(alertId);
    if (!alert || alert.userId !== userId) {
      throw new ForbiddenError('Alert not found');
    }
    if (!ACTIVE_ALERT_STATUSES.includes(alert.status)) return alert;

    const now = new Date();
    const updated = await this.repo.updateAlert(alertId, { status: 'resolved', resolvedAt: now, closedAt: now });
    await invalidateAlertMeta(this.fastify, alertId);
    await this.repo.createAuditLog({
      userId,
      action: 'updated',
      entityType: 'alert',
      entityId: alertId,
      metadata: { from: alert.status, to: 'resolved', by: 'owner' },
    });
    emitToAlert(this.fastify, alertId, 'alert_status_update', { alertId, status: 'resolved' });
    return updated;
  }
  
    /**
     * Record a live position during an active SOS.
     *
     * This is the highest-frequency write path in the system — a phone streams
     * one of these every 10 seconds for the whole duration of an emergency.
     * It used to cost three database round trips per ping (authorise, insert
     * trail row, update denormalised position), with the last two not even in
     * a transaction.
     *
     * Now it costs zero database round trips on the happy path:
     *   - authorisation comes from a Redis-cached record (the owner never
     *     changes; status changes invalidate it)
     *   - the position is written to Redis and appended to a flush buffer
     *   - the worker batches the buffer into Postgres on an interval
     *
     * The WebSocket emit still happens inline, so the admin portal sees the
     * movement immediately — liveness is unchanged, only the write is deferred.
     */
    async updateLocation(
      userId: string,
      alertId: string,
      data: { latitude: number; longitude: number; accuracy?: number; timestamp?: string | number | null }
    ): Promise<void> {
      const meta = await getAlertMeta(this.fastify, alertId);

      if (!meta) {
        throw new ForbiddenError('Alert not found');
      }

      if (meta.userId !== userId) {
        throw new ForbiddenError('You can only update locations for your own alerts');
      }

      if (CLOSED_STATUSES.includes(meta.status)) {
        throw new ForbiddenError('Cannot update location for a closed alert');
      }

      // Honour the client's fix time for replayed pings, but bound it: a
      // timestamp in the future, or absurdly far in the past, is either a bad
      // device clock or someone trying to forge a trail. Anything outside the
      // window falls back to now.
      const timestamp = clampClientTimestamp(data.timestamp);

      await recordPing(this.fastify, alertId, {
        latitude: data.latitude,
        longitude: data.longitude,
        accuracy: data.accuracy,
        timestamp,
      });

      if (this.fastify.io) {
        const eventPayload = {
          alertId,
          latitude: data.latitude,
          longitude: data.longitude,
          timestamp,
        };

        const rooms = [`alert:${alertId}`, ADMIN_ROOM];
        this.fastify.io.to(rooms).emit('alert:location_update', eventPayload);
      }
    }
  
    async processSmsWebhook(from: string, body: string): Promise<void> {
      // Clean up the phone number (Twilio sends +1234567890)
      const phone = from.trim();
      const user = await this.repo.findUserByPhone(phone);
      
      if (!user) {
        this.fastify.log.warn(`Received SMS from unregistered number: ${phone}`);
        return;
      }

      // Look for Google Maps link: https://maps.google.com/?q=23.79,90.41
      const match = body.match(/q=(-?\d+\.\d+),(-?\d+\.\d+)/);
      
      if (match && match.length === 3) {
        const lat = parseFloat(match[1]);
        const lng = parseFloat(match[2]);

        if (!isNaN(lat) && !isNaN(lng)) {
          this.fastify.log.info(`Processing Offline SMS SOS for user ${user.id} at ${lat}, ${lng}`);
          await this.triggerManualSos(user.id, { latitude: lat, longitude: lng });
        } else {
          this.fastify.log.warn(`Invalid coordinates in SMS from ${phone}: ${body}`);
        }
      } else {
        // Fallback to strict format: SOS <lat> <lng>
        const parts = body.trim().split(/\s+/);
        if (parts.length >= 3 && parts[0].toUpperCase() === 'SOS') {
          const lat = parseFloat(parts[1]);
          const lng = parseFloat(parts[2]);
  
          if (!isNaN(lat) && !isNaN(lng)) {
            this.fastify.log.info(`Processing Strict Offline SMS SOS for user ${user.id} at ${lat}, ${lng}`);
            await this.triggerManualSos(user.id, { latitude: lat, longitude: lng });
          } else {
            this.fastify.log.warn(`Invalid fallback coordinates in SMS from ${phone}: ${body}`);
          }
        } else {
          this.fastify.log.warn(`Unrecognized SMS format from ${phone}: ${body}`);
        }
      }
    }

    /**
     * Compute a real safe route:
     *   1. Fetch actual walking road geometry from OSRM (configurable, falls
     *      back to a straight interpolation if the router is unreachable).
     *   2. Score it against VERIFIED incident reports near the path (PostGIS
     *      ST_DWithin over a geography LINESTRING) → a real 0-100 safety score
     *      and a per-waypoint risk level for colouring the route.
     *   3. Persist the route (waypoints only) for deviation tracking.
     */
    async getSafeRoute(
      userId: string,
      origin: { lat: number; lng: number },
      destination: { lat: number; lng: number },
    ) {
      const oLat = Number(origin?.lat);
      const oLng = Number(origin?.lng);
      const dLat = Number(destination?.lat);
      const dLng = Number(destination?.lng);
      if ([oLat, oLng, dLat, dLng].some((v) => Number.isNaN(v))) {
        throw new Error('Invalid origin/destination coordinates');
      }

      // ── 1. road geometry ───────────────────────────────────
      const osrmBase = env.OSRM_URL.replace(/\/$/, '');
      let coords: Array<[number, number]> = []; // [lng, lat]
      let distanceMeters = 0;
      let durationSeconds = 0;
      let routingEngine: 'osrm' | 'fallback' = 'osrm';

      try {
        const url = `${osrmBase}/route/v1/walking/${oLng},${oLat};${dLng},${dLat}`
          + `?overview=full&geometries=geojson&alternatives=false&steps=false`;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8000);
        let data: any;
        try {
          const resp = await fetch(url, { signal: ctrl.signal });
          data = (await resp.json()) as any;
        } finally {
          clearTimeout(timer);
        }
        const r = data?.routes?.[0];
        if (r?.geometry?.coordinates?.length) {
          coords = r.geometry.coordinates as Array<[number, number]>;
          distanceMeters = Math.round(r.distance || 0);
          durationSeconds = Math.round(r.duration || 0);
        } else {
          throw new Error('no route from OSRM');
        }
      } catch (err) {
        this.fastify.log.warn({ err }, 'OSRM unavailable — using straight-line fallback');
        routingEngine = 'fallback';
        const steps = 24;
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          coords.push([oLng + (dLng - oLng) * t, oLat + (dLat - oLat) * t]);
        }
        distanceMeters = Math.round(haversine(oLat, oLng, dLat, dLng));
        durationSeconds = Math.round(distanceMeters / 1.35); // ~1.35 m/s walking
      }

      // Downsample for scoring/display (keep endpoints).
      const MAX_POINTS = 60;
      const path = downsample(coords, MAX_POINTS).map(([lng, lat]) => ({ lat, lng }));

      // ── 2. score against verified incidents near the path ───
      const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // last 90 days
      const wkt = 'LINESTRING(' + path.map((p) => `${p.lng} ${p.lat}`).join(',') + ')';
      const BUFFER_M = 150; // "near the route" band

      let incidents: Array<{ type: string; latitude: number; longitude: number }> = [];
      try {
        // Uses the maintained `location` geometry column so ST_DWithin can be
        // answered from idx_incident_reports_location_geog. The previous
        // ST_MakePoint(longitude, latitude) form rebuilt the point per row and
        // scanned all of incident_reports on every Safe Route request.
        incidents = await this.fastify.prisma.$queryRaw<
          Array<{ type: string; latitude: number; longitude: number }>
        >`
          SELECT type, latitude::float AS latitude, longitude::float AS longitude
          FROM "incident_reports"
          WHERE status = 'verified'
            AND "created_at" >= ${since}
            -- NOTE: deliberately no "location IS NOT NULL" guard.
            --
            -- It reads as harmless defensive SQL, but it is what makes this query
            -- slow: the planner satisfies the NOT NULL predicate with the plain
            -- geometry index and then evaluates ST_DWithin as a filter over every
            -- row. Measured on 20,000 responders that is 17,855 rows removed by
            -- filter; without it the planner uses the geography expression index
            -- with a real bounding-box Index Cond and removes only 908.
            --
            -- The guard is redundant anyway: ST_DWithin(NULL, ...) is NULL, which
            -- WHERE already treats as false.
            AND ST_DWithin(
              location::geography,
              ST_GeogFromText(${'SRID=4326;' + wkt}),
              ${BUFFER_M}
            );
        `;
      } catch (err) {
        // If PostGIS/geometry is unavailable, degrade gracefully to "no data".
        this.fastify.log.warn({ err }, 'route incident scoring query failed');
        incidents = [];
      }

      // Per-waypoint risk: incidents within RISK_RADIUS of each point.
      const RISK_RADIUS = 250;
      const waypoints = path.map((p) => {
        let near = 0;
        for (const inc of incidents) {
          if (haversine(p.lat, p.lng, inc.latitude, inc.longitude) <= RISK_RADIUS) near++;
        }
        // 0 = safe, capped at 1 for colouring
        const risk = Math.min(1, near / 3);
        return { lat: p.lat, lng: p.lng, risk: Number(risk.toFixed(2)) };
      });

      // Overall safety score: penalise incident density along the route.
      const km = Math.max(0.3, distanceMeters / 1000);
      const density = incidents.length / km; // incidents per km near the path
      const safetyScore = Math.max(
        5,
        Math.min(100, Math.round(100 - density * 14 - incidents.length * 2)),
      );
      const rating = safetyScore >= 75 ? 'safe' : safetyScore >= 50 ? 'moderate' : 'danger';

      // ── 3. persist (waypoints only, for deviation tracking) ─
      const route = await this.fastify.prisma.activeRoute.create({
        data: {
          userId,
          originLat: oLat,
          originLng: oLng,
          destLat: dLat,
          destLng: dLng,
          waypoints,
        },
      });

      return {
        id: route.id,
        origin: { lat: oLat, lng: oLng },
        destination: { lat: dLat, lng: dLng },
        waypoints,
        distanceMeters,
        durationSeconds,
        safetyScore,
        rating,
        incidentsNearby: incidents.length,
        incidents: incidents.map((i) => ({ lat: i.latitude, lng: i.longitude, type: i.type })),
        routingEngine,
      };
    }

    /**
     * A route's owner and waypoints are immutable once created, so they are
     * safe to cache for the life of the walk. Only `status` mutates, and that
     * is written straight through below.
     */
    private async getCachedRoute(
      routeId: string,
    ): Promise<{ userId: string; waypoints: Array<{ lat: number; lng: number }> } | null> {
      const key = `route:${routeId}`;
      try {
        const cached = await this.fastify.redis.get(key);
        if (cached) return JSON.parse(cached);
      } catch {
        /* fall through to the database */
      }

      const route = await this.fastify.prisma.activeRoute.findUnique({ where: { id: routeId } });
      if (!route) return null;

      const value = {
        userId: route.userId,
        waypoints: (route.waypoints as Array<{ lat: number; lng: number }>) ?? [],
      };
      try {
        await this.fastify.redis.set(key, JSON.stringify(value), 'EX', 6 * 3600);
      } catch {
        /* best-effort */
      }
      return value;
    }

    async updateRouteLocation(
      userId: string,
      routeId: string,
      latitude: number,
      longitude: number,
    ): Promise<{ deviated: boolean; distanceM: number; alertId?: string }> {
      // The background task posts here on the SAME 10-second tick as the SOS
      // location ping, so this used to double the query cost of tracking. A
      // route's owner and waypoints never change after creation, so cache them.
      // Status is NOT cached: it is checked in the database below.
      const route = await this.getCachedRoute(routeId);
      if (!route || route.userId !== userId) throw new ForbiddenError('Route not found');

      // Deviation = shortest distance from the user to the route LINE (not just
      // the nearest vertex) exceeds the threshold.
      const DEVIATION_THRESHOLD_M = 500;
      const distanceM = Math.round(pointToPathMeters(latitude, longitude, route.waypoints));
      if (distanceM <= DEVIATION_THRESHOLD_M) return { deviated: false, distanceM };

      // Only the active→deviated transition raises an alert. Every ping after
      // it (one each 10 s while off-route) used to create another soft alert,
      // each auto-escalating to a full SOS 30 s later.
      const { count } = await this.fastify.prisma.activeRoute.updateMany({
        where: { id: routeId, status: 'active' },
        data: { status: 'deviated' },
      });
      if (count === 0) return { deviated: true, distanceM };

      const alert = await this.createSoftAlert(userId, {
        latitude,
        longitude,
        mlMetadata: { reason: 'route_deviation', routeId, distanceM, thresholdM: DEVIATION_THRESHOLD_M },
      });
      return { deviated: true, distanceM, alertId: alert.id };
    }
  }
