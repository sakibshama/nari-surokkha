/**
 * Alerts Routes
 */

import { FastifyInstance } from 'fastify';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { AlertsRepository } from './alerts.repository';
import { ContactsRepository } from '../contacts/contacts.repository';
import { ResponderRepository } from '../responder/responder.repository';
import {
  createSosSchema,
  updateLocationSchema,
  createSoftAlertSchema,
  cancelSoftAlertSchema,
  confirmSoftAlertSchema,
  cancelSosAlertSchema,
  resolveAlertSchema,
  alertStatusSchema,
  safeRouteSchema,
  routeLocationSchema,
  smsFallbackSchema,
} from './alerts.schemas';
import { env } from '@/config/env';
import { isValidTwilioSignature } from '@/utils/twilio-signature';
import { canAccessAlert } from '@/utils/alert-access';
import { ForbiddenError } from '@/utils/errors';

export function alertsRoutes(
  fastify: FastifyInstance,
  _opts: unknown,
  done: (err?: Error) => void,
): void {
  const repo = new AlertsRepository(fastify.prisma, fastify.log);
  const contactsRepo = new ContactsRepository(fastify.prisma);
  const responderRepo = new ResponderRepository(fastify.prisma);
  const service = new AlertsService(repo, contactsRepo, responderRepo, fastify);
  const controller = new AlertsController(service);

  // ─── Public Webhooks ────────────────────────────────────────
  // Public (no JWT) but cryptographically verified: every request must carry a
  // valid Twilio signature, otherwise it's a spoofed callback and is rejected.
  fastify.post(
    '/sms-webhook',
    {
      preHandler: async (request, reply) => {
        // Prefer the runtime Twilio auth token configured from the Admin
        // Portal; fall back to the legacy env SMS_API_SECRET.
        const authToken = (await fastify.settings.getWebhookAuthToken()) ?? env.SMS_API_SECRET;
        // Fail closed: if no auth token is configured, the webhook cannot be
        // trusted, so we refuse rather than accept unverified requests.
        if (!authToken) {
          request.log.error('SMS webhook rejected: no Twilio auth token configured (Admin Portal or SMS_API_SECRET)');
          return reply.code(503).send({ error: 'Webhook not configured' });
        }
        const signature = request.headers['x-twilio-signature'] as string | undefined;
        const url = `${env.API_BASE_URL}${request.raw.url ?? '/api/v1/alerts/sms-webhook'}`;
        const params = (request.body ?? {}) as Record<string, unknown>;
        if (!isValidTwilioSignature(authToken, signature, url, params)) {
          request.log.warn('SMS webhook rejected: invalid Twilio signature');
          return reply.code(403).send({ error: 'Invalid signature' });
        }
      },
    },
    controller.receiveSmsWebhook,
  );

  // ─── Authenticated Routes ───────────────────────────────────

  fastify.register((authRequiredRouter, _opts, innerDone) => {
    // Require authentication for all alert routes
    authRequiredRouter.addHook('onRequest', fastify.authenticate);

    authRequiredRouter.post(
      '/sos',
      {
        schema: createSosSchema,
        config: {
          rateLimit: {
            max: 5,           // Allow 5 SOS triggers per window (easier for testing)
            timeWindow: 60000 // per 1 minute
          }
        }
      },
      controller.createSosAlert,
    );

    authRequiredRouter.post(
      '/:id/location',
      { schema: updateLocationSchema },
      controller.updateLocation,
    );


    authRequiredRouter.patch(
      '/:id/cancel',
      { schema: cancelSosAlertSchema },
      controller.cancelSosAlert,
    );

    authRequiredRouter.get<{ Params: { id: string } }>('/:id/status', { schema: alertStatusSchema }, async (req, reply) => {
      const user = { id: req.user!.id, role: req.user!.role };
      if (!(await canAccessAlert(fastify.prisma, req.params.id, user))) {
        throw new ForbiddenError('Alert not found');
      }
      const alert = await fastify.prisma.emergencyAlert.findUnique({
        where: { id: req.params.id },
        select: { id: true, status: true, createdAt: true },
      });
      if (!alert) throw new ForbiddenError('Alert not found');
      return reply.send({ success: true, data: alert });
    });

    // "I'm safe now" — the owner ends their own alert.
    authRequiredRouter.post('/:id/resolve', { schema: resolveAlertSchema }, controller.resolveAlert);

    authRequiredRouter.post('/soft', { schema: createSoftAlertSchema }, controller.createSoftAlert);
    authRequiredRouter.patch('/:id/soft/cancel', { schema: cancelSoftAlertSchema }, controller.cancelSoftAlert);
    authRequiredRouter.patch('/:id/soft/confirm', { schema: confirmSoftAlertSchema }, controller.confirmSoftAlert);

    authRequiredRouter.post(
      '/:id/sms-fallback',
      { schema: smsFallbackSchema, config: { rateLimit: { max: 3, timeWindow: 60000 } } },
      controller.requestServerSms,
    );

    authRequiredRouter.post('/safe-route', { schema: safeRouteSchema }, controller.getSafeRoute);
    authRequiredRouter.post('/safe-route/:id/location', { schema: routeLocationSchema }, controller.updateRouteLocation);

    innerDone();
  });

  done();
}
