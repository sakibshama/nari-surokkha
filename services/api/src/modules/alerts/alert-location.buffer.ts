/**
 * Live-location write buffer.
 *
 * The problem
 * -----------
 * During an active SOS the phone streams a position every 10 seconds (5 on
 * web). Each ping used to cost three database round trips:
 *
 *   1. getAlertById()               — to authorise the ping
 *   2. alertLocation.create()       — append to the trail
 *   3. emergencyAlert.update()      — denormalise the latest position
 *
 * Steps 2 and 3 were not even in a transaction, so a crash between them left
 * the trail and the map marker disagreeing. At 500 concurrent alerts that is
 * ~150 queries/s and ~100 writes/s purely for tracking, and `alert_locations`
 * grew forever because nothing ever pruned it.
 *
 * The shape of the fix
 * --------------------
 * Split "where are they right now" from "where have they been":
 *
 *   - **Now** lives in Redis (`alert:<id>:last`) and is written on every ping.
 *     It is what the admin portal and the public tracking page read, so
 *     liveness is unchanged — arguably better, since it no longer waits on a
 *     database write.
 *   - **History** is buffered in a Redis list and flushed to Postgres in
 *     batches by the worker. One `createMany` per alert per flush interval
 *     instead of one INSERT per ping.
 *   - **Authorisation** is cached (`alert:<id>:meta`). An alert's owner never
 *     changes; its status does, so the cache is invalidated on status change.
 *
 * Net effect at 500 concurrent alerts: ~150 queries/s becomes roughly 3-5
 * writes/s, and no ping is ever lost — an unflushed buffer survives an API
 * restart because it lives in Redis, not in process memory.
 */

import type { FastifyInstance } from 'fastify';
import type Redis from 'ioredis';

/** How long a cached alert authorisation record stays valid. */
const META_TTL_SECONDS = 3600;
/** How long the "latest position" key survives without updates. */
const LAST_TTL_SECONDS = 6 * 3600;
/** Hard cap on buffered points per alert, so a stuck flusher cannot grow Redis without bound. */
const MAX_BUFFERED_POINTS = 2000;

export const PENDING_SET = 'alertloc:pending';

export interface AlertMeta {
  userId: string;
  status: string;
}

export interface LivePosition {
  latitude: number;
  longitude: number;
  accuracy?: number;
  timestamp: string;
}

const metaKey = (alertId: string) => `alert:${alertId}:meta`;
const lastKey = (alertId: string) => `alert:${alertId}:last`;
const bufKey = (alertId: string) => `alertloc:buf:${alertId}`;

/** Statuses after which an alert accepts no further location updates. */
export const CLOSED_STATUSES = ['closed', 'cancelled', 'false_alarm', 'resolved'];

/**
 * Authorisation metadata for an alert, from cache when possible.
 * Falls back to the database and populates the cache.
 */
export async function getAlertMeta(
  fastify: FastifyInstance,
  alertId: string,
): Promise<AlertMeta | null> {
  const redis = fastify.redis as Redis;

  try {
    const cached = await redis.get(metaKey(alertId));
    if (cached) return JSON.parse(cached) as AlertMeta;
  } catch (err) {
    // A Redis blip must never block an emergency location update — fall
    // through to the database.
    fastify.log.warn({ err, alertId }, 'alert meta cache read failed');
  }

  const alert = await fastify.prisma.emergencyAlert.findUnique({
    where: { id: alertId },
    select: { userId: true, status: true },
  });
  if (!alert) return null;

  const meta: AlertMeta = {
    userId: alert.userId,
    status: String(alert.status),
  };

  try {
    await redis.set(metaKey(alertId), JSON.stringify(meta), 'EX', META_TTL_SECONDS);
  } catch {
    /* cache write is best-effort */
  }
  return meta;
}

/**
 * Drop the cached authorisation record. MUST be called whenever an alert's
 * status changes — otherwise a cancelled alert would keep accepting pings for
 * up to META_TTL_SECONDS.
 */
