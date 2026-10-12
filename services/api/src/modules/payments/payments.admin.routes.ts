/**
 * Admin-only payment configuration (mounted at /api/v1/payments).
 *
 *   GET    /admin/config                 gateways (secrets masked) + plans + currencies
 *   POST   /admin/gateways               add an SSLCommerz or Stripe gateway
 *   PUT    /admin/gateways/:id           update (blank secret = keep the saved one)
 *   DELETE /admin/gateways/:id
 *   POST   /admin/gateways/:id/test      check the saved credentials with the gateway
 *   PUT    /admin/plans                  replace the plan list
 *   GET    /admin/transactions?status=&limit=
 */

import { FastifyInstance, FastifyReply } from 'fastify';
import { requireRoles } from '@/middleware/rbac';
import { isEncryptionConfigured } from '@/utils/crypto-secret';
import { PaymentConfigService, PaymentConfigError, apiBaseUrl } from './payment-config.service';
import { GatewayInput, Plan } from './payments.types';
import { sslcommerzTest } from './providers/sslcommerz.gateway';
import { stripeTest } from './providers/stripe.gateway';
import { SubscriptionRepository } from '../subscriptions/subscription.repository';
import { SubscriptionService } from '../subscriptions/subscription.service';

const gatewayBody = {
  type: 'object',
  additionalProperties: false,
  properties: {
    type: { type: 'string', enum: ['sslcommerz', 'stripe'] },
    displayName: { type: 'string', maxLength: 60 },
    description: { type: 'string', maxLength: 120 },
    enabled: { type: 'boolean' },
    mode: { type: 'string', enum: ['sandbox', 'live'] },
    currency: { type: 'string', maxLength: 3 },
    sortOrder: { type: 'integer', minimum: 0, maximum: 100 },
    sslcommerz: {
      type: 'object',
      additionalProperties: false,
      properties: { storeId: { type: 'string', maxLength: 100 }, storePassword: { type: 'string', maxLength: 200 } },
    },
    stripe: {
      type: 'object',
      additionalProperties: false,
      properties: {
        publishableKey: { type: 'string', maxLength: 255 },
        secretKey: { type: 'string', maxLength: 255 },
        webhookSecret: { type: 'string', maxLength: 255 },
      },
    },
  },
};

export function paymentsAdminRoutes(fastify: FastifyInstance, _opts: unknown, done: (err?: Error) => void): void {
  const config = new PaymentConfigService(fastify.prisma);
  const subscriptions = new SubscriptionService(new SubscriptionRepository(fastify.prisma), config, fastify);
  const adminOnly = { onRequest: [fastify.authenticate, requireRoles(['admin', 'superadmin'])] };

  const fail = (reply: FastifyReply, err: unknown) => {
    if (err instanceof PaymentConfigError) return reply.code(400).send({ success: false, error: { message: err.message } });
    if (err instanceof Error && /CONFIG_ENCRYPTION_KEY/.test(err.message)) {
      return reply.code(503).send({ success: false, error: { message: 'Set CONFIG_ENCRYPTION_KEY on the server before saving gateway secrets.' } });
    }
    throw err;
  };

  fastify.get('/admin/config', adminOnly, async (_req, reply) => {
    const data = await config.getAdminView();
    return reply.send({ success: true, data: { ...data, encryptionConfigured: isEncryptionConfigured(), apiBaseUrl: apiBaseUrl() } });
  });

  fastify.post<{ Body: GatewayInput }>('/admin/gateways', { ...adminOnly, schema: { body: { ...gatewayBody, required: ['type'] } } }, async (req, reply) => {
    try {
      const data = await config.addGateway(req.body, req.user?.id);
      req.log.info({ userId: req.user?.id, gateway: data.id, type: data.type }, 'Payment gateway added');
      return reply.code(201).send({ success: true, data });
    } catch (e) {
      return fail(reply, e);
    }
  });

  fastify.put<{ Params: { id: string }; Body: GatewayInput }>('/admin/gateways/:id', { ...adminOnly, schema: { body: gatewayBody } }, async (req, reply) => {
    try {
      const data = await config.updateGateway(req.params.id, req.body, req.user?.id);
      req.log.info({ userId: req.user?.id, gateway: data.id, enabled: data.enabled, mode: data.mode }, 'Payment gateway updated');
      return reply.send({ success: true, data });
    } catch (e) {
      return fail(reply, e);
    }
  });

  fastify.delete<{ Params: { id: string } }>('/admin/gateways/:id', adminOnly, async (req, reply) => {
    try {
      await config.deleteGateway(req.params.id, req.user?.id);
      req.log.info({ userId: req.user?.id, gateway: req.params.id }, 'Payment gateway deleted');
      return reply.send({ success: true });
    } catch (e) {
      return fail(reply, e);
    }
  });

  fastify.post<{ Params: { id: string } }>(
    '/admin/gateways/:id/test',
    { ...adminOnly, config: { rateLimit: { max: 10, timeWindow: 60_000 } } },
    async (req, reply) => {
      const g = await config.getGateway(req.params.id);
      if (!g) return reply.code(404).send({ success: false, error: { message: 'Gateway not found' } });
      const result =
        g.type === 'stripe'
          ? g.stripe?.secretKey
            ? await stripeTest(g.stripe)
            : { ok: false, message: 'No Stripe secret key saved.' }
          : g.sslcommerz?.storeId && g.sslcommerz.storePassword
          ? await sslcommerzTest(g.sslcommerz, g.mode, `${apiBaseUrl()}/api/v1/subscriptions`)
          : { ok: false, message: 'No SSLCommerz store ID / password saved.' };
      return reply.send({ success: result.ok, data: result });
    },
  );

  fastify.put<{ Body: { plans: Partial<Plan>[] } }>('/admin/plans', adminOnly, async (req, reply) => {
    try {
      const plans = await config.updatePlans(req.body?.plans, req.user?.id);
      req.log.info({ userId: req.user?.id, plans: plans.map((p) => p.id) }, 'Subscription plans updated');
      return reply.send({ success: true, data: plans });
    } catch (e) {
      return fail(reply, e);
    }
  });

  fastify.get<{ Querystring: { status?: string; limit?: string } }>('/admin/transactions', adminOnly, async (req, reply) => {
    const status = ['pending', 'success', 'failed', 'cancelled'].includes(String(req.query.status)) ? String(req.query.status) : undefined;
    const data = await subscriptions.listPayments(Number(req.query.limit) || 50, status);
    return reply.send({ success: true, data });
  });

  done();
}
