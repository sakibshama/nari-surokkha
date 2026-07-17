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

async function databasePlugin(fastify: FastifyInstance): Promise<void> {
  const prisma = new PrismaClient({
    log:
      env.NODE_ENV === 'development'
        ? ['query', 'info', 'warn', 'error']
        : ['warn', 'error'],
    datasources: {
      db: { url: env.DATABASE_URL },
    },
  });

  // Connect on startup — fail fast if DB unreachable
  await prisma.$connect();
  fastify.log.info('✅ PostgreSQL connected via Prisma');

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
