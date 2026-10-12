import { FastifyInstance } from 'fastify';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';
import { SubscriptionRepository } from './subscription.repository';
import { PaymentConfigService } from '../payments/payment-config.service';
import { initPaymentSchema, getSubscriptionStatusSchema, paymentStatusSchema } from './subscription.schemas';

/**
 *   GET  /subscriptions/options                     plans + enabled gateways (app)
 *   POST /subscriptions/initiate {planId,gatewayId} → checkout URL
 *   GET  /subscriptions/status                      current subscription
 *   GET  /subscriptions/payments/:transactionId     payment status (app polls)
 *
 *   Gateway callbacks (public, verified server-to-server):
 *   POST /subscriptions/sslcommerz/{success|fail|cancel|ipn}/:gatewayId
 *   GET  /subscriptions/stripe/return/:gatewayId?session_id=
 *   GET  /subscriptions/stripe/cancel/:gatewayId?trx=
 *   POST /subscriptions/stripe/webhook/:gatewayId   (Stripe-Signature, raw body)
 *   GET  /subscriptions/result?status=&trx=         page shown after paying
 */
export function subscriptionRoutes(fastify: FastifyInstance, _opts: unknown, done: (err?: Error) => void): void {
  const repo = new SubscriptionRepository(fastify.prisma);
  const service = new SubscriptionService(repo, new PaymentConfigService(fastify.prisma), fastify);
  const controller = new SubscriptionController(service);

  fastify.register((auth, _o, innerDone) => {
    auth.addHook('onRequest', fastify.authenticate);
    auth.get('/options', controller.getOptions);
    auth.post('/initiate', { schema: initPaymentSchema, config: { rateLimit: { max: 10, timeWindow: 60_000 } } }, controller.initiatePayment);
    auth.get('/status', { schema: getSubscriptionStatusSchema }, controller.getSubscriptionStatus);
    auth.get('/payments/:transactionId', { schema: paymentStatusSchema }, controller.getPaymentStatus);
    innerDone();
  });

  // SSLCommerz posts application/x-www-form-urlencoded (parsed by @fastify/formbody).
  fastify.post('/sslcommerz/success/:gatewayId', controller.sslSuccess);
  fastify.post('/sslcommerz/fail/:gatewayId', controller.sslFail);
  fastify.post('/sslcommerz/cancel/:gatewayId', controller.sslCancel);
  fastify.post('/sslcommerz/ipn/:gatewayId', controller.sslIpn);

  fastify.get('/stripe/return/:gatewayId', controller.stripeReturn);
  fastify.get('/stripe/cancel/:gatewayId', controller.stripeCancel);

  // Stripe signs the exact bytes it sent, so this route needs the raw body.
  fastify.register((raw, _o, innerDone) => {
    raw.removeContentTypeParser('application/json');
    raw.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit: 1024 * 1024 }, (_req, body, cb) => cb(null, body));
    raw.post('/stripe/webhook/:gatewayId', controller.stripeWebhook);
    innerDone();
  });

  fastify.get('/result', controller.resultPage);

  done();
}
