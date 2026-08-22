/**
 * CORS Plugin.
 *
 * Configured for the police portal and admin portal origins only.
 * Never open CORS to '*' — this is a safety-critical system.
 */

import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { env } from '@/config/env';
import { ForbiddenError } from '@/utils/errors';

async function corsPlugin(fastify: FastifyInstance): Promise<void> {
  await fastify.register(cors, {
    // Allow configured origins + null origin (React Native mobile apps don't
    // send an Origin header, so the browser/native runtime sends origin=null)
    origin: (origin, cb) => {
      if (!origin || env.CORS_ORIGINS.includes('*') || env.CORS_ORIGINS.includes(origin)) {
        cb(null, true);
      } else {
        // A ForbiddenError, not a bare Error.
        //
        // A plain Error is not an AppError, so the global handler treated a
        // rejected cross-origin request as an UNEXPECTED failure: HTTP 500,
        // logged at error level, and (once Sentry was wired up) reported as an
        // incident. A browser calling from an origin we do not allow is a
        // routine, expected refusal — it should be a 403.
        //
        // The status code matters beyond tidiness: every scanner and
        // misconfigured client would otherwise inflate the 5xx rate and page
        // someone through the ApiErrorRateHigh alert rule.
        cb(new ForbiddenError(`Origin '${origin}' is not allowed`), false);
      }
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    // The portals send cache-busting headers on polling requests, so these
    // must be in the preflight allow-list or the browser blocks the request.
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Request-ID',
      'Cache-Control',
      'Pragma',
      'Expires',
    ],
    exposedHeaders: ['X-Request-ID'],
    credentials: true,
    // Preflight cache: 24 hours
    maxAge: 86400,
  });
}

export default fp(corsPlugin, {
  name: 'cors',
  fastify: '5.x',
});
