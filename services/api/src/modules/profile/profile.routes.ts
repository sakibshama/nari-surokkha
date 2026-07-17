/**
 * Profile Routes
 */

import { FastifyInstance } from 'fastify';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';
import { ProfileRepository } from './profile.repository';
import {
  getProfileSchema,
  updateProfileSchema,
  deactivateAccountSchema,
} from './profile.schemas';

export function profileRoutes(
  fastify: FastifyInstance,
  _opts: unknown,
  done: (err?: Error) => void,
): void {
  const repo = new ProfileRepository(fastify.prisma);
  const service = new ProfileService(repo);
  const controller = new ProfileController(service);

  // ─── Authenticated Routes ───────────────────────────────────

  fastify.register((authRequiredRouter, _opts, innerDone) => {
    // Require authentication for all profile routes
    authRequiredRouter.addHook('onRequest', fastify.authenticate);

    authRequiredRouter.get(
      '/',
      { schema: getProfileSchema },
      controller.getProfile,
    );

    authRequiredRouter.put(
      '/',
      { schema: updateProfileSchema },
      controller.updateProfile,
    );

    authRequiredRouter.post(
      '/deactivate',
      { schema: deactivateAccountSchema },
      controller.deactivateAccount,
    );

    innerDone();
  });

  done();
}
