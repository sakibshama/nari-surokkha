/**
 * Rate Limit Plugin.
 *
 * Global rate limiting using @fastify/rate-limit backed by Redis.
 * Specific routes (auth) apply stricter limits via override.
 *
 * IMPORTANT: Rate limits are a critical security layer for an emergency app.
 * Never remove or bypass them without a security review.
 */

import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { env } from '@/config/env';
import { TooManyRequestsError } from '@/utils/errors';

async function rateLimitPlugin(fastify: FastifyInstance): Promise<void> {
  await fastify.register(rateLimit, {
    // Use Redis for distributed rate limiting (multi-instance safe)
    redis: fastify.redis,
    // Global defaults
    max: env.RATE_LIMIT_GLOBAL_MAX,
    timeWindow: env.RATE_LIMIT_GLOBAL_WINDOW_MS,
    // Key by IP address
    keyGenerator: (request) => {
      return (
        (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
        request.ip
      );
    },
    // Don't expose rate limit headers in production to avoid info leakage
    addHeadersOnExceeding: {
      'x-ratelimit-limit': env.NODE_ENV !== 'production',
      'x-ratelimit-remaining': env.NODE_ENV !== 'production',
      'x-ratelimit-reset': env.NODE_ENV !== 'production',
    },
    addHeaders: {
      'x-ratelimit-limit': env.NODE_ENV !== 'production',
      'x-ratelimit-remaining': env.NODE_ENV !== 'production',
      'x-ratelimit-reset': env.NODE_ENV !== 'production',
      'retry-after': true,
    },
    errorResponseBuilder: (_request, context) => {
      throw new TooManyRequestsError(`Too many requests. Retry after ${Math.ceil(context.ttl / 1000)} seconds.`);
    },
  });
}

export default fp(rateLimitPlugin, {
  name: 'rate-limit',
  fastify: '5.x',
  // Must run after redis plugin
  dependencies: ['redis'],
});
