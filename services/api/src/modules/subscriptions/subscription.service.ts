/**
 * Subscriptions & payments.
 *
 * Gateways and plans come from the Admin Portal (PaymentConfigService), so an
 * admin can add/rotate SSLCommerz and Stripe accounts without a deploy.
 *
 * Flow:
 *   app  → POST /subscriptions/initiate {planId, gatewayId}
 *        ← { url, transactionId }      (payment row 'pending')
 *   user pays in the browser
 *   gateway → browser redirect / IPN / webhook  → we VERIFY with the gateway
 *        (server-to-server) → completePayment() credits the subscription once
 *   browser → /subscriptions/result page → "return to the app"
 *   app  → GET /subscriptions/payments/:transactionId  (poll) + /status
 */

import { FastifyInstance } from 'fastify';
import { SubscriptionRepository } from './subscription.repository';
import { PaymentConfigService, apiBaseUrl } from '../payments/payment-config.service';
import type { GatewayWithSecrets, VerifiedPayment } from '../payments/payments.types';
import { sslcommerzCreateSession, sslcommerzValidate } from '../payments/providers/sslcommerz.gateway';
import {
  stripeCreateSession,
  stripeRetrieveSession,
  verifyStripeSession,
  verifyStripeSignature,
  StripeSession,
} from '../payments/providers/stripe.gateway';

export type ResultStatus = 'success' | 'failed' | 'cancelled' | 'pending';

export class SubscriptionService {
  constructor(
    private readonly repo: SubscriptionRepository,
    private readonly config: PaymentConfigService,
    private readonly fastify: FastifyInstance,
  ) {}

  private get base() {
    return `${apiBaseUrl()}/api/v1/subscriptions`;
  }

  resultUrl(status: ResultStatus, transactionId?: string) {
    const q = new URLSearchParams({ status, ...(transactionId ? { trx: transactionId } : {}) });
    return `${this.base}/result?${q}`;
  }

  getOptions() {
    return this.config.getCheckoutOptions();
  }

  async initiatePayment(userId: string, planId: string, gatewayId?: string) {
    const options = await this.config.getCheckoutOptions();
    if (options.gateways.length === 0) {
      throw this.fastify.httpErrors.serviceUnavailable('Payments are not available yet: no payment gateway is enabled.');
    }
    // Older app builds send only planId: use the first gateway that sells it.
    const plan = options.plans.find((p) => p.id === planId);
    if (!plan) throw this.fastify.httpErrors.badRequest('Unknown or inactive plan.');
    const gid = gatewayId ?? options.gateways.find((g) => plan.prices[g.gatewayId])?.gatewayId;
    const price = gid ? plan.prices[gid] : undefined;
    const gateway = gid ? await this.config.getGateway(gid) : null;
    if (!gateway || !price || !this.config.isUsable(gateway)) {
      throw this.fastify.httpErrors.badRequest('This payment method is not available for the selected plan.');
    }

    const transactionId = `NS${Date.now().toString(36).toUpperCase()}${userId.replace(/-/g, '').slice(0, 6).toUpperCase()}`;
    await this.repo.createPayment({
      userId,
      amount: price.amount,
      currency: price.currency,
      transactionId,
      planId: plan.id,
      gatewayId: gateway.id,
      gatewayType: gateway.type,
    });

    const user = await this.repo.getUserContact(userId);
    const productName = `Nari Surokkha — ${plan.name}`;
    try {
      const start =
        gateway.type === 'stripe'
          ? await stripeCreateSession(gateway.stripe!, {
              transactionId,
              amount: price.amount,
              currency: price.currency,
              productName,
              successUrl: `${this.base}/stripe/return/${gateway.id}?session_id={CHECKOUT_SESSION_ID}`,
              cancelUrl: `${this.base}/stripe/cancel/${gateway.id}?trx=${transactionId}`,
              customerEmail: user?.email ?? undefined,
            })
          : await sslcommerzCreateSession(gateway.sslcommerz!, gateway.mode, {
              transactionId,
              amount: price.amount,
              currency: price.currency,
              productName,
              successUrl: `${this.base}/sslcommerz/success/${gateway.id}`,
              failUrl: `${this.base}/sslcommerz/fail/${gateway.id}`,
              cancelUrl: `${this.base}/sslcommerz/cancel/${gateway.id}`,
              ipnUrl: `${this.base}/sslcommerz/ipn/${gateway.id}`,
              customer: {
                name: user?.profile?.fullName ?? 'Customer',
                email: user?.email || `${(user?.phone ?? 'user').replace(/\D/g, '')}@users.narisurokkha.app`,
                phone: user?.phone ?? '',
              },
            });
      await this.repo.setGatewaySession(transactionId, start.gatewayRef);
      return { url: start.url, transactionId, gatewayType: gateway.type };
    } catch (err) {
      this.fastify.log.error({ err, transactionId, gateway: gateway.id }, 'Payment gateway session failed');
      await this.repo.markClosed(transactionId, 'failed', (err as Error).message);
      throw this.fastify.httpErrors.badGateway(`Could not start the payment: ${(err as Error).message}`);
    }
  }

