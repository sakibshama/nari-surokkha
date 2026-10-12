/**
 * Route-level checks with Fastify inject: the Stripe webhook really receives
 * the raw bytes (signature verification depends on it), SSLCommerz form posts
 * are parsed, and the result page renders.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';

vi.hoisted(() => {
  process.env['CONFIG_ENCRYPTION_KEY'] = 'b'.repeat(64);
  process.env['API_BASE_URL'] = 'https://api.example.org';
});

import Fastify, { FastifyInstance } from 'fastify';
import formbody from '@fastify/formbody';
import sensible from '@fastify/sensible';
import { subscriptionRoutes } from '@/modules/subscriptions/subscription.routes';
import { encryptSecret } from '@/utils/crypto-secret';

const WHSEC = 'whsec_route_test';
let app: FastifyInstance;
const completed: string[] = [];

beforeAll(async () => {
  const payment = { transactionId: 'T1', userId: 'u1', amount: 0.5, currency: 'USD', status: 'pending', planId: 'monthly_50', gatewayId: 'stripe-1' };
  const settings = {
    gateways: [
      {
        id: 'stripe-1', type: 'stripe', displayName: 'Card', description: '', enabled: true, mode: 'sandbox', currency: 'USD', sortOrder: 0,
        stripe: { publishableKey: '', secretKeyEnc: encryptSecret('sk_test_x'), webhookSecretEnc: encryptSecret(WHSEC) },
        createdAt: '', updatedAt: '',
      },
    ],
    plans: [{ id: 'monthly_50', name: 'Monthly', nameBn: '', smsQuota: 12, durationDays: 30, prices: { USD: 0.5 }, active: true }],
  };
  const prisma: any = {
    systemSetting: { findUnique: vi.fn(async ({ where }: any) => (where.key === 'payment_gateways' ? { value: settings } : null)) },
    payment: {
      findUnique: vi.fn(async () => payment),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    $transaction: vi.fn(async () => {
      completed.push('T1');
      return { credited: true };
    }),
  };
  app = Fastify();
  await app.register(sensible);
  await app.register(formbody);
  app.decorate('prisma', prisma);
  app.decorate('authenticate', async () => {});
  await app.register(subscriptionRoutes, { prefix: '/api/v1/subscriptions' });
  await app.ready();
});
afterAll(() => app.close());

describe('payment routes', () => {
  it('Stripe webhook: valid signature over the raw body is accepted and credits once', async () => {
    const body = JSON.stringify({
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_1', client_reference_id: 'T1', payment_status: 'paid', currency: 'usd', amount_total: 50, payment_intent: 'pi_1' } },
    });
    const t = Math.floor(Date.now() / 1000);
    const sig = `t=${t},v1=${crypto.createHmac('sha256', WHSEC).update(`${t}.${body}`).digest('hex')}`;
    const res = await app.inject({ method: 'POST', url: '/api/v1/subscriptions/stripe/webhook/stripe-1', headers: { 'content-type': 'application/json', 'stripe-signature': sig }, payload: body });
    expect(res.statusCode).toBe(200);
    expect(completed).toEqual(['T1']);
  });

  it('Stripe webhook: a bad signature is rejected with 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/subscriptions/stripe/webhook/stripe-1', headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=00' }, payload: '{}' });
    expect(res.statusCode).toBe(400);
  });

  it('SSLCommerz fail redirect is parsed as a form and lands on the result page', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/subscriptions/sslcommerz/fail/x',
      headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'tran_id=T1&status=FAILED',
    });
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('https://api.example.org/api/v1/subscriptions/result?status=failed&trx=T1');
  });

  it('result page escapes its input', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/subscriptions/result?status=success&trx=%3Cscript%3E' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Payment successful');
    expect(res.body).not.toContain('<script>');
  });
});
