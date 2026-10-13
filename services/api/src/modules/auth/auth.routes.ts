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
  deleteDeviceTokenSchema,
  logoutAllSchema,
  changePasswordSchema,
  otpRequestSchema,
  otpVerifySchema,
} from './auth.schemas';
import { PhoneOtpService } from './phone-otp.service';
import { env } from '@/config/env';

export function authRoutes(fastify: FastifyInstance, _opts: unknown, done: (err?: Error) => void): void {
  const repo = new AuthRepository(fastify.prisma);
  const service = new AuthService(repo, fastify);
  const controller = new AuthController(service, new PhoneOtpService(fastify));

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

  // Phone verification (B4). Per-phone limits live in PhoneOtpService; these
  // are per IP (request.ip, which honours TRUST_PROXY).
  fastify.post(
    '/otp/request',
    { schema: otpRequestSchema, config: { rateLimit: { max: 10, timeWindow: 3_600_000 } } },
    controller.requestOtp,
  );

  fastify.post(
    '/otp/verify',
    { schema: otpVerifySchema, config: { rateLimit: { max: 20, timeWindow: 600_000 } } },
    controller.verifyOtp,
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

    authRequiredRouter.delete(
      '/device-token',
      { schema: deleteDeviceTokenSchema },
      controller.unregisterDeviceToken,
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
