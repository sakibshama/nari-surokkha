/**
 * App Config Routes.
 *
 * A tiny key/value settings store backed by Redis (no DB migration needed).
 * Currently holds the Google Maps browser API key, which the portals fetch
 * at runtime so an admin can configure it from the UI instead of a rebuild.
 *
 * - GET  /api/v1/config        → any authenticated user (portals need the key)
 * - PUT  /api/v1/config        → admin only
 *
 * NOTE: The Google Maps *browser* key is designed to be exposed to the client
 * (it is used in front-end JS). Protect it with HTTP-referrer + API
 * restrictions in the Google Cloud console, not by hiding it.
 */

import { FastifyInstance } from 'fastify';
import { requireRoles } from '@/middleware/rbac';
import { env } from '@/config/env';

const REDIS_KEY = 'config:googleMapsApiKey';

/** Build the WebRTC ICE server list from env (STUN always, TURN when set). */
function buildIceServers() {
  const iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }> = [
    { urls: env.STUN_URL },
  ];
  if (env.TURN_HOST && env.TURN_PASSWORD) {
    iceServers.push({
      urls: [
        `turn:${env.TURN_HOST}:${env.TURN_PORT}?transport=udp`,
        `turn:${env.TURN_HOST}:${env.TURN_PORT}?transport=tcp`,
      ],
      username: env.TURN_USERNAME,
      credential: env.TURN_PASSWORD,
    });
  }
  return iceServers;
}

export function configRoutes(
  fastify: FastifyInstance,
  _opts: unknown,
  done: (err?: Error) => void,
): void {
  // ─── Read current public config ─────────────────────────────
  fastify.get(
    '/',
    { onRequest: [fastify.authenticate] },
    async (_req, reply) => {
      const googleMapsApiKey = await fastify.redis.get(REDIS_KEY);
      return reply.send({ success: true, data: { googleMapsApiKey: googleMapsApiKey || null } });
    },
  );

  // ─── WebRTC ICE servers (STUN/TURN) ─────────────────────────
  // Any authenticated client (mobile app + portals) fetches this before
  // starting a stream, so the TURN credential is centralized here and can never
  // drift out of sync with the coturn container the way a hardcoded value does.
  fastify.get(
    '/ice-servers',
    { onRequest: [fastify.authenticate] },
    async (_req, reply) => {
      return reply.send({ success: true, data: { iceServers: buildIceServers() } });
    },
  );

  // ─── Update config (admin only) ─────────────────────────────
  fastify.put(
    '/',
    { onRequest: [fastify.authenticate, requireRoles(['admin'])] },
    async (req, reply) => {
      const body = (req.body ?? {}) as { googleMapsApiKey?: string };
      const value = (body.googleMapsApiKey ?? '').trim();
      if (value) {
        await fastify.redis.set(REDIS_KEY, value);
      } else {
        await fastify.redis.del(REDIS_KEY);
      }
      req.log.info({ userId: req.user?.id }, 'Google Maps API key updated via admin config');
      return reply.send({ success: true, data: { googleMapsApiKey: value || null } });
    },
  );

  done();
}
