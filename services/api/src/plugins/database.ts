/**
 * Prisma Database Plugin.
 *
 * Registers a PrismaClient instance on the Fastify instance.
 * Gracefully disconnects on app shutdown.
 *
 * Usage: fastify.prisma.user.findMany(...)
 */

import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { env } from '@/config/env';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

/**
 * Apply DATABASE_POOL_MAX to the connection string.
 *
 * Prisma has no programmatic pool-size option — it reads `connection_limit`
 * from the URL. DATABASE_POOL_MAX has therefore been validated by env.ts and
 * silently ignored since the project started, leaving the pool on Prisma's
 * default of (num_cpus * 2 + 1) per process. With several API and worker
 * replicas behind PgBouncer, that default is how you exhaust the pooler.
 *
 * An explicit `connection_limit` already present in the URL always wins.
 */
function withPoolSize(url: string, max: number): string {
  try {
    const parsed = new URL(url);
    if (!parsed.searchParams.has('connection_limit')) {
      parsed.searchParams.set('connection_limit', String(max));
    }
    return parsed.toString();
  } catch {
    // Not a parseable URL (e.g. a socket path) — leave it alone.
    return url;
  }
}

async function databasePlugin(fastify: FastifyInstance): Promise<void> {
  const url = withPoolSize(env.DATABASE_URL, env.DATABASE_POOL_MAX);

  const prisma = new PrismaClient({
    log:
      env.NODE_ENV === 'development'
        ? ['query', 'info', 'warn', 'error']
        : ['warn', 'error'],
    datasources: {
      db: { url },
    },
  });

  // Connect on startup — fail fast if DB unreachable
  await prisma.$connect();
  fastify.log.info(
    { connectionLimit: env.DATABASE_POOL_MAX },
    '✅ PostgreSQL connected via Prisma',
  );

  // Make prisma available as fastify.prisma
  fastify.decorate('prisma', prisma);

  // Graceful disconnect on shutdown
  fastify.addHook('onClose', async (app) => {
    await app.prisma.$disconnect();
    app.log.info('PostgreSQL disconnected');
  });
}

export default fp(databasePlugin, {
  name: 'database',
  fastify: '5.x',
});
