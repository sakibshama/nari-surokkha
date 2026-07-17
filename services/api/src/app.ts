/**
 * Fastify App Factory.
 *
 * Creates and configures the Fastify application instance.
 * This is a pure factory function — it does NOT listen on a port.
 * Listening is handled by server.ts to allow testing without binding.
 *
 * Registration order matters in Fastify:
 * 1. Core plugins (logger, helmet)
 * 2. Infrastructure plugins (DB, Redis)
 * 3. Security plugins (CORS, rate-limit)
 * 4. Documentation (Swagger)
 * 5. Routes
 * 6. Error handler (last)
 */

import Fastify, { FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';

import { env } from '@/config/env';
import databasePlugin from '@/plugins/database';
import redisPlugin from '@/plugins/redis';
import corsPlugin from '@/plugins/cors';
import rateLimitPlugin from '@/plugins/rate-limit';
import swaggerPlugin from '@/plugins/swagger';
import queuePlugin from '@/plugins/queue';
import websocketPlugin from '@/plugins/websocket';
import workerPlugin from '@/plugins/worker';
import firebasePlugin from '@/plugins/firebase';
import { healthRoutes } from '@/routes/health.route';
import { registerErrorHandler } from '@/middleware/error-handler';
import { setupAuthenticateMiddleware } from '@/middleware/authenticate';
import { authRoutes } from '@/modules/auth/auth.routes';
import { profileRoutes } from '@/modules/profile/profile.routes';
import { contactsRoutes } from '@/modules/contacts/contacts.routes';
import { alertsRoutes } from '@/modules/alerts/alerts.routes';
import { policeRoutes } from '@/modules/police/police.routes';
import { evidenceRoutes } from '@/modules/evidence/evidence.routes';
import { responderRoutes } from '@/modules/responder/responder.routes';
import { casesRoutes } from '@/modules/cases/cases.routes';
import { incidentsRoutes } from '@/modules/incidents/incidents.routes';
import { adminRoutes } from '@/modules/admin/admin.routes';
import { rolesRoutes } from '@/modules/roles/roles.routes';
import { configRoutes } from '@/modules/config/config.routes';
import { settingsRoutes } from '@/modules/settings/settings.routes';
import { mlRoutes } from '@/modules/ml/ml.routes';
import settingsPlugin from '@/plugins/settings';
import storagePlugin from '@/plugins/storage';
import fastifyMultipart from '@fastify/multipart';
import formbody from '@fastify/formbody';
import fastifyCookie from '@fastify/cookie';

export async function buildApp(): Promise<FastifyInstance> {
  // ─── Create Fastify instance ────────────────────────────
  const fastify = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      ...(env.LOG_PRETTY
        ? {
            transport: {
              target: 'pino-pretty',
              options: {
                colorize: true,
                translateTime: 'SYS:standard',
                ignore: 'pid,hostname',
              },
            },
          }
        : {}),
    },
    // Add request IDs for traceability (essential for audit logs)
    genReqId: () => crypto.randomUUID(),
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'requestId',
    // Strict body parsing — Fastify v5 uses ajv directly
    ajv: {
      customOptions: {
        removeAdditional: true,
        coerceTypes: 'array' as const,
        useDefaults: true,
        allErrors: true,
      },
    },
  });

  // ─── Core Security (helmet) ─────────────────────────────
  await fastify.register(helmet, {
    // Content security policy for API responses
    contentSecurityPolicy: false,  // API-only — no HTML served
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });

  // ─── Fastify Sensible (adds reply helpers, httpErrors) ──
  await fastify.register(sensible);

  // ─── Infrastructure Plugins ─────────────────────────────
  // Redis must come before rate-limit (rate-limit depends on it)
  await fastify.register(redisPlugin);
  await fastify.register(databasePlugin);
  // Runtime settings (SMS provider config) — needed by the worker and the
  // SMS webhook, so register right after the database is available.
  await fastify.register(settingsPlugin);

  // ─── Security Plugins ───────────────────────────────────
  await fastify.register(corsPlugin);
  await fastify.register(rateLimitPlugin);
  await fastify.register(storagePlugin);
  await fastify.register(fastifyMultipart, {
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB limit
    }
  });
  await fastify.register(formbody);
  await fastify.register(fastifyCookie, {
    secret: env.JWT_SECRET, // using jwt secret to sign cookies if needed
    hook: 'onRequest',
  });

  // ─── Queue & Realtime ───────────────────────────────────
  await fastify.register(queuePlugin);
  await fastify.register(websocketPlugin);
  await fastify.register(workerPlugin);
  await fastify.register(firebasePlugin);

  // ─── API Documentation (dev/staging only) ───────────────
  await fastify.register(swaggerPlugin);

  // ─── Global Middleware ──────────────────────────────────
  setupAuthenticateMiddleware(fastify);



  // ─── Routes ─────────────────────────────────────────────
  // Health check (public — no prefix)
  await fastify.register(healthRoutes);

  // All API routes are prefixed with /api/v1
  await fastify.register(
    (apiRouter, _opts, done) => {
      // Modules
      void apiRouter.register(authRoutes, { prefix: '/auth' });
      void apiRouter.register(profileRoutes, { prefix: '/profile' });
      void apiRouter.register(contactsRoutes, { prefix: '/contacts' });
      void apiRouter.register(alertsRoutes, { prefix: '/alerts' });
      void apiRouter.register(policeRoutes, { prefix: '/police' });
      void apiRouter.register(evidenceRoutes, { prefix: '/evidence' });
      void apiRouter.register(responderRoutes, { prefix: '/responders' });
      void apiRouter.register(casesRoutes, { prefix: '/cases' });
      void apiRouter.register(incidentsRoutes, { prefix: '/incidents' });
      void apiRouter.register(adminRoutes, { prefix: '/admin' });
      void apiRouter.register(rolesRoutes, { prefix: '/admin/roles' });
      void apiRouter.register(configRoutes, { prefix: '/config' });
      void apiRouter.register(settingsRoutes, { prefix: '/settings' });
      void apiRouter.register(mlRoutes, { prefix: '/ml' });

      // Placeholder for Phase 2 — confirms API router is working
      apiRouter.get('/ping', {
        schema: {
          tags: ['health'],
          summary: 'API ping',
          security: [],
        },
      }, (_req, reply) => {
        return reply.send({ message: 'pong', version: 'v1' });
      });

      done();
    },
    { prefix: '/api/v1' },
  );

  // ─── Global Error Handler (must be last) ────────────────
  registerErrorHandler(fastify);

  // ─── Request / Response Logging Hooks ───────────────────
  fastify.addHook('onRequest', (request, _reply, done) => {
    request.log.info(
      { method: request.method, url: request.url },
      'Incoming request',
    );
    done();
  });

  fastify.addHook('onResponse', (request, reply, done) => {
    request.log.info(
      {
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        responseTime: reply.elapsedTime,
      },
      'Request completed',
    );
    done();
  });

  return fastify;
}
