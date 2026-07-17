/**
 * Health Check Route.
 *
 * GET /health
 *
 * Returns the health status of all dependencies:
 * - API server itself
 * - PostgreSQL (via Prisma)
 * - Redis
 *
 * Used by:
 * - Docker health check
 * - Nginx upstream health check
 * - Monitoring systems (Prometheus, UptimeRobot)
 * - GitHub Actions CI
 *
 * IMPORTANT: This route is PUBLIC (no auth required).
 * Do NOT expose sensitive information in this response.
 */

import { FastifyInstance } from 'fastify';
import { isLocalStorage, isUploadDirWritable } from '@/utils/storage-path';

interface HealthStatus {
  status: 'ok' | 'degraded' | 'error';
  timestamp: string;
  version: string;
  uptime: number;
  services: {
    database: 'ok' | 'error';
    redis: 'ok' | 'error';
    storage: 'ok' | 'error';
  };
}

export function healthRoutes(fastify: FastifyInstance): void {
  fastify.get<{ Reply: HealthStatus }>(
    '/health',
    {
      schema: {
        tags: ['health'],
        summary: 'Health check',
        description: 'Returns health status of the API and all its dependencies.',
        security: [],  // Public — no auth
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['ok', 'degraded', 'error'] },
              timestamp: { type: 'string', format: 'date-time' },
              version: { type: 'string' },
              uptime: { type: 'number' },
              services: {
                type: 'object',
                properties: {
                  database: { type: 'string', enum: ['ok', 'error'] },
                  redis: { type: 'string', enum: ['ok', 'error'] },
                  storage: { type: 'string', enum: ['ok', 'error'] },
                },
              },
            },
          },
        },
      },
      // Health check is exempt from global rate limiting
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (_request, reply) => {
      const checks = await Promise.allSettled([
        // Database: try a simple query
        fastify.prisma.$queryRaw`SELECT 1 AS ok`,
        // Redis: ping
        fastify.redis.ping(),
      ]);

      const dbOk = checks[0].status === 'fulfilled';
      const redisOk = checks[1].status === 'fulfilled';
      // Evidence storage: in local-disk mode confirm the dir is writable;
      // in S3 mode we assume the external bucket is reachable.
      const storageOk = isLocalStorage() ? isUploadDirWritable() : true;

      const allOk = dbOk && redisOk && storageOk;

      const status: HealthStatus['status'] = allOk ? 'ok' : 'degraded';

      // Log unhealthy state
      if (!allOk) {
        fastify.log.error(
          { db: checks[0], redis: checks[1], storageOk },
          '⚠️ Health check failed for one or more services',
        );
      }

      return reply.status(allOk ? 200 : 503).send({
        status,
        timestamp: new Date().toISOString(),
        version: process.env['npm_package_version'] ?? '0.1.0',
        uptime: Math.floor(process.uptime()),
        services: {
          database: dbOk ? 'ok' : 'error',
          redis: redisOk ? 'ok' : 'error',
          storage: storageOk ? 'ok' : 'error',
        },
      });
    },
  );

  // Kubernetes-style liveness probe (simpler — just checks server is up)
  fastify.get('/health/live', {
    schema: { tags: ['health'], summary: 'Liveness probe', security: [] },
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
  }, (_request, reply) => {
    return reply.status(200).send({ status: 'alive' });
  });

  // Readiness probe — checks if server is ready to accept traffic
  fastify.get('/health/ready', {
    schema: { tags: ['health'], summary: 'Readiness probe', security: [] },
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (_request, reply) => {
    try {
      await fastify.prisma.$queryRaw`SELECT 1`;
      await fastify.redis.ping();
      return reply.status(200).send({ status: 'ready' });
    } catch {
      return reply.status(503).send({ status: 'not_ready' });
    }
  });
}
