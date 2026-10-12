/**
 * Payments — admin-managed gateways (SSLCommerz, Stripe), plans, and the
 * verification that decides whether a subscription is credited.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

vi.hoisted(() => {
  process.env['CONFIG_ENCRYPTION_KEY'] = 'a'.repeat(64);
  process.env['API_BASE_URL'] = 'https://api.example.org';
});

import { PaymentConfigService, PaymentConfigError } from '@/modules/payments/payment-config.service';
import { verifyStripeSignature, verifyStripeSession, stripeCreateSession } from '@/modules/payments/providers/stripe.gateway';
import { sslcommerzValidate, sslcommerzCreateSession } from '@/modules/payments/providers/sslcommerz.gateway';
import { SubscriptionService } from '@/modules/subscriptions/subscription.service';

/** In-memory system_settings table. */
function settingsDb(initial: Record<string, unknown> = {}) {
  const rows = new Map(Object.entries(initial).map(([k, v]) => [k, { key: k, value: v }]));
  return {
    rows,
    systemSetting: {
      findUnique: vi.fn(async ({ where }: any) => rows.get(where.key) ?? null),
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const row = rows.has(where.key) ? { ...rows.get(where.key)!, ...update } : create;
        rows.set(where.key, row);
        return row;
      }),
    },
  };
}

const jsonResponse = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body }) as unknown as Response;

describe('PaymentConfigService (admin-managed gateways)', () => {
  let db: ReturnType<typeof settingsDb>;
  let svc: PaymentConfigService;
  beforeEach(() => {
    db = settingsDb();
    svc = new PaymentConfigService(db as any);
  });

  it('adds an SSLCommerz gateway, encrypts the password and never returns it', async () => {
    const g = await svc.addGateway({ type: 'sslcommerz', sslcommerz: { storeId: 'store1', storePassword: 'secret!' } });
    const stored = (db.rows.get('payment_gateways')!.value as any).gateways[0];
    expect(stored.sslcommerz.storePasswordEnc).toMatch(/^enc:v1:/);
    expect(JSON.stringify(stored)).not.toContain('secret!');
    expect(g.sslcommerz).toEqual({ storeId: 'store1', storePasswordSet: true });
    expect(JSON.stringify(await svc.getAdminView())).not.toContain('secret!');
    expect(g.callbackUrls.ipn).toBe(`https://api.example.org/api/v1/subscriptions/sslcommerz/ipn/${g.id}`);
    expect((await svc.getGateway(g.id))!.sslcommerz!.storePassword).toBe('secret!');
  });

  it('a blank secret on update keeps the saved one', async () => {
    const g = await svc.addGateway({ type: 'stripe', stripe: { secretKey: 'sk_test_abc', webhookSecret: 'whsec_1' } });
    await svc.updateGateway(g.id, { displayName: 'Cards', stripe: { secretKey: '', webhookSecret: '' } });
    const s = (await svc.getGateway(g.id))!.stripe!;
    expect(s.secretKey).toBe('sk_test_abc');
    expect(s.webhookSecret).toBe('whsec_1');
  });

  it('rejects wrong Stripe key types and sandbox/live mismatches', async () => {
    await expect(svc.addGateway({ type: 'stripe', stripe: { secretKey: 'pk_test_x' } })).rejects.toThrow(PaymentConfigError);
    await expect(svc.addGateway({ type: 'stripe', stripe: { webhookSecret: 'nope' } })).rejects.toThrow(/whsec_/);
    await expect(svc.addGateway({ type: 'stripe', mode: 'live', stripe: { secretKey: 'sk_test_x' } })).rejects.toThrow(/live/);
  });

  it('add form: enabling on add requires complete credentials', async () => {
    await expect(svc.addGateway({ type: 'sslcommerz', enabled: true, sslcommerz: { storeId: 's' } })).rejects.toThrow(/before enabling/);
    const g = await svc.addGateway({
      type: 'sslcommerz', enabled: true, displayName: 'bKash', mode: 'sandbox', currency: 'BDT',
      sslcommerz: { storeId: 'store1', storePassword: 'pw' },
    });
    expect(g.enabled).toBe(true);
    expect(g.displayName).toBe('bKash');
    expect(g.sslcommerz?.storePasswordSet).toBe(true);
  });

  it('cannot enable an incomplete gateway; can once it is complete', async () => {
    const g = await svc.addGateway({ type: 'stripe' });
    await expect(svc.updateGateway(g.id, { enabled: true })).rejects.toThrow(/before enabling/);
    const ok = await svc.updateGateway(g.id, { enabled: true, stripe: { secretKey: 'sk_test_1', webhookSecret: 'whsec_2' } });
    expect(ok.enabled).toBe(true);
  });

  it('app options list only usable gateways and plans priced in their currency', async () => {
    const bdt = await svc.addGateway({ type: 'sslcommerz', enabled: false, sslcommerz: { storeId: 's', storePassword: 'p' } });
    await svc.updateGateway(bdt.id, { enabled: true });
    const usd = await svc.addGateway({ type: 'stripe', currency: 'EUR', stripe: { secretKey: 'sk_test_1', webhookSecret: 'whsec_1' } });
    await svc.updateGateway(usd.id, { enabled: true });
    await svc.addGateway({ type: 'stripe' }); // incomplete + disabled → hidden
    await svc.updatePlans([{ id: 'monthly', name: 'Monthly', smsQuota: 12, durationDays: 30, prices: { BDT: 50 } as any }]);
    const o = await svc.getCheckoutOptions();
    // EUR gateway has no EUR price → hidden; BDT gateway sells the plan.
    expect(o.gateways.map((g) => g.gatewayId)).toEqual([bdt.id]);
    expect(o.plans[0].prices[bdt.id]).toEqual({ amount: 50, currency: 'BDT' });
  });

  it('validates plans', async () => {
    await expect(svc.updatePlans([])).rejects.toThrow(/At least one/);
    await expect(svc.updatePlans([{ id: 'aa', smsQuota: 1, durationDays: 0, prices: {} }])).rejects.toThrow(/duration/);
    await expect(svc.updatePlans([{ id: 'aa', smsQuota: 1, durationDays: 1, prices: { BDT: -5 } as any }])).rejects.toThrow(/positive/);
    await expect(
      svc.updatePlans([
        { id: 'aa', smsQuota: 1, durationDays: 1, prices: {} },
        { id: 'aa', smsQuota: 1, durationDays: 1, prices: {} },
      ]),
    ).rejects.toThrow(/unique/);
  });

  it('migrates the old seeded single-store SSLCommerz config', async () => {
    db = settingsDb({ sslcommerz_config: { store_id: 'testbox', store_passwd: 'qwerty', is_sandbox: true } });
    svc = new PaymentConfigService(db as any);
    const v = await svc.getAdminView();
    expect(v.gateways).toHaveLength(1);
    expect(v.gateways[0]).toMatchObject({ type: 'sslcommerz', mode: 'sandbox', enabled: true, sslcommerz: { storeId: 'testbox', storePasswordSet: true } });
  });
});

