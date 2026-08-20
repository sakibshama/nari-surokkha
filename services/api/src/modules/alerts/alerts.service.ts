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
import { generateTrackingToken } from './alerts.tokens';
import { sendExpoPushBatch } from '../notifications/providers/expo-push.provider';
import { alertsTotal, respondersDispatched, sosDispatchDuration } from '@/plugins/metrics';
import {
  CLOSED_STATUSES,
  getAlertMeta,
  invalidateAlertMeta,
  recordPing,
} from './alert-location.buffer';

import { CasesService } from '../cases/cases.service';

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
  stationId: string | null;
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

export class AlertsService {
  constructor(
    private readonly repo: AlertsRepository,
    private readonly contactsRepo: ContactsRepository,
    private readonly responderRepo: ResponderRepository,
    private readonly casesService: CasesService,
    private readonly fastify: FastifyInstance,
  ) {}

  async triggerManualSos(
    userId: string,
    data: { latitude: number; longitude: number; accuracy?: number },
    ipAddress?: string,
  ): Promise<EmergencyAlert & { trackingToken?: string; contactPhones?: string[] }> {
    // 1. Verify user has at least one trusted contact
    const contacts = await this.contactsRepo.getContactsByUserId(userId);
    if (contacts.length === 0) {
      this.fastify.log.warn('User has no trusted contacts, but allowing SOS for police dispatch.');
    }

    // 2. Find nearest police station using PostGIS
    const nearestStation = await this.repo.findNearestPoliceStation(data.latitude, data.longitude);

    // 3. Save the alert
    const alert = await this.repo.createAlert({
      userId,
      latitude: data.latitude,
      longitude: data.longitude,
      accuracy: data.accuracy,
      assignedStationId: nearestStation?.id || null,
      status: 'confirmed',
    });

    alertsTotal.inc({ type: 'manual', has_station: nearestStation ? 'yes' : 'no' });

    await this.dispatchConfirmedAlert(alert, data, ipAddress, nearestStation);

    const trackingToken = generateTrackingToken(alert.id);
    const contactPhones = contacts.map(c => c.phone);

    return { ...alert, trackingToken, contactPhones };
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
   *   - light up the police portal over WebSocket (in-memory, immediate)
   *   - hand the rest to the 'dispatch' queue
   */
  private async dispatchConfirmedAlert(
    alert: EmergencyAlert,
    data: { latitude: number; longitude: number; accuracy?: number },
    ipAddress?: string,
    nearestStation?: { id: string } | null,
  ): Promise<void> {
    // ── 1. Trusted contacts (SMS + push) ────────────────────────────────
    if (this.fastify.queues?.notifications) {
      await this.fastify.queues.notifications.add(
        'notify_trusted_contacts',
        { alertId: alert.id, userId: alert.userId },
        // Idempotent: re-triggering the same alert cannot double-notify.
        { jobId: `fanout:${alert.id}` },
      );
    } else {
      this.fastify.log.warn('Notifications queue is not initialized. Skipping trusted contact notifications.');
    }

    // ── 2. Police portal, immediately ───────────────────────────────────
    if (this.fastify.io) {
      const eventPayload = {
        alertId: alert.id,
        userId: alert.userId,
        latitude: data.latitude,
        longitude: data.longitude,
        timestamp: new Date().toISOString(),
      };
      if (nearestStation) {
        this.fastify.io.to(`station:${nearestStation.id}`).emit('alert:created', eventPayload);
      }
      // Always notify general dispatch (admin / global view).
      this.fastify.io.to('station:dispatch').emit('alert:created', eventPayload);
    } else {
      this.fastify.log.warn('WebSocket is not initialized. Skipping police portal notification.');
    }

    // ── 3. Everything else, off the request path ────────────────────────
    const fanOut: AlertFanOutPayload = {
      alertId: alert.id,
      userId: alert.userId,
      latitude: data.latitude,
      longitude: data.longitude,
      stationId: nearestStation?.id ?? null,
      alertType: alert.type,
      ipAddress,
    };

    if (this.fastify.queues?.dispatch) {
      await this.fastify.queues.dispatch.add('fan_out_alert', fanOut, {
        // Idempotent: a retried SOS request cannot double-dispatch responders.
        jobId: `dispatch:${alert.id}`,
      });
    } else {
      // No queue available (unit tests, or a degraded boot). Run inline rather
      // than silently dropping the dispatch — correctness beats latency here.
      this.fastify.log.warn('Dispatch queue is not initialized. Running fan-out inline.');
      await this.fanOutAlert(fanOut);
    }
  }

  /**
   * The heavy half of an SOS: audit trail, police case, responder dispatch.
   *
   * Runs in the BullMQ 'dispatch' worker (see plugins/worker.ts). Safe to
   * retry — the audit log is append-only, case creation is guarded, and
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
    const { alertId, userId, latitude, longitude, stationId, alertType, ipAddress } = payload;

    // ── 1. Audit trail ──────────────────────────────────────────────────
    await this.repo.createAuditLog({
      userId,
      action: 'sos_triggered',
      entityType: 'alert',
      entityId: alertId,
      metadata: { alertType, status: 'confirmed', nearestStationId: stationId },
      ipAddress,
    });

    // ── 2. Police case ──────────────────────────────────────────────────
    if (stationId) {
      try {
        await this.casesService.createCaseFromAlert(alertId, stationId);
      } catch (err) {
        this.fastify.log.error(err instanceof Error ? err : { err }, 'Failed to auto-create case for alert');
      }
    }

    // ── 3. Nearby responders ────────────────────────────────────────────
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

    const nearestStation = await this.repo.findNearestPoliceStation(data.latitude, data.longitude);

    const alert = await this.repo.createAlert({
      userId,
      latitude: data.latitude,
      longitude: data.longitude,
      accuracy: data.accuracy,
      assignedStationId: nearestStation?.id || null,
      type: 'sensor_triggered',
      status: 'created',
      isSoftAlert: true,
      softAlertAt: new Date(),
      mlMetadata: data.mlMetadata || null,
    });

    // Enqueue an escalation job that will automatically confirm the alert in 30 seconds
    if (this.fastify.queues?.escalations) {
      await this.fastify.queues.escalations.add(
        'auto_escalate_soft_alert',
        { alertId: alert.id, userId },
        { delay: 30000 } // 30 seconds delay
      );
      this.fastify.log.info({ alertId: alert.id }, 'Scheduled auto-escalation for soft alert');
    }

    alertsTotal.inc({ type: 'sensor_triggered', has_station: nearestStation ? 'yes' : 'no' });

    return alert;
  }

  async cancelSoftAlert(userId: string, alertId: string): Promise<void> {
    const alert = await this.repo.getAlertById(alertId);
    if (!alert || alert.userId !== userId) {
      throw new ForbiddenError('Alert not found');
    }
    if (alert.status !== 'created') {
      throw new ForbiddenError('Cannot cancel an alert that is not in soft-alert state');
    }

    await this.repo.updateAlert(alertId, {
      status: 'false_alarm',
      softAlertCancelledAt: new Date(),
      closedAt: new Date(),
    });
    // The cached authorisation record carries status — drop it, or the alert
    // would keep accepting location pings after being cancelled.
    await invalidateAlertMeta(this.fastify, alertId);
  }

  async confirmSoftAlert(userId: string, alertId: string): Promise<EmergencyAlert & { trackingToken?: string; contactPhones?: string[] }> {
    const alert = await this.repo.getAlertById(alertId);
    if (!alert || alert.userId !== userId) {
      throw new ForbiddenError('Alert not found');
    }
    if (alert.status !== 'created') {
      throw new ForbiddenError('Cannot confirm an alert that is not in soft-alert state');
    }

    // 1. Verify user has at least one trusted contact (same rule as manual SOS)
    const contacts = await this.contactsRepo.getContactsByUserId(userId);
    if (contacts.length === 0) {
      this.fastify.log.warn('User has no trusted contacts, but allowing soft alert confirmation.');
    }

    // Update state to confirmed
    const updatedAlert = await this.repo.updateAlert(alertId, {
      status: 'confirmed',
      confirmedAt: new Date(),
    });
    await invalidateAlertMeta(this.fastify, alertId);

    const nearestStation = updatedAlert.assignedStationId 
      ? { id: updatedAlert.assignedStationId } 
      : undefined;

    await this.dispatchConfirmedAlert(updatedAlert, {
      latitude: Number(updatedAlert.latitude),
      longitude: Number(updatedAlert.longitude),
      accuracy: updatedAlert.accuracy ? Number(updatedAlert.accuracy) : undefined
    }, undefined, nearestStation);

    const trackingToken = generateTrackingToken(updatedAlert.id);
    const contactPhones = contacts.map(c => c.phone);

    return { ...updatedAlert, trackingToken, contactPhones };
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
      if (alert.assignedStationId) {
        this.fastify.io.to(`station:${alert.assignedStationId}`).emit('alert_status_update', eventPayload);
      }
      this.fastify.io.to('station:dispatch').emit('alert_status_update', eventPayload);
    }
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
     * The WebSocket emit still happens inline, so the police portal sees the
     * movement immediately — liveness is unchanged, only the write is deferred.
     */
    async updateLocation(
      userId: string,
      alertId: string,
      data: { latitude: number; longitude: number; accuracy?: number }
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

      const timestamp = new Date().toISOString();

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

        const rooms = [`alert:${alertId}`, 'station:dispatch'];
        if (meta.assignedStationId) rooms.push(`station:${meta.assignedStationId}`);
        this.fastify.io.to(rooms).emit('alert:location_update', eventPayload);
      }
    }
  
