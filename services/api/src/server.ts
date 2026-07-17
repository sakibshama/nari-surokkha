/**
 * Server Bootstrap — Entry Point.
 *
 * Builds the app and starts listening on the configured port.
 * Handles graceful shutdown for SIGTERM and SIGINT signals.
 *
 * This is the ONLY file that calls fastify.listen().
 * Tests import buildApp() directly and never call listen().
 */

import { buildApp } from './app';
import { env } from './config/env';

async function main(): Promise<void> {
  const app = await buildApp();

  // ─── Start Server ─────────────────────────────────────────
  await app.listen({
    port: env.PORT,
    host: env.HOST,
  });

  app.log.info(`🚀 Nari Surokkha API running on ${env.API_BASE_URL}`);
  app.log.info(`📚 API docs: ${env.API_BASE_URL}/docs (dev/staging only)`);
  app.log.info(`❤️  Health: ${env.API_BASE_URL}/health`);

  // ─── Graceful Shutdown ────────────────────────────────────
  // Handle SIGTERM (Docker, Kubernetes stop)
  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`Received ${signal}. Shutting down gracefully...`);
    try {
      await app.close();  // Triggers all onClose hooks (DB disconnect, Redis quit)
      app.log.info('Server closed successfully');
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // ─── Unhandled Promise Rejections ────────────────────────
  // For a safety-critical app: log and crash — do not swallow errors
  process.on('unhandledRejection', (reason, promise) => {
    app.log.fatal({ reason, promise }, '💥 Unhandled Promise Rejection — crashing');
    process.exit(1);
  });

  process.on('uncaughtException', (err) => {
    app.log.fatal({ err }, '💥 Uncaught Exception — crashing');
    process.exit(1);
  });
}

void main();
