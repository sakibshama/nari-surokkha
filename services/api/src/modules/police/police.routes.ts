/**
 * Police Routes
 */

import { FastifyInstance } from 'fastify';
import { PoliceController } from './police.controller';
import { PoliceService } from './police.service';
import { PoliceRepository } from './police.repository';
import {
  policeLoginSchema,
  getActiveAlertsSchema,
  getAlertByIdSchema,
  updateAlertStatusSchema,
  getPoliceProfileSchema,
  updatePoliceProfileSchema,
  changePolicePasswordSchema,
} from './police.schemas';
import { ForbiddenError } from '@/utils/errors';

export function policeRoutes(
  fastify: FastifyInstance,
  _opts: unknown,
  done: (err?: Error) => void,
): void {
  const repo = new PoliceRepository(fastify.prisma);
  const service = new PoliceService(repo, fastify);
  const controller = new PoliceController(service);

  // ─── Public Routes ──────────────────────────────────────────

  fastify.post(
    '/auth/login',
    { schema: policeLoginSchema },
    controller.login,
  );

  // ─── Authenticated Routes ───────────────────────────────────

  fastify.register((authRequiredRouter, _opts, innerDone) => {
    // Require authentication
    authRequiredRouter.addHook('onRequest', fastify.authenticate);

    // Require Police role
    authRequiredRouter.addHook('preHandler', async (request) => {
      const user = request.user as any;
      if (user.role !== 'police' && user.role !== 'officer' && user.role !== 'supervisor' && user.role !== 'admin') {
        throw new ForbiddenError('Access denied: Police clearance required.');
      }
    });

    fastify.get('/stations', controller.getStations);
    fastify.get('/responders', controller.getResponders);

    authRequiredRouter.get(
      '/alerts',
      { schema: getActiveAlertsSchema },
      controller.getActiveAlerts,
    );

    authRequiredRouter.get(
      '/alerts/:id',
      { schema: getAlertByIdSchema },
      controller.getAlertById,
    );

    authRequiredRouter.patch(
      '/alerts/:id/status',
      { schema: updateAlertStatusSchema },
      controller.updateAlertStatus,
    );

    authRequiredRouter.get(
      '/profile',
      { schema: getPoliceProfileSchema },
      controller.getProfile,
    );

    authRequiredRouter.put(
      '/profile',
      { schema: updatePoliceProfileSchema },
      controller.updateProfile,
    );

    authRequiredRouter.post(
      '/auth/change-password',
      { schema: changePolicePasswordSchema },
      controller.changePassword,
    );

    innerDone();
  });

  done();
}
