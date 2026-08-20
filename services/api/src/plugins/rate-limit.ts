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
import jwt from 'jsonwebtoken';
import type { FastifyRequest } from 'fastify';
import { env } from '@/config/env';
import { TooManyRequestsError } from '@/utils/errors';
import type { JwtAccessPayload } from '@/types/index';

/**
 * Choose the rate-limit bucket for a request.
 *
 * Keying purely on IP is wrong for this application's users. Mobile carriers
 * in Bangladesh sit behind CGNAT, so thousands of subscribers share one public
 * address — a global limit of 100 req/min would be consumed by strangers, and
 * the person it throttles might be the one pressing the SOS button.
 *
 * Authenticated requests are therefore bucketed per user. The token is
 * VERIFIED here rather than merely decoded: trusting an unverified `sub` would
 * let anyone exhaust another user's budget by forging a claim, turning a
 * DoS-protection measure into a DoS vector.
 *
 * Unauthenticated requests (login, register, webhooks) stay on IP, which is
 * the correct grouping for credential-stuffing defence.
 */
function resolveRateLimitKey(request: FastifyRequest): string {
  const header = request.headers.authorization;
  let token: string | undefined;

  if (header?.startsWith('Bearer ')) {
    token = header.slice(7);
  } else if (typeof request.cookies?.accessToken === 'string') {
    token = request.cookies.accessToken;
  }

  if (token) {
    try {
      const payload = jwt.verify(token, env.JWT_SECRET) as JwtAccessPayload;
      if (payload.type === 'access' && payload.sub) {
        return `user:${payload.sub}`;
      }
    } catch {
      // Invalid or expired — fall through to IP so a flood of bad tokens is
      // still limited.
    }
  }

  const forwarded = (request.headers['x-forwarded-for'] as string | undefined)
    ?.split(',')[0]
    ?.trim();
  return `ip:${forwarded || request.ip}`;
}

async function rateLimitPlugin(fastify: FastifyInstance): Promise<void> {
  await fastify.register(rateLimit, {
    // Use Redis for distributed rate limiting (multi-instance safe)
    redis: fastify.redis,
    // Global defaults
    max: env.RATE_LIMIT_GLOBAL_MAX,
    timeWindow: env.RATE_LIMIT_GLOBAL_WINDOW_MS,
    // Per user when authenticated, per IP otherwise — see resolveRateLimitKey.
    keyGenerator: resolveRateLimitKey,
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
