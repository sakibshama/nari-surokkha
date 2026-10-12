/**
 * SSLCommerz (Bangladesh: bKash, Nagad, Rocket, cards, net banking).
 *
 * Docs: https://developer.sslcommerz.com/doc/v4/
 *  - Session:    POST {host}/gwprocess/v4/api.php            → GatewayPageURL
 *  - Validation: GET  {host}/validator/api/validationserverAPI.php?val_id=…
 *
 * A payment is NEVER trusted from the browser redirect or the IPN body: the
 * val_id is always re-validated server-to-server with the store credentials,
 * and the amount / currency / tran_id must match what we recorded.
 */

import type { CheckoutStart, SslcommerzCredentials, VerifiedPayment, GatewayMode } from '../payments.types';

export const SSLCOMMERZ_HOST: Record<GatewayMode, string> = {
  sandbox: 'https://sandbox.sslcommerz.com',
  live: 'https://securepay.sslcommerz.com',
};

type Fetch = typeof fetch;

export interface SslcommerzSessionInput {
  transactionId: string;
  amount: number;
  currency: string;
  productName: string;
  successUrl: string;
  failUrl: string;
  cancelUrl: string;
  ipnUrl: string;
  customer: { name: string; email: string; phone: string };
}

export async function sslcommerzCreateSession(
  creds: SslcommerzCredentials,
  mode: GatewayMode,
  input: SslcommerzSessionInput,
  fetchImpl: Fetch = fetch,
): Promise<CheckoutStart> {
  const body = new URLSearchParams({
    store_id: creds.storeId,
    store_passwd: creds.storePassword,
    total_amount: input.amount.toFixed(2),
    currency: input.currency,
    tran_id: input.transactionId,
    success_url: input.successUrl,
    fail_url: input.failUrl,
    cancel_url: input.cancelUrl,
    ipn_url: input.ipnUrl,
    cus_name: input.customer.name || 'Customer',
    cus_email: input.customer.email,
    cus_phone: input.customer.phone || '01700000000',
    cus_add1: 'Dhaka',
    cus_city: 'Dhaka',
    cus_postcode: '1000',
    cus_country: 'Bangladesh',
    shipping_method: 'NO',
    num_of_item: '1',
    product_name: input.productName,
    product_category: 'Subscription',
    product_profile: 'non-physical-goods',
    value_a: input.transactionId,
  });
  const res = await fetchImpl(`${SSLCOMMERZ_HOST[mode]}/gwprocess/v4/api.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => null)) as
    | { status?: string; GatewayPageURL?: string; failedreason?: string; sessionkey?: string }
    | null;
  if (json?.status === 'SUCCESS' && json.GatewayPageURL) {
    return { url: json.GatewayPageURL, gatewayRef: json.sessionkey };
  }
  throw new Error(json?.failedreason || `SSLCommerz returned HTTP ${res.status}`);
}

/** Server-to-server validation of a val_id. */
export async function sslcommerzValidate(
  creds: SslcommerzCredentials,
  mode: GatewayMode,
  valId: string,
  expected: { transactionId: string; amount: number; currency: string },
  fetchImpl: Fetch = fetch,
): Promise<VerifiedPayment> {
  if (!valId) return { ok: false, reason: 'Missing val_id' };
  const qs = new URLSearchParams({
    val_id: valId,
    store_id: creds.storeId,
    store_passwd: creds.storePassword,
    format: 'json',
    v: '1',
  });
  const res = await fetchImpl(`${SSLCOMMERZ_HOST[mode]}/validator/api/validationserverAPI.php?${qs}`, {
    signal: AbortSignal.timeout(15_000),
  });
  const v = (await res.json().catch(() => null)) as Record<string, string> | null;
  if (!v) return { ok: false, reason: `Validation returned HTTP ${res.status}` };
  if (v.status !== 'VALID' && v.status !== 'VALIDATED') return { ok: false, reason: `Gateway status ${v.status ?? 'unknown'}` };
  if (v.tran_id !== expected.transactionId) return { ok: false, reason: 'Transaction id mismatch' };
  // currency_amount/currency_type are in the store currency the session was created with.
  const amount = Number(v.currency_amount ?? v.amount);
  const currency = String(v.currency_type ?? v.currency ?? '').toUpperCase();
  if (currency !== expected.currency.toUpperCase()) return { ok: false, reason: `Currency ${currency} ≠ ${expected.currency}` };
  if (!(amount + 0.005 >= expected.amount)) return { ok: false, reason: `Amount ${amount} < ${expected.amount}` };
  if (v.risk_level === '1') return { ok: false, reason: `Held for risk review: ${v.risk_title ?? ''}`.trim() };
  return { ok: true, amount, currency, gatewayTrxId: v.bank_tran_id || v.val_id, method: v.card_type || v.card_issuer };
}

/** Check credentials by opening (and abandoning) a tiny session. No money moves. */
export async function sslcommerzTest(
  creds: SslcommerzCredentials,
  mode: GatewayMode,
  callbackBase: string,
  fetchImpl: Fetch = fetch,
): Promise<{ ok: boolean; message: string }> {
  try {
    await sslcommerzCreateSession(
      creds,
      mode,
      {
        transactionId: `TEST_${Date.now()}`,
        amount: 10,
        currency: 'BDT',
        productName: 'Connection test',
        successUrl: `${callbackBase}/result?status=test`,
        failUrl: `${callbackBase}/result?status=test`,
        cancelUrl: `${callbackBase}/result?status=test`,
        ipnUrl: `${callbackBase}/result?status=test`,
        customer: { name: 'Test', email: 'test@example.com', phone: '01700000000' },
      },
      fetchImpl,
    );
    return { ok: true, message: `Credentials accepted by SSLCommerz (${mode}).` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
