/**
 * Worker Bootstrap — background jobs only.
 *
 * Runs the same image as the API with WORKER_MODE=true. It builds the full
 * application context (Prisma, Redis, settings, storage, Socket.IO, BullMQ
 * workers) but never calls listen() on the API port, so this process serves no
 * HTTP traffic and does nothing but drain queues.
 *
 * Why this exists
 * ---------------
 * The BullMQ workers used to be registered inside buildApp(), which meant
 * every API replica also processed notifications and dispatch. Three problems:
 *
 *   1. A burst of simultaneous alerts — precisely the scenario this system
 *      exists for — put SMS fan-out and request handling on the same event
 *      loop, so the slow work made the panic button slow.
 *   2. You could not scale request capacity and job capacity separately.
 *   3. A worker crash took down an HTTP server with it.
 *
 * Socket.IO note: this process attaches Socket.IO to an HTTP server that never
 * listens. That is intentional and correct — the Redis adapter means an emit
 * from here still reaches clients connected to any API replica, which is how
 * the dispatch worker notifies responders.
 */

import { buildApp } from './app';
import { env, RUNS_WORKERS } from './config/env';
import { startMetricsServer } from './observability/metrics-server';

async function main(): Promise<void> {
  if (!RUNS_WORKERS) {
    console.error(
      '❌ worker.ts started but WORKER_MODE is false. ' +
        'Set WORKER_MODE=true for the worker container, or run dist/server.js instead.',
    );
    process.exit(1);
  }

  const app = await buildApp();

  // Ready() runs all plugin registration (including the BullMQ workers)
  // without binding the API port.
  await app.ready();

  // Metrics still served, on METRICS_PORT — this is how Prometheus sees queue
  // depth and job durations for the worker fleet.
  const metricsServer = await startMetricsServer(app);

  const queues = Object.keys(app.workers ?? {}).join(', ') || 'none';
  app.log.info(`⚙️  Nari Surokkha worker running (queues: ${queues})`);
  app.log.info(`📊 Worker metrics on :${env.METRICS_PORT}/metrics`);

  // ─── Graceful shutdown ────────────────────────────────────
  // Order matters: stop accepting new jobs, let in-flight jobs finish (BullMQ
  // Worker.close() waits for them), then drop infrastructure. A job killed
  // mid-flight is an SOS notification that may never be sent.
  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`Received ${signal}. Draining jobs before shutdown...`);
    try {
      await metricsServer?.close();
      await app.close(); // onClose hooks close workers, queues, Redis, Prisma
      app.log.info('Worker closed successfully');
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'Error during worker shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

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