    generateTrackingToken(_userId: string, alertId: string, trustedContactId?: string): { token: string, expiresAt: Date } {
      const token = generateTrackingToken(alertId, trustedContactId);
      
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 24);
      
      return { token, expiresAt };
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
            AND location IS NOT NULL
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

    async updateRouteLocation(userId: string, routeId: string, latitude: number, longitude: number) {
      // The background task posts here on the SAME 10-second tick as the SOS
      // location ping, so this used to double the query cost of tracking. A
      // route's owner and waypoints never change after creation, so cache them.
      const route = await this.getCachedRoute(routeId);
      if (!route || route.userId !== userId) throw new ForbiddenError('Route not found');

      // Deviation = shortest distance from the user to the route LINE (not just
      // the nearest vertex) exceeds the threshold.
      const DEVIATION_THRESHOLD_M = 500;
      const waypoints = route.waypoints;
      const distanceM = pointToPathMeters(latitude, longitude, waypoints);
      const isDeviated = distanceM > DEVIATION_THRESHOLD_M;

      if (isDeviated) {
        await this.fastify.prisma.activeRoute.update({
          where: { id: routeId },
          data: { status: 'deviated' }
        });
        
        // Trigger soft alert
        await this.createSoftAlert(userId, {
          latitude,
          longitude,
          mlMetadata: { reason: `Route deviation ${Math.round(distanceM)}m > ${DEVIATION_THRESHOLD_M}m` },
        });
      }

      return { deviated: isDeviated, distanceMeters: Math.round(distanceM) };
    }
  }
