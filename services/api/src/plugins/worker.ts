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

declare module 'fastify' {
  interface FastifyInstance {
    workers: {
      notifications?: Worker;
      escalations?: Worker;
    };
  }
}

async function workerPlugin(fastify: FastifyInstance): Promise<void> {
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
      if (job.name === 'notify_trusted_contacts') {
        const { alertId, userId } = job.data;
        await notificationsService.processTrustedContactsNotification(alertId, userId);
      }
    },
    {
      connection: fastify.redisBullMQ as any,
      concurrency: 5, // process up to 5 jobs concurrently
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

  fastify.decorate('workers', {
    notifications: worker,
    escalations: escalationsWorker,
  });

  fastify.addHook('onClose', async (app) => {
    await app.workers.notifications?.close();
    await app.workers.escalations?.close();
    app.log.info('BullMQ Worker closed');
  });

  fastify.log.info('✅ BullMQ Worker initialized');
}

export default fp(workerPlugin, {
  name: 'worker',
  dependencies: ['redis', 'database'], // 'queue' is not strictly required but they share redis
  fastify: '5.x',
});
