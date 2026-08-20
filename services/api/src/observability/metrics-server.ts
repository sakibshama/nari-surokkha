/**
 * Internal metrics/admin server.
 *
 * Runs on its own port (METRICS_PORT, default 9091) bound to the Docker
 * internal network only. Nothing here is proxied by the public nginx config.
 *
 * Why a second server rather than a route on the main app:
 *
 *   - /metrics must not be reachable from the internet. Queue depth, alert
 *     counts and route latencies are operational intelligence about an
 *     emergency service; they should not be public.
 *   - Scrapes must not consume the main server's rate-limit budget or show up
 *     in application request metrics.
 *   - If the main app is saturated, you still want the metrics that tell you
 *     it is saturated.
 */

import Fastify, { FastifyInstance } from 'fastify';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { FastifyAdapter } from '@bull-board/fastify';
import { env } from '@/config/env';
import { metricsRegistry } from '@/plugins/metrics';

/**
 * Build and start the internal server. Returns null when metrics are disabled
 * so the caller can skip shutdown handling.
 */
export async function startMetricsServer(app: FastifyInstance): Promise<FastifyInstance | null> {
  if (!env.METRICS_ENABLED) {
    app.log.info('Metrics server disabled (METRICS_ENABLED=false)');
    return null;
  }

  const server = Fastify({ logger: false });

  // ─── Prometheus scrape endpoint ───────────────────────────────────────
  server.get('/metrics', async (_req, reply) => {
    reply.header('Content-Type', metricsRegistry.contentType);
    return reply.send(await metricsRegistry.metrics());
  });

  // Liveness for the metrics server itself.
  server.get('/health', (_req, reply) => reply.send({ status: 'ok' }));

  // ─── Bull Board (queue inspector) ─────────────────────────────────────
  // Opt-in and password-protected. Without it, a stuck notification queue is
  // invisible until someone reports an SOS that never sent.
  if (env.BULLBOARD_ENABLED && env.BULLBOARD_PASSWORD && app.queues) {
    const adapter = new FastifyAdapter();
    createBullBoard({
      queues: Object.values(app.queues).map((q) => new BullMQAdapter(q)),
      serverAdapter: adapter,
    });
    adapter.setBasePath('/queues');

    // Constant-time-ish basic auth. This port is internal-only, so this is
    // defence in depth rather than the primary control.
    server.addHook('onRequest', (request, reply, done) => {
      if (!request.url.startsWith('/queues')) return done();

      const header = request.headers.authorization ?? '';
      const expected =
        'Basic ' + Buffer.from(`${env.BULLBOARD_USER}:${env.BULLBOARD_PASSWORD}`).toString('base64');

      if (header.length !== expected.length || header !== expected) {
        void reply
          .code(401)
          .header('WWW-Authenticate', 'Basic realm="queues"')
          .send({ error: 'Unauthorized' });
        return;
      }
      done();
    });

    // basePath is set on the adapter above; the plugin only takes a prefix.
    await server.register(adapter.registerPlugin(), { prefix: '/queues' });
    app.log.info('✅ Bull Board mounted at /queues on the metrics port');
  }

  await server.listen({ port: env.METRICS_PORT, host: env.METRICS_HOST });
  app.log.info(`📊 Metrics server on :${env.METRICS_PORT}/metrics`);

  return server;
}
