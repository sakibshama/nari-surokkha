import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import { Worker, Job } from 'bullmq';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { AlertsService } from '@/modules/alerts/alerts.service';
import { AlertsRepository } from '@/modules/alerts/alerts.repository';
import { ContactsRepository } from '@/modules/contacts/contacts.repository';
import { ResponderRepository } from '@/modules/responder/responder.repository';
import { CasesRepository } from '@/modules/cases/cases.repository';
import { CasesService } from '@/modules/cases/cases.service';
import type { AlertFanOutPayload } from '@/modules/alerts/alerts.service';
import { RUNS_WORKERS } from '@/config/env';
import { flushLocationBuffers } from '@/modules/alerts/alert-location.buffer';

declare module 'fastify' {
  interface FastifyInstance {
    workers: {
      notifications?: Worker;
      escalations?: Worker;
      dispatch?: Worker;
    };
  }
}

async function workerPlugin(fastify: FastifyInstance): Promise<void> {
  // ─── Process role gate ────────────────────────────────────────────────
  // These workers used to start inside every API process, so job processing
  // competed with request handling on the same event loop and could not be
  // scaled independently. In production they now run only in the dedicated
  // worker container (WORKER_MODE=true, entrypoint dist/worker.js).
  if (!RUNS_WORKERS) {
    fastify.decorate('workers', {});
    fastify.log.info('Background workers not started in this process (WORKER_MODE=false)');
    return;
  }

  const notificationsService = new NotificationsService(fastify.prisma, fastify);

  const alertsRepo = new AlertsRepository(fastify.prisma);
  const contactsRepo = new ContactsRepository(fastify.prisma);
  const responderRepo = new ResponderRepository(fastify.prisma);
  const casesRepo = new CasesRepository(fastify.prisma);
  const casesService = new CasesService(casesRepo, fastify);
  const alertsService = new AlertsService(alertsRepo, contactsRepo, responderRepo, casesService, fastify);

  const worker = new Worker(
    'notifications',
    async (job: Job) => {
      // Fan-out: one alert -> one job per trusted contact.
      if (job.name === 'notify_trusted_contacts') {
        const { alertId, userId } = job.data;
        await notificationsService.processTrustedContactsNotification(alertId, userId);
        return;
      }
      // Delivery: one contact, both channels, idempotent and retried alone.
      if (job.name === 'notify_trusted_contact') {
        const { alertId, contactId } = job.data;
        await notificationsService.notifyTrustedContact(alertId, contactId);
      }
    },
    {
      connection: fastify.redisBullMQ as any,
      // Raised from 5: jobs are now per-contact rather than per-alert, so there
      // are more of them and each is smaller. The work is entirely I/O bound
      // (SMS gateway, FCM), so concurrency here is about not queueing behind a
      // slow provider during a burst of simultaneous alerts.
      concurrency: 20,
    }
  );

  worker.on('failed', (job, err) => {
    fastify.log.error({ jobId: job?.id, err }, 'Notification job failed');
  });

  worker.on('completed', (job) => {
    fastify.log.info({ jobId: job.id }, 'Notification job completed');
  });

  const escalationsWorker = new Worker(
    'escalations',
    async (job: Job) => {
      if (job.name === 'auto_escalate_soft_alert') {
        const { alertId, userId } = job.data;
        try {
          // If the alert is still 'created', this will escalate it to 'confirmed' and trigger dispatch
          await alertsService.confirmSoftAlert(userId, alertId);
          fastify.log.info({ alertId }, 'Soft alert automatically escalated to SOS');
        } catch (error: any) {
          if (error.message && error.message.includes('Cannot confirm an alert that is not in soft-alert state')) {
            // It was already cancelled or confirmed manually, safely ignore
            fastify.log.debug({ alertId }, 'Soft alert was already resolved before auto-escalation');
          } else {
            throw error;
          }
        }
      }
    },
    {
      connection: fastify.redisBullMQ as any,
      concurrency: 5,
    }
  );

  escalationsWorker.on('failed', (job, err) => {
    fastify.log.error({ jobId: job?.id, err }, 'Escalations job failed');
  });

  // ─── Dispatch worker ──────────────────────────────────────────────────
  // Carries the heavy half of an SOS — audit log, police case, nearby-responder
  // fan-out — so none of it sits on the citizen's request path. Concurrency is
  // higher than the notification worker because the work is I/O bound and a
  // burst of simultaneous alerts is exactly the scenario that must not queue up.
  const dispatchWorker = new Worker(
    'dispatch',
    async (job: Job) => {
      if (job.name === 'fan_out_alert') {
        await alertsService.fanOutAlert(job.data as AlertFanOutPayload);
      }
    },
    {
      connection: fastify.redisBullMQ as any,
      concurrency: 10,
    },
  );

  dispatchWorker.on('failed', (job, err) => {
    fastify.log.error(
      { jobId: job?.id, alertId: job?.data?.alertId, attempt: job?.attemptsMade, err },
      'Alert dispatch job failed',
    );
  });

  dispatchWorker.on('completed', (job) => {
    fastify.log.info({ jobId: job.id, alertId: job.data?.alertId }, 'Alert dispatch completed');
  });

  // ─── Live-location flusher ────────────────────────────────────────────
  // Drains the Redis ping buffer into Postgres in batches. This is what turns
  // ~100 writes/s of tracking traffic into a handful: one createMany plus one
  // update per active alert per interval, instead of two writes per ping.
  const flushIntervalMs = 15_000;
  const locationFlusher = setInterval(() => {
    void (async () => {
      try {
        const written = await flushLocationBuffers(fastify);
        if (written > 0) {
          fastify.log.debug({ points: written }, 'Flushed buffered location points');
        }
      } catch (err) {
        fastify.log.error({ err }, 'Location buffer flush failed');
      }
    })();
  }, flushIntervalMs);
  locationFlusher.unref();

  // ─── Daily retention sweep ────────────────────────────────────────────
  // alert_locations, audit_logs and notification_logs were append-only with no
  // retention at all. prune_old_records() (migration 20260819100000) deletes in
  // chunks so it never takes a long lock, and never touches location trails for
  // alerts whose case is still open.
  const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;
  const retentionSweep = setInterval(() => {
    void (async () => {
      try {
        const [result] = await fastify.prisma.$queryRaw<
          Array<{ deleted_locations: bigint; deleted_notifications: bigint; deleted_audits: bigint }>
        >`SELECT * FROM prune_old_records();`;
        fastify.log.info(
          {
            locations: Number(result?.deleted_locations ?? 0),
            notifications: Number(result?.deleted_notifications ?? 0),
            audits: Number(result?.deleted_audits ?? 0),
          },
          'Retention sweep complete',
        );
      } catch (err) {
        fastify.log.error({ err }, 'Retention sweep failed');
      }
    })();
  }, RETENTION_INTERVAL_MS);
  retentionSweep.unref();

  fastify.decorate('workers', {
    notifications: worker,
    escalations: escalationsWorker,
    dispatch: dispatchWorker,
  });

  fastify.addHook('onClose', async (app) => {
    clearInterval(locationFlusher);
    clearInterval(retentionSweep);
    // Final drain on shutdown so a rolling deploy never discards the points
    // buffered since the last interval.
    try {
      await flushLocationBuffers(app);
    } catch (err) {
      app.log.error({ err }, 'Final location flush failed during shutdown');
    }
    await app.workers.notifications?.close();
    await app.workers.escalations?.close();
    await app.workers.dispatch?.close();
    app.log.info('BullMQ Worker closed');
  });

  fastify.log.info('✅ BullMQ Worker initialized');
}

export default fp(workerPlugin, {
  name: 'worker',
  dependencies: ['redis', 'database'], // 'queue' is not strictly required but they share redis
  fastify: '5.x',
});
