import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import { Queue } from 'bullmq';

declare module 'fastify' {
  interface FastifyInstance {
    queues: {
      notifications: Queue;
      escalations: Queue;
    };
  }
}

async function queuePlugin(fastify: FastifyInstance): Promise<void> {
  const notificationsQueue = new Queue('notifications', {
    connection: fastify.redisBullMQ as any,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: true,
    },
  });

  const escalationsQueue = new Queue('escalations', {
    connection: fastify.redisBullMQ as any,
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: true,
    },
  });

  fastify.decorate('queues', {
    notifications: notificationsQueue,
    escalations: escalationsQueue,
  });

  // Graceful shutdown
  fastify.addHook('onClose', async (app) => {
    await app.queues.notifications.close();
    await app.queues.escalations.close();
    app.log.info('BullMQ Queues closed');
  });

  fastify.log.info('✅ BullMQ Queues initialized');
}

export default fp(queuePlugin, {
  name: 'queue',
  dependencies: ['redis'],
  fastify: '5.x',
});
