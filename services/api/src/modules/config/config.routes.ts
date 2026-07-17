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

const REDIS_KEY = 'config:googleMapsApiKey';

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
