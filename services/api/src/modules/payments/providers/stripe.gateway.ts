/**
 * Stripe Checkout via the REST API (no SDK dependency).
 *
 *  - Session:  POST /v1/checkout/sessions          → session.url
 *  - Confirm:  GET  /v1/checkout/sessions/{id}      → payment_status === 'paid'
 *  - Webhook:  checkout.session.completed / async_payment_succeeded / …,
 *              authenticated with the Stripe-Signature header (HMAC-SHA256).
 *
 * As with SSLCommerz, nothing from the browser is trusted: the return URL only
 * triggers a server-side retrieve of the session.
 */

import crypto from 'crypto';
import type { CheckoutStart, StripeCredentials, VerifiedPayment } from '../payments.types';

const API = 'https://api.stripe.com/v1';
type Fetch = typeof fetch;

/** Stripe amounts are in the smallest currency unit. All our currencies use 2 decimals. */
export const toMinor = (amount: number) => Math.round(amount * 100);

function form(params: Record<string, string | number | undefined>): string {
  const b = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') b.append(k, String(v));
  return b.toString();
}

async function call<T>(
  creds: StripeCredentials,
  path: string,
  init: { method?: string; body?: string; idempotencyKey?: string } = {},
  fetchImpl: Fetch = fetch,
): Promise<T> {
  const res = await fetchImpl(`${API}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${creds.secretKey}`,
      ...(init.body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...(init.idempotencyKey ? { 'Idempotency-Key': init.idempotencyKey } : {}),
    },
    body: init.body,
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(json?.error?.message || `Stripe returned HTTP ${res.status}`);
  return json;
}

export interface StripeSession {
  id: string;
  url?: string;
  payment_status?: string;
  status?: string;
  amount_total?: number;
  currency?: string;
  client_reference_id?: string;
  payment_intent?: string | { id: string };
  metadata?: Record<string, string>;
}

export async function stripeCreateSession(
  creds: StripeCredentials,
  input: {
    transactionId: string;
    amount: number;
    currency: string;
    productName: string;
    successUrl: string;
    cancelUrl: string;
    customerEmail?: string;
  },
  fetchImpl: Fetch = fetch,
): Promise<CheckoutStart> {
  const s = await call<StripeSession>(
    creds,
    '/checkout/sessions',
    {
      method: 'POST',
      idempotencyKey: `checkout-${input.transactionId}`,
      body: form({
        mode: 'payment',
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        client_reference_id: input.transactionId,
        'metadata[transactionId]': input.transactionId,
        'payment_intent_data[metadata][transactionId]': input.transactionId,
        'line_items[0][quantity]': 1,
        'line_items[0][price_data][currency]': input.currency.toLowerCase(),
        'line_items[0][price_data][unit_amount]': toMinor(input.amount),
        'line_items[0][price_data][product_data][name]': input.productName,
        customer_email: input.customerEmail,
        // Expire unpaid sessions after 1 h (the Stripe minimum is 30 min).
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      }),
    },
    fetchImpl,
  );
  if (!s.url) throw new Error('Stripe did not return a checkout URL');
  return { url: s.url, gatewayRef: s.id };
}

export async function stripeRetrieveSession(creds: StripeCredentials, id: string, fetchImpl: Fetch = fetch): Promise<StripeSession> {
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(id)) throw new Error('Invalid session id');
  return call<StripeSession>(creds, `/checkout/sessions/${id}`, {}, fetchImpl);
}

/** Decide whether a (retrieved or webhook) session is a completed payment for this transaction. */
export function verifyStripeSession(
  s: StripeSession,
  expected: { transactionId: string; amount: number; currency: string },
): VerifiedPayment {
  if (s.client_reference_id !== expected.transactionId && s.metadata?.transactionId !== expected.transactionId) {
    return { ok: false, reason: 'Transaction id mismatch' };
  }
  if (s.payment_status !== 'paid') return { ok: false, reason: `Payment status ${s.payment_status ?? 'unknown'}` };
  const currency = String(s.currency ?? '').toUpperCase();
  if (currency !== expected.currency.toUpperCase()) return { ok: false, reason: `Currency ${currency} ≠ ${expected.currency}` };
  const amount = (s.amount_total ?? 0) / 100;
  if (toMinor(amount) < toMinor(expected.amount)) return { ok: false, reason: `Amount ${amount} < ${expected.amount}` };
  const pi = typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id;
  return { ok: true, amount, currency, gatewayTrxId: pi || s.id, method: 'card' };
}

/**
 * Verify a Stripe webhook (https://docs.stripe.com/webhooks#verify-manually).
 * Header: "t=<unix>,v1=<hex>[,v1=<hex>…]". Signed payload: "<t>.<raw body>".
 */
export function verifyStripeSignature(
  rawBody: Buffer | string,
  header: string | undefined,
  secret: string,
  toleranceSec = 300,
  nowSec = Math.floor(Date.now() / 1000),
): boolean {
  if (!header || !secret) return false;
  const parts = header.split(',').map((p) => p.trim().split('='));
  const t = Number(parts.find(([k]) => k === 't')?.[1]);
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!Number.isFinite(t) || sigs.length === 0) return false;
  if (Math.abs(nowSec - t) > toleranceSec) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody.toString()}`).digest('hex');
  const exp = Buffer.from(expected, 'hex');
  return sigs.some((s) => {
    const got = Buffer.from(s, 'hex');
    return got.length === exp.length && crypto.timingSafeEqual(got, exp);
  });
}

export async function stripeTest(creds: StripeCredentials, fetchImpl: Fetch = fetch): Promise<{ ok: boolean; message: string }> {
  try {
    const b = await call<{ livemode?: boolean }>(creds, '/balance', {}, fetchImpl);
    return { ok: true, message: `Secret key accepted by Stripe (${b.livemode ? 'live' : 'test'} mode).` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
