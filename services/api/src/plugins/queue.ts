import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import { Queue } from 'bullmq';

declare module 'fastify' {
  interface FastifyInstance {
    queues: {
      notifications: Queue;
      escalations: Queue;
      dispatch: Queue;
    };
  }
}

async function queuePlugin(fastify: FastifyInstance): Promise<void> {
  const notificationsQueue = new Queue('notifications', {
    connection: fastify.redisBullMQ as any,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      // Keep a day of history: 'removeOnComplete: true' discarded every trace
      // of how an SOS fan-out actually went, which is exactly what you need
      // when investigating an alert that did not reach someone.
      removeOnComplete: { age: 24 * 3600, count: 1000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  });

  const escalationsQueue = new Queue('escalations', {
    connection: fastify.redisBullMQ as any,
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: { age: 24 * 3600, count: 1000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  });

  // Everything the SOS request used to do inline: audit log, police case
  // creation and the nearby-responder fan-out. Keeping it off the request path
  // is what makes the panic button fast; keeping it in a queue is what makes it
  // reliable, because a transient failure retries instead of being lost.
  const dispatchQueue = new Queue('dispatch', {
    connection: fastify.redisBullMQ as any,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 500 },
      removeOnComplete: { age: 24 * 3600, count: 1000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  });

  fastify.decorate('queues', {
    notifications: notificationsQueue,
    escalations: escalationsQueue,
    dispatch: dispatchQueue,
  });

  // Graceful shutdown
  fastify.addHook('onClose', async (app) => {
    await app.queues.notifications.close();
    await app.queues.escalations.close();
    await app.queues.dispatch.close();
    app.log.info('BullMQ Queues closed');
  });

  fastify.log.info('✅ BullMQ Queues initialized');
}

export default fp(queuePlugin, {
  name: 'queue',
  dependencies: ['redis'],
  fastify: '5.x',
});