export async function invalidateAlertMeta(
  fastify: FastifyInstance,
  alertId: string,
): Promise<void> {
  try {
    await (fastify.redis as Redis).del(metaKey(alertId));
  } catch (err) {
    fastify.log.warn({ err, alertId }, 'alert meta cache invalidation failed');
  }
}

/**
 * Record a position: update "latest" and append to the flush buffer.
 * One Redis round trip (pipelined), no database write.
 */
export async function recordPing(
  fastify: FastifyInstance,
  alertId: string,
  position: LivePosition,
): Promise<void> {
  const redis = fastify.redis as Redis;
  const payload = JSON.stringify(position);

  await redis
    .multi()
    .set(lastKey(alertId), payload, 'EX', LAST_TTL_SECONDS)
    .rpush(bufKey(alertId), payload)
    .ltrim(bufKey(alertId), -MAX_BUFFERED_POINTS, -1)
    .expire(bufKey(alertId), LAST_TTL_SECONDS)
    .sadd(PENDING_SET, alertId)
    .exec();
}

/** The most recent known position, or null if nothing is buffered. */
export async function getLastPosition(
  fastify: FastifyInstance,
  alertId: string,
): Promise<LivePosition | null> {
  try {
    const raw = await (fastify.redis as Redis).get(lastKey(alertId));
    return raw ? (JSON.parse(raw) as LivePosition) : null;
  } catch {
    return null;
  }
}

/**
 * Flush every buffered alert to Postgres.
 *
 * Called on an interval by the worker. Per alert this is one `createMany` for
 * the trail plus one `update` for the denormalised latest position — two
 * statements per alert per interval, regardless of how many pings arrived.
 *
 * Returns the number of points written, for metrics.
 */
export async function flushLocationBuffers(fastify: FastifyInstance): Promise<number> {
  const redis = fastify.redis as Redis;
  let written = 0;

  const alertIds = await redis.smembers(PENDING_SET);
  if (alertIds.length === 0) return 0;

  for (const alertId of alertIds) {
    try {
      // Claim this alert's points atomically: read the buffer, then delete
      // exactly what we read. Pings that arrive mid-flush stay queued for the
      // next pass rather than being dropped.
      const [rangeResult] = await redis.multi().lrange(bufKey(alertId), 0, -1).exec() ?? [];
      const raw = (rangeResult?.[1] as string[] | undefined) ?? [];

      if (raw.length === 0) {
        await redis.srem(PENDING_SET, alertId);
        continue;
      }

      await redis.ltrim(bufKey(alertId), raw.length, -1);

      const points = raw
        .map((r) => {
          try {
            return JSON.parse(r) as LivePosition;
          } catch {
            return null;
          }
        })
        .filter((p): p is LivePosition => p !== null);

      if (points.length === 0) continue;

      const latest = points[points.length - 1];

      // Both statements in one transaction: the trail and the marker can no
      // longer disagree after a crash.
      await fastify.prisma.$transaction([
        fastify.prisma.alertLocation.createMany({
          data: points.map((p) => ({
            alertId,
            latitude: p.latitude,
            longitude: p.longitude,
            accuracy: p.accuracy,
            timestamp: new Date(p.timestamp),
          })),
        }),
        fastify.prisma.emergencyAlert.update({
          where: { id: alertId },
          data: {
            latitude: latest.latitude,
            longitude: latest.longitude,
            accuracy: latest.accuracy,
          },
        }),
      ]);

      written += points.length;

      // Nothing left buffered and the alert is closed → stop tracking it.
      const remaining = await redis.llen(bufKey(alertId));
      if (remaining === 0) {
        const meta = await getAlertMeta(fastify, alertId);
        if (!meta || CLOSED_STATUSES.includes(meta.status)) {
          await redis.srem(PENDING_SET, alertId);
        }
      }
    } catch (err) {
      // Never let one bad alert stop the flush for everyone else. The points
      // stay in Redis and are retried on the next pass.
      fastify.log.error({ err, alertId }, 'location buffer flush failed for alert');
    }
  }

  return written;
}
