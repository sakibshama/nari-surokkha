/**
 * Health Route — Unit Tests
 *
 * Tests health endpoint response shapes WITHOUT real DB or Redis.
 * We mock the plugins so these tests run fast and offline.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { healthRoutes } from '@/routes/health.route';
import { registerErrorHandler } from '@/middleware/error-handler';

// ─── Mock Prisma and Redis on the app ─────────────────────────

function buildTestApp(): FastifyInstance {
  const app = Fastify({ logger: false });

  // Decorate with mocks (so health routes can access fastify.prisma and fastify.redis)
  app.decorate('prisma', {
    $queryRaw: vi.fn().mockResolvedValue([{ ok: 1 }]),
  } as unknown as FastifyInstance['prisma']);

  app.decorate('redis', {
    ping: vi.fn().mockResolvedValue('PONG'),
  } as unknown as FastifyInstance['redis']);

  void app.register(healthRoutes);
  registerErrorHandler(app);

  return app;
}

describe('GET /health', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 with ok status when all services are healthy', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      status: string;
      timestamp: string;
      uptime: number;
      services: { database: string; redis: string };
    }>();
    expect(body.status).toBe('ok');
    expect(body.services.database).toBe('ok');
    expect(body.services.redis).toBe('ok');
    expect(typeof body.timestamp).toBe('string');
    expect(typeof body.uptime).toBe('number');
  });

  it('returns 503 when database is down', async () => {
    const appWithBadDb = Fastify({ logger: false });

    appWithBadDb.decorate('prisma', {
      $queryRaw: vi.fn().mockRejectedValue(new Error('DB connection refused')),
    } as unknown as FastifyInstance['prisma']);

    appWithBadDb.decorate('redis', {
      ping: vi.fn().mockResolvedValue('PONG'),
    } as unknown as FastifyInstance['redis']);

    void appWithBadDb.register(healthRoutes);
    registerErrorHandler(appWithBadDb);
    await appWithBadDb.ready();

    const response = await appWithBadDb.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(503);

    const body = response.json<{ services: { database: string } }>();
    expect(body.services.database).toBe('error');

    await appWithBadDb.close();
  });

  it('returns 503 when redis is down', async () => {
    const appWithBadRedis = Fastify({ logger: false });

    appWithBadRedis.decorate('prisma', {
      $queryRaw: vi.fn().mockResolvedValue([{ ok: 1 }]),
    } as unknown as FastifyInstance['prisma']);

    appWithBadRedis.decorate('redis', {
      ping: vi.fn().mockRejectedValue(new Error('Redis connection refused')),
    } as unknown as FastifyInstance['redis']);

    void appWithBadRedis.register(healthRoutes);
    registerErrorHandler(appWithBadRedis);
    await appWithBadRedis.ready();

    const response = await appWithBadRedis.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(503);

    const body = response.json<{ services: { redis: string } }>();
    expect(body.services.redis).toBe('error');

    await appWithBadRedis.close();
  });
});

describe('GET /health/live', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 alive when server is up', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/live' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'alive' });
  });
});

describe('Global Error Handler', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildTestApp();

    // Add a test route that throws
    app.get('/test-error', async () => {
      throw new Error('Something broke');
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 404 for unknown routes', async () => {
    const response = await app.inject({ method: 'GET', url: '/unknown-route' });
    expect(response.statusCode).toBe(404);
    const body = response.json<{ success: boolean; error: { code: string } }>();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('SERVER_002');
  });

  it('returns 500 for unexpected server errors without leaking details', async () => {
    const response = await app.inject({ method: 'GET', url: '/test-error' });
    expect(response.statusCode).toBe(500);
    const body = response.json<{ success: boolean; error: { code: string; message: string } }>();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('SERVER_001');
    // Must NOT leak internal error message
    expect(body.error.message).not.toContain('Something broke');
    expect(body.error.message).toContain('unexpected error');
  });
});
