/**
 * Prometheus Metrics Plugin.
 *
 * Until now the system had no way to answer "is the SOS path healthy right
 * now?" other than someone reporting that it wasn't. /health told you the
 * database was reachable; it told you nothing about latency, error rate or
 * whether the dispatch queue was draining.
 *
 * This exposes:
 *   - default Node/process metrics (event-loop lag, heap, GC, handles)
 *   - HTTP request duration/count by route, method and status
 *   - domain SLIs that actually matter for an emergency service (below)
 *
 * GET /metrics is bound to the metrics port and is NOT reachable through the
 * public nginx server block — see deploy/production/nginx. Prometheus scrapes
 * it over the internal Docker network.
 */

import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import metricsPlugin from 'fastify-metrics';
import { Counter, Histogram, Gauge, register } from 'prom-client';
import { env } from '@/config/env';

// ─── Domain SLIs ────────────────────────────────────────────────────────────
// Buckets are chosen around the thresholds we actually care about, not around
// round numbers: 250 ms is "feels instant", 500 ms is the SLO, past 2 s the
// user is staring at a spinner during an emergency.

/** Time from SOS request arriving to the response being sent. */
export const sosTriggerDuration = new Histogram({
  name: 'sos_trigger_duration_seconds',
  help: 'Latency of POST /alerts/sos, from request to response',
  buckets: [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  labelNames: ['outcome'] as const,
});

/** Time from alert creation to the fan-out job completing (audit, case, responders). */
export const sosDispatchDuration = new Histogram({
  name: 'sos_dispatch_duration_seconds',
  help: 'Time from alert creation to responder/station dispatch completing',
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
  labelNames: ['outcome'] as const,
});

/** Time from alert creation to a trusted contact actually being notified. */
export const contactNotifyDuration = new Histogram({
  name: 'contact_notify_duration_seconds',
  help: 'Time from alert creation to a trusted contact notification being sent',
  buckets: [1, 2, 5, 10, 30, 60, 120, 300],
  labelNames: ['channel', 'outcome'] as const,
});

/** Every SOS, by type and final disposition. */
export const alertsTotal = new Counter({
  name: 'alerts_total',
  help: 'Emergency alerts created',
  labelNames: ['type', 'has_station'] as const,
});

/** Outbound notification attempts. */
export const notificationsTotal = new Counter({
  name: 'notifications_total',
  help: 'Notification delivery attempts',
  labelNames: ['channel', 'status'] as const,
});

/** Responders paged per alert — if this is always 0, dispatch is broken. */
export const respondersDispatched = new Histogram({
  name: 'responders_dispatched_per_alert',
  help: 'Number of responders notified for a single alert',
  buckets: [0, 1, 2, 5, 10, 20],
});

/** Live WebSocket connections, by role. */
export const wsConnections = new Gauge({
  name: 'websocket_connections',
  help: 'Currently connected Socket.IO clients',
  labelNames: ['role'] as const,
});

/** Queue depth, sampled — the earliest signal that delivery is falling behind. */
export const queueDepth = new Gauge({
  name: 'queue_depth',
  help: 'Jobs waiting in each BullMQ queue',
  labelNames: ['queue', 'state'] as const,
});

/**
 * Time an async operation into a histogram, recording outcome=success|failure
 * either way. Returns whatever the operation returns.
 */
export async function observe<T>(
  histogram: Histogram<string>,
  labels: Record<string, string>,
  fn: () => Promise<T>,
): Promise<T> {
  const end = histogram.startTimer(labels);
  try {
    const result = await fn();
    end({ outcome: 'success' });
    return result;
  } catch (err) {
    end({ outcome: 'failure' });
    throw err;
  }
}

async function metricsFastifyPlugin(fastify: FastifyInstance): Promise<void> {
  await fastify.register(metricsPlugin, {
    // Served on a separate port so /metrics is never exposed publicly.
    endpoint: null,
    defaultMetrics: { enabled: true },
    routeMetrics: {
      enabled: true,
      // Group by route pattern, not by URL — otherwise every alert id becomes
      // its own time series and the metric cardinality explodes.
      groupStatusCodes: true,
      overrides: {
        histogram: {
          buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
        },
      },
    },
  });

  // ─── Queue depth sampler ──────────────────────────────────────────────
  // Cheap (three Redis counts) and the single best early warning that SMS or
  // dispatch delivery is backing up.
  let sampler: NodeJS.Timeout | undefined;
  if (env.METRICS_ENABLED) {
    sampler = setInterval(() => {
      void (async () => {
        try {
          if (!fastify.queues) return;
          for (const [name, queue] of Object.entries(fastify.queues)) {
            const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed');
            for (const [state, count] of Object.entries(counts)) {
              queueDepth.set({ queue: name, state }, Number(count) || 0);
            }
          }
        } catch (err) {
          fastify.log.debug({ err }, 'queue depth sample failed');
        }
      })();
    }, 15_000);
    sampler.unref();
  }

  fastify.addHook('onClose', async () => {
    if (sampler) clearInterval(sampler);
  });

  fastify.log.info('✅ Prometheus metrics registered');
}

/** The shared prom-client registry, for the metrics server in server.ts. */
export { register as metricsRegistry };

export default fp(metricsFastifyPlugin, {
  name: 'metrics',
  fastify: '5.x',
  dependencies: ['queue'],
});
