/**
 * Redis Plugin.
 *
 * Registers an ioredis client on the Fastify instance.
 * Used for:
 *  - BullMQ job queues (notifications, location updates)
 *  - Session/refresh token storage
 *  - Rate limit storage
 *  - Caching
 *
 * Usage: fastify.redis.get('key')
 */

import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import Redis from 'ioredis';
import { env } from '@/config/env';

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis;
    redisBullMQ: Redis;
  }
}

async function redisPlugin(fastify: FastifyInstance): Promise<void> {
  const redisOptions = {
    password: env.REDIS_PASSWORD || undefined,
    retryStrategy: (times: number) => {
      if (times > 5) {
        fastify.log.error('Redis connection failed after 5 retries');
        return null;
      }
      return Math.min(times * 200, 2000);
    },
    lazyConnect: false,
  };

  // General-purpose Redis client (for caching, sessions, rate-limiting)
  const redis = new Redis(env.REDIS_URL, {
    ...redisOptions,
    maxRetriesPerRequest: 3,
  });

  // BullMQ-dedicated Redis client — MUST have maxRetriesPerRequest: null
  const redisBullMQ = new Redis(env.REDIS_URL, {
    ...redisOptions,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  // Test connection on startup
  await redis.ping();
  fastify.log.info('✅ Redis connected');

  fastify.decorate('redis', redis);
  fastify.decorate('redisBullMQ', redisBullMQ);

  // Graceful disconnect on shutdown
  fastify.addHook('onClose', async (app) => {
    await app.redis.quit();
    await app.redisBullMQ.quit();
    app.log.info('Redis disconnected');
  });

  // Log connection errors (don't crash — Redis reconnects automatically)
  redis.on('error', (err) => {
    fastify.log.error({ err }, 'Redis connection error');
  });

  redis.on('reconnecting', (): void => {
    fastify.log.warn('Redis reconnecting...');
  });

  redisBullMQ.on('error', (err) => {
    fastify.log.error({ err }, 'RedisBullMQ connection error');
  });
}

export default fp(redisPlugin, {
  name: 'redis',
  fastify: '5.x',
});