  /** Load the pending payment and the gateway that was used for it (from the DB, not the URL). */
  private async loadPayment(transactionId: string) {
    const payment = transactionId ? await this.repo.getPaymentByTrxId(transactionId) : null;
    if (!payment) return null;
    const gateway = payment.gatewayId ? await this.config.getGateway(payment.gatewayId) : null;
    return { payment, gateway };
  }

  private async complete(transactionId: string, planId: string | null, v: VerifiedPayment): Promise<ResultStatus> {
    const plan = planId ? await this.config.getPlan(planId) : null;
    if (!plan) {
      this.fastify.log.error({ transactionId, planId }, 'Paid for a plan that no longer exists — crediting 30 days / 0 SMS; check manually');
    }
    const { credited } = await this.repo.completePayment(
      transactionId,
      { gatewayTrxId: v.gatewayTrxId, method: v.method },
      plan ?? { id: planId ?? 'unknown', smsQuota: 0, durationDays: 30 },
    );
    this.fastify.log.info({ transactionId, credited }, 'Payment verified');
    return 'success';
  }

  // ── SSLCommerz ──
  /** success / ipn: validate val_id with SSLCommerz, then credit. */
  async handleSslcommerzPaid(body: Record<string, string> | undefined): Promise<{ status: ResultStatus; transactionId?: string }> {
    const transactionId = String(body?.tran_id ?? '');
    const loaded = await this.loadPayment(transactionId);
    if (!loaded) return { status: 'failed' };
    const { payment, gateway } = loaded;
    if (payment.status === 'success') return { status: 'success', transactionId };
    if (!gateway?.sslcommerz || gateway.type !== 'sslcommerz') {
      this.fastify.log.error({ transactionId }, 'SSLCommerz callback for a payment without an SSLCommerz gateway');
      return { status: 'failed', transactionId };
    }
    const v = await sslcommerzValidate(gateway.sslcommerz, gateway.mode, String(body?.val_id ?? ''), {
      transactionId,
      amount: Number(payment.amount),
      currency: payment.currency,
    }).catch((e) => ({ ok: false, reason: (e as Error).message }) as VerifiedPayment);
    if (!v.ok) {
      this.fastify.log.warn({ transactionId, reason: v.reason }, 'SSLCommerz payment did not validate');
      // A transient validator error must not fail a payment the IPN may still confirm.
      return { status: 'pending', transactionId };
    }
    return { status: await this.complete(transactionId, payment.planId, v), transactionId };
  }

  async handleSslcommerzClosed(body: Record<string, string> | undefined, status: 'failed' | 'cancelled') {
    const transactionId = String(body?.tran_id ?? '');
    if (transactionId) await this.repo.markClosed(transactionId, status, body?.error);
    return { status: status as ResultStatus, transactionId };
  }