describe('Stripe', () => {
  const secret = 'whsec_test123';
  const sign = (body: string, t: number) =>
    `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;

  it('accepts a correctly signed webhook and rejects tampering, wrong secrets and replays', () => {
    const body = JSON.stringify({ type: 'checkout.session.completed' });
    const now = 1_800_000_000;
    expect(verifyStripeSignature(body, sign(body, now), secret, 300, now)).toBe(true);
    expect(verifyStripeSignature(body + ' ', sign(body, now), secret, 300, now)).toBe(false);
    expect(verifyStripeSignature(body, sign(body, now), 'whsec_other', 300, now)).toBe(false);
    expect(verifyStripeSignature(body, sign(body, now - 301), secret, 300, now)).toBe(false);
    expect(verifyStripeSignature(body, undefined, secret)).toBe(false);
  });

  it('credits only a paid session with the right reference, currency and amount', () => {
    const exp = { transactionId: 'T1', amount: 0.5, currency: 'USD' };
    const paid = { id: 'cs_test_1', client_reference_id: 'T1', payment_status: 'paid', currency: 'usd', amount_total: 50, payment_intent: 'pi_1' };
    expect(verifyStripeSession(paid, exp)).toMatchObject({ ok: true, gatewayTrxId: 'pi_1' });
    expect(verifyStripeSession({ ...paid, payment_status: 'unpaid' }, exp).ok).toBe(false);
    expect(verifyStripeSession({ ...paid, client_reference_id: 'T2', metadata: {} }, exp).ok).toBe(false);
    expect(verifyStripeSession({ ...paid, currency: 'eur' }, exp).ok).toBe(false);
    expect(verifyStripeSession({ ...paid, amount_total: 49 }, exp).ok).toBe(false);
  });

  it('creates a Checkout Session with minor units, reference and idempotency key', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: 'cs_test_9', url: 'https://checkout.stripe.com/c/x' }));
    const r = await stripeCreateSession(
      { publishableKey: '', secretKey: 'sk_test_k', webhookSecret: 'whsec' },
      { transactionId: 'T9', amount: 4.99, currency: 'USD', productName: 'Plan', successUrl: 's', cancelUrl: 'c' },
      fetchImpl as any,
    );
    expect(r).toEqual({ url: 'https://checkout.stripe.com/c/x', gatewayRef: 'cs_test_9' });
    const [url, init] = fetchImpl.mock.calls[0] as any;
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(init.headers.Authorization).toBe('Bearer sk_test_k');
    expect(init.headers['Idempotency-Key']).toBe('checkout-T9');
    const p = new URLSearchParams(init.body);
    expect(p.get('line_items[0][price_data][unit_amount]')).toBe('499');
    expect(p.get('line_items[0][price_data][currency]')).toBe('usd');
    expect(p.get('client_reference_id')).toBe('T9');
  });
});

describe('SSLCommerz', () => {
  const creds = { storeId: 'store', storePassword: 'pw' };
  const exp = { transactionId: 'T1', amount: 50, currency: 'BDT' };

  it('validates server-to-server and checks reference, amount and currency', async () => {
    const ok = vi.fn(async () => jsonResponse({ status: 'VALID', tran_id: 'T1', currency_amount: '50.00', currency_type: 'BDT', bank_tran_id: 'B1', card_type: 'BKASH-BKash' }));
    expect(await sslcommerzValidate(creds, 'sandbox', 'val1', exp, ok as any)).toMatchObject({ ok: true, gatewayTrxId: 'B1', method: 'BKASH-BKash' });
    expect(String((ok.mock.calls[0] as any)[0])).toContain('https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php?val_id=val1&store_id=store');
    const cases = [
      { status: 'INVALID_TRANSACTION', tran_id: 'T1', currency_amount: '50', currency_type: 'BDT' },
      { status: 'VALID', tran_id: 'T2', currency_amount: '50', currency_type: 'BDT' },
      { status: 'VALID', tran_id: 'T1', currency_amount: '5', currency_type: 'BDT' },
      { status: 'VALID', tran_id: 'T1', currency_amount: '50', currency_type: 'USD' },
      { status: 'VALID', tran_id: 'T1', currency_amount: '50', currency_type: 'BDT', risk_level: '1' },
    ];
    for (const c of cases) {
      expect((await sslcommerzValidate(creds, 'sandbox', 'v', exp, (async () => jsonResponse(c)) as any)).ok).toBe(false);
    }
    expect((await sslcommerzValidate(creds, 'sandbox', '', exp, ok as any)).ok).toBe(false);
  });

  it('uses the live host in live mode and surfaces the gateway error', async () => {
    const f = vi.fn(async () => jsonResponse({ status: 'FAILED', failedreason: 'Store Credential Error Or Store is De-active' }));
    await expect(
      sslcommerzCreateSession(creds, 'live', {
        transactionId: 'T', amount: 50, currency: 'BDT', productName: 'p', successUrl: 's', failUrl: 'f', cancelUrl: 'c', ipnUrl: 'i',
        customer: { name: 'n', email: 'e@x.org', phone: '017' },
      }, f as any),
    ).rejects.toThrow(/Store Credential Error/);
    expect((f.mock.calls[0] as any)[0]).toBe('https://securepay.sslcommerz.com/gwprocess/v4/api.php');
  });
});

describe('SubscriptionService callbacks (nothing trusted from the browser)', () => {
  const fastify: any = {
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    httpErrors: { badRequest: (m: string) => new Error(m), serviceUnavailable: (m: string) => new Error(m), badGateway: (m: string) => new Error(m), notFound: (m: string) => new Error(m) },
  };
  const payment = { transactionId: 'T1', userId: 'u1', amount: 50, currency: 'BDT', status: 'pending', planId: 'monthly_50', gatewayId: 'g1' };
  const repo: any = {
    getPaymentByTrxId: vi.fn(async () => payment),
    completePayment: vi.fn(async () => ({ credited: true })),
    markClosed: vi.fn(),
  };
  const config: any = {
    getGateway: vi.fn(async () => ({ id: 'g1', type: 'sslcommerz', mode: 'sandbox', enabled: true, sslcommerz: { storeId: 's', storePassword: 'p' } })),
    getPlan: vi.fn(async () => ({ id: 'monthly_50', smsQuota: 12, durationDays: 30 })),
  };
  const svc = new SubscriptionService(repo, config, fastify);

  beforeEach(() => vi.clearAllMocks());

  it('a forged "status: VALID" POST does not credit anything without gateway validation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ status: 'INVALID_TRANSACTION' })));
    const r = await svc.handleSslcommerzPaid({ tran_id: 'T1', val_id: 'forged', status: 'VALID', amount: '50' });
    expect(r.status).toBe('pending');
    expect(repo.completePayment).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('a validated payment credits the plan once', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ status: 'VALID', tran_id: 'T1', currency_amount: '50', currency_type: 'BDT', bank_tran_id: 'B1' })));
    const r = await svc.handleSslcommerzPaid({ tran_id: 'T1', val_id: 'v1' });
    expect(r).toEqual({ status: 'success', transactionId: 'T1' });
    expect(repo.completePayment).toHaveBeenCalledWith('T1', expect.objectContaining({ gatewayTrxId: 'B1' }), expect.objectContaining({ smsQuota: 12, durationDays: 30 }));
    vi.unstubAllGlobals();
  });

  it('a Stripe webhook with a bad signature is rejected', async () => {
    config.getGateway.mockResolvedValueOnce({ id: 'g2', type: 'stripe', stripe: { secretKey: 'sk_test', webhookSecret: 'whsec_x' } });
    expect(await svc.handleStripeWebhook('g2', Buffer.from('{}'), 't=1,v1=00')).toBe(false);
    expect(repo.completePayment).not.toHaveBeenCalled();
  });
});
