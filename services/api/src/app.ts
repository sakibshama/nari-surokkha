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

import { env, IS_PRODUCTION, TRUST_PROXY } from '@/config/env';
import databasePlugin from '@/plugins/database';
import sentryPlugin from '@/plugins/sentry';
import metricsPlugin from '@/plugins/metrics';
import redisPlugin from '@/plugins/redis';
import corsPlugin from '@/plugins/cors';
import rateLimitPlugin from '@/plugins/rate-limit';
import swaggerPlugin from '@/plugins/swagger';
import queuePlugin from '@/plugins/queue';
import websocketPlugin from '@/plugins/websocket';
import workerPlugin from '@/plugins/worker';
import firebasePlugin from '@/plugins/firebase';
import { healthRoutes } from '@/routes/health.route';
import { trackingRoutes } from '@/routes/tracking.route';
import { contactConsentRoutes } from '@/routes/contact-consent.route';
import { registerErrorHandler } from '@/middleware/error-handler';
import { setupAuthenticateMiddleware } from '@/middleware/authenticate';
import { authRoutes } from '@/modules/auth/auth.routes';
import { profileRoutes } from '@/modules/profile/profile.routes';
import { contactsRoutes } from '@/modules/contacts/contacts.routes';
import { alertsRoutes } from '@/modules/alerts/alerts.routes';
import { evidenceRoutes } from '@/modules/evidence/evidence.routes';
import { responderRoutes } from '@/modules/responder/responder.routes';
import { incidentsRoutes } from '@/modules/incidents/incidents.routes';
import { adminRoutes } from '@/modules/admin/admin.routes';
import { rolesRoutes } from '@/modules/roles/roles.routes';
import { configRoutes } from '@/modules/config/config.routes';
import { settingsRoutes } from '@/modules/settings/settings.routes';
import { mlRoutes } from '@/modules/ml/ml.routes';
import { subscriptionRoutes } from '@/modules/subscriptions/subscription.routes';
import { paymentsAdminRoutes } from '@/modules/payments/payments.admin.routes';
import { mapRoutes } from '@/modules/map/map-tiles';
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
    // Which proxies may set X-Forwarded-For (B3). Drives request.ip, which is
    // what rate limiting keys on.
    trustProxy: TRUST_PROXY,
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

  // ─── Error tracking (first, so it sees boot failures) ───
  await fastify.register(sentryPlugin);

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
    parseOptions: {
      // The portals authenticate by cookie, which makes every state-changing
      // endpoint a CSRF target. SameSite=strict is the primary defence: the
      // browser simply will not attach this cookie to a cross-site request.
      sameSite: 'strict',
      httpOnly: true,
      secure: IS_PRODUCTION,
      path: '/',
    },
  });

  // ─── CSRF defence in depth ──────────────────────────────
  // SameSite=strict covers modern browsers, but it is one flag away from being
  // the only thing standing between a malicious page and an authenticated
  // write. For requests authenticated by COOKIE (never for Bearer tokens,
  // which a cross-site page cannot read or attach), also require the Origin to
  // be one we allow.
  fastify.addHook('onRequest', (request, reply, done) => {
    const method = request.method.toUpperCase();
    const isWrite = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
    if (!isWrite) return done();

    // Bearer-token requests are not CSRF-able: an attacker's page cannot read
    // the token to attach it.
    if (request.headers.authorization) return done();
    if (!request.cookies?.accessToken) return done();

    const origin = request.headers.origin;
    // Same-origin form posts and non-browser clients send no Origin at all.
    // A cross-site browser request always does.
    if (!origin) return done();

    const allowed = Array.isArray(env.CORS_ORIGINS)
      ? env.CORS_ORIGINS
      : String(env.CORS_ORIGINS).split(',').map((o) => o.trim());

    if (!allowed.includes(origin)) {
      request.log.warn({ origin, url: request.url }, 'Blocked cross-origin cookie-authenticated write');
      void reply.code(403).send({
        success: false,
        error: { code: 'SEC_001', message: 'Cross-origin request rejected' },
      });
      return;
    }
    done();
  });

  // ─── Queue & Realtime ───────────────────────────────────
  await fastify.register(queuePlugin);
  await fastify.register(websocketPlugin);
  await fastify.register(workerPlugin);
  await fastify.register(firebasePlugin);

  // ─── Metrics (after queues, which it samples) ───────────
  await fastify.register(metricsPlugin);

  // ─── API Documentation (dev/staging only) ───────────────
  await fastify.register(swaggerPlugin);

  // ─── Global Middleware ──────────────────────────────────
  setupAuthenticateMiddleware(fastify);



  // ─── Routes ─────────────────────────────────────────────
  // Health check (public — no prefix)
  await fastify.register(healthRoutes);

  // Public SOS live-tracking page (short link sent in SMS: /t/:token)
  await fastify.register(trackingRoutes);

  // Public trusted-contact consent page (short link sent in SMS: /c/:token)
  await fastify.register(contactConsentRoutes);

  // All API routes are prefixed with /api/v1
  await fastify.register(
    (apiRouter, _opts, done) => {
      // Modules
      void apiRouter.register(authRoutes, { prefix: '/auth' });
      void apiRouter.register(profileRoutes, { prefix: '/profile' });
      void apiRouter.register(contactsRoutes, { prefix: '/contacts' });
      void apiRouter.register(alertsRoutes, { prefix: '/alerts' });
      void apiRouter.register(evidenceRoutes, { prefix: '/evidence' });
      void apiRouter.register(responderRoutes, { prefix: '/responders' });
      void apiRouter.register(incidentsRoutes, { prefix: '/incidents' });
      void apiRouter.register(adminRoutes, { prefix: '/admin' });
      void apiRouter.register(rolesRoutes, { prefix: '/admin/roles' });
      void apiRouter.register(configRoutes, { prefix: '/config' });
      void apiRouter.register(settingsRoutes, { prefix: '/settings' });
      void apiRouter.register(mlRoutes, { prefix: '/ml' });
      void apiRouter.register(subscriptionRoutes, { prefix: '/subscriptions' });
      void apiRouter.register(paymentsAdminRoutes, { prefix: '/payments' });
      void apiRouter.register(mapRoutes, { prefix: '/map' });

      // Connection check used by the mobile Settings screen.
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

  // ─── Request / Response Logging ─────────────────────────
  // Deliberately NOT re-implemented here. Fastify's own logger already emits
  // an "incoming request" line (with reqId, method, url) and a "request
  // completed" line (with statusCode and responseTime). The hooks that used to
  // live here duplicated both, so every request produced four log lines and
  // four JSON serialisations instead of two — pure overhead, and on a
  // json-file driver with no size cap, a slow disk-fill.
  //
  // Per-route detail now comes from Prometheus (plugins/metrics), which is
  // both cheaper and queryable.

  return fastify;
}
