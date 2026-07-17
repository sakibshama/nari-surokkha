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

async function corsPlugin(fastify: FastifyInstance): Promise<void> {
  await fastify.register(cors, {
    // Allow configured origins + null origin (React Native mobile apps don't
    // send an Origin header, so the browser/native runtime sends origin=null)
    origin: (origin, cb) => {
      if (!origin || env.CORS_ORIGINS.includes('*') || env.CORS_ORIGINS.includes(origin)) {
        cb(null, true);
      } else {
        cb(new Error(`CORS: origin '${origin}' not allowed`), false);
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
