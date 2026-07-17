/**
 * Auth Routes
 *
 * Defines all authentication API endpoints.
 */

import { FastifyInstance } from 'fastify';
import { AuthController } from './auth.controller';
import { AuthService, MAX_LOGIN_ATTEMPTS } from './auth.service';
import { AuthRepository } from './auth.repository';
import {
  registerSchema,
  loginSchema,
  refreshSchema,
  logoutSchema,
  deviceTokenSchema,
  logoutAllSchema,
  changePasswordSchema,
} from './auth.schemas';
import { env } from '@/config/env';

export function authRoutes(fastify: FastifyInstance, _opts: unknown, done: (err?: Error) => void): void {
  const repo = new AuthRepository(fastify.prisma);
  const service = new AuthService(repo);
  const controller = new AuthController(service);

  // ─── Public Routes ──────────────────────────────────────────

  fastify.post(
    '/register',
    { schema: registerSchema },
    controller.register,
  );

  fastify.post(
    '/login',
    {
      schema: loginSchema,
      config: {
        // Strict rate limiting for login
        rateLimit: {
          max: MAX_LOGIN_ATTEMPTS,
          timeWindow: env.RATE_LIMIT_LOGIN_WINDOW_MS,
        },
      },
    },
    controller.login,
  );

  fastify.post(
    '/refresh',
    { schema: refreshSchema },
    controller.refresh,
  );

  fastify.post(
    '/logout',
    { schema: logoutSchema },
    controller.logout,
  );

  // ─── Authenticated Routes ───────────────────────────────────

  fastify.register((authRequiredRouter, _opts, innerDone) => {
    // Apply authentication middleware to all routes in this group
    authRequiredRouter.addHook('onRequest', fastify.authenticate);

    authRequiredRouter.post(
      '/device-token',
      { schema: deviceTokenSchema },
      controller.registerDeviceToken,
    );

    authRequiredRouter.post(
      '/logout-all',
      { schema: logoutAllSchema },
      controller.logoutAll,
    );

    authRequiredRouter.post(
      '/change-password',
      { schema: changePasswordSchema },
      controller.changePassword,
    );

    innerDone();
  });

  done();
}