  // ── Stripe ──
  private async completeStripe(gateway: GatewayWithSecrets, session: StripeSession): Promise<{ status: ResultStatus; transactionId?: string }> {
    const transactionId = session.client_reference_id || session.metadata?.transactionId || '';
    const loaded = await this.loadPayment(transactionId);
    if (!loaded) return { status: 'failed' };
    const { payment } = loaded;
    if (payment.gatewayId !== gateway.id) return { status: 'failed', transactionId };
    if (payment.status === 'success') return { status: 'success', transactionId };
    const v = verifyStripeSession(session, { transactionId, amount: Number(payment.amount), currency: payment.currency });
    if (!v.ok) {
      this.fastify.log.warn({ transactionId, reason: v.reason }, 'Stripe session not paid / mismatched');
      return { status: 'pending', transactionId };
    }
    return { status: await this.complete(transactionId, payment.planId, v), transactionId };
  }

  /** Browser came back from Stripe: retrieve the session server-side (never trust the URL). */
  async handleStripeReturn(gatewayId: string, sessionId: string) {
    const gateway = await this.config.getGateway(gatewayId);
    if (!gateway?.stripe || gateway.type !== 'stripe') return { status: 'failed' as ResultStatus };
    try {
      const session = await stripeRetrieveSession(gateway.stripe, sessionId);
      return this.completeStripe(gateway, session);
    } catch (err) {
      this.fastify.log.warn({ err, gatewayId }, 'Stripe session retrieve failed');
      return { status: 'pending' as ResultStatus };
    }
  }

  async handleStripeCancel(transactionId: string) {
    if (transactionId) await this.repo.markClosed(transactionId, 'cancelled');
    return { status: 'cancelled' as ResultStatus, transactionId };
  }

  /** Verified webhook. Returns false if the signature is bad (→ 400). */
  async handleStripeWebhook(gatewayId: string, rawBody: Buffer, signature: string | undefined): Promise<boolean> {
    const gateway = await this.config.getGateway(gatewayId);
    if (!gateway?.stripe || gateway.type !== 'stripe') return false;
    if (!verifyStripeSignature(rawBody, signature, gateway.stripe.webhookSecret)) return false;
    const event = JSON.parse(rawBody.toString('utf8')) as { type?: string; data?: { object?: StripeSession } };
    const session = event.data?.object;
    if (!session) return true;
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        await this.completeStripe(gateway, session);
        break;
      case 'checkout.session.expired':
      case 'checkout.session.async_payment_failed': {
        const trx = session.client_reference_id || session.metadata?.transactionId;
        if (trx) await this.repo.markClosed(trx, event.type.endsWith('expired') ? 'cancelled' : 'failed', event.type);
        break;
      }
      default:
        break; // acknowledged, ignored
    }
    return true;
  }

  // ── app ──
  async getSubscriptionStatus(userId: string) {
    const sub = await this.repo.getSubscriptionByUserId(userId);
    if (!sub) return null;
    const expired = sub.status === 'active' && sub.endDate <= new Date();
    const plan = await this.config.getPlan(sub.planId);
    return {
      ...sub,
      status: expired ? 'expired' : sub.status,
      planName: plan?.name ?? sub.planId,
      planNameBn: plan?.nameBn ?? '',
    };
  }

  async getPaymentStatus(userId: string, transactionId: string) {
    const p = await this.repo.getPaymentByTrxId(transactionId);
    if (!p || p.userId !== userId) throw this.fastify.httpErrors.notFound('Payment not found');
    return { transactionId, status: p.status, amount: Number(p.amount), currency: p.currency, planId: p.planId };
  }

  async listPayments(limit = 50, status?: string) {
    const rows = await this.repo.listPayments(limit, status);
    return rows.map((r: any) => ({
      transactionId: r.transactionId,
      status: r.status,
      amount: Number(r.amount),
      currency: r.currency,
      planId: r.planId,
      gatewayId: r.gatewayId,
      gatewayType: r.gatewayType,
      gatewayTrxId: r.gatewayTrxId,
      paymentMethod: r.paymentMethod,
      failureReason: r.failureReason,
      createdAt: r.createdAt,
      user: { phone: r.user?.phone, name: r.user?.profile?.fullName },
    }));
  }
}
