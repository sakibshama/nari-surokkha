/**
 * Sentry Error Tracking.
 *
 * SENTRY_DSN has been declared in config/env.ts since the project started and
 * was referenced nowhere else — meaning an unhandled exception in production
 * went to a container log nobody was tailing. For an emergency-response
 * service that is the difference between "we found out in ten minutes" and
 * "we found out when a user complained".
 *
 * Initialisation is a no-op when SENTRY_DSN is unset, so development and tests
 * are unaffected.
 */

import fp from 'fastify-plugin';
import { FastifyInstance, FastifyRequest } from 'fastify';
import * as Sentry from '@sentry/node';
import { env } from '@/config/env';
import { isAppError } from '@/utils/errors';

/**
 * Report an error to Sentry with request context attached.
 * Safe to call when Sentry is disabled.
 */
export function captureError(err: unknown, request?: FastifyRequest): void {
  if (!env.SENTRY_DSN) return;

  Sentry.withScope((scope) => {
    if (request) {
      scope.setTag('method', request.method);
      scope.setTag('route', request.routeOptions?.url ?? request.url);
      scope.setTag('requestId', String(request.id));
      // Identify by user id only. Never send phone numbers, locations or
      // evidence keys to a third-party service — this is a safety platform and
      // that data is exactly what must not leak.
      if (request.user?.id) {
        scope.setUser({ id: request.user.id });
      }
    }
    Sentry.captureException(err);
  });
}

async function sentryPlugin(fastify: FastifyInstance): Promise<void> {
  if (!env.SENTRY_DSN) {
    fastify.log.info('Sentry disabled (SENTRY_DSN not set)');
    return;
  }

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    release: process.env['npm_package_version'] ?? '0.1.0',
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
    // Scrub anything that could carry personal data out of the payload.
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request) {
        delete event.request.cookies;
        delete event.request.data;
        if (event.request.headers) {
          delete event.request.headers['authorization'];
          delete event.request.headers['cookie'];
        }
      }
      return event;
    },
  });

  fastify.addHook('onClose', async () => {
    await Sentry.close(2000);
  });

  fastify.log.info('✅ Sentry error tracking enabled');
}

/** True when an error is worth paging about (i.e. not a client mistake). */
export function isReportable(err: unknown): boolean {
  if (isAppError(err)) {
    // 4xx operational errors are the client's problem, not an incident.
    return !err.isOperational;
  }
  return true;
}

export default fp(sentryPlugin, {
  name: 'sentry',
  fastify: '5.x',
});
