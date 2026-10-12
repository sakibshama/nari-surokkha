/**
 * Runtime payment configuration (gateways + plans), stored in system_settings.
 * Same pattern as the SMS settings: secrets encrypted at rest with
 * CONFIG_ENCRYPTION_KEY, masked for the Admin Portal, decrypted only for the
 * payment path.
 */

import crypto from 'crypto';
import { PrismaClient, Prisma } from '@prisma/client';
import { env } from '@/config/env';
import { encryptSecret, decryptSecret } from '@/utils/crypto-secret';
import {
  CheckoutOption,
  Currency,
  DEFAULT_PLANS,
  GatewayInput,
  GatewayPublic,
  GatewayWithSecrets,
  GATEWAY_TYPES,
  LEGACY_SSLCOMMERZ_KEY,
  PAYMENT_SETTINGS_KEY,
  Plan,
  PlanOption,
  StoredGateway,
  StoredPaymentSettings,
  SUPPORTED_CURRENCIES,
} from './payments.types';

export class PaymentConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentConfigError';
  }
}

const enc = (v: string) => encryptSecret(v.trim());
const keepOrEncrypt = (incoming: string | undefined, current: string) =>
  incoming !== undefined && incoming.trim().length > 0 ? enc(incoming) : current;

export function apiBaseUrl(): string {
  return env.API_BASE_URL.replace(/\/$/, '');
}

/** URLs each gateway type calls back. */
export function callbackUrlsFor(g: { id: string; type: string }): Record<string, string> {
  const base = `${apiBaseUrl()}/api/v1/subscriptions`;
  if (g.type === 'stripe') {
    return { webhook: `${base}/stripe/webhook/${g.id}` };
  }
  return { ipn: `${base}/sslcommerz/ipn/${g.id}` };
}

function sanitizePlan(p: Partial<Plan>, idx: number): Plan {
  const id = String(p.id ?? '').trim() || `plan_${idx + 1}`;
  if (!/^[a-z0-9_-]{2,40}$/i.test(id)) throw new PaymentConfigError(`Plan id "${id}" must be 2–40 letters, digits, _ or -.`);
  const prices: Partial<Record<Currency, number>> = {};
  for (const c of SUPPORTED_CURRENCIES) {
    const v = (p.prices as Record<string, unknown> | undefined)?.[c];
    if (v === undefined || v === null || v === '') continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0 || n > 1_000_000) throw new PaymentConfigError(`Plan "${id}": ${c} price must be a positive number.`);
    prices[c] = Math.round(n * 100) / 100;
  }
  const smsQuota = Math.trunc(Number(p.smsQuota));
  const durationDays = Math.trunc(Number(p.durationDays));
  if (!Number.isFinite(smsQuota) || smsQuota < 0 || smsQuota > 10_000) throw new PaymentConfigError(`Plan "${id}": SMS quota must be 0–10000.`);
  if (!Number.isFinite(durationDays) || durationDays < 1 || durationDays > 3660) throw new PaymentConfigError(`Plan "${id}": duration must be 1–3660 days.`);
  return {
    id,
    name: String(p.name ?? '').trim().slice(0, 80) || id,
    nameBn: String(p.nameBn ?? '').trim().slice(0, 80),
    smsQuota,
    durationDays,
    prices,
    active: p.active !== false,
  };
}

export class PaymentConfigService {
  constructor(private readonly db: PrismaClient) {}

  // ── storage ──
  async readStored(): Promise<StoredPaymentSettings> {
    const row = await this.db.systemSetting.findUnique({ where: { key: PAYMENT_SETTINGS_KEY } });
    if (row) {
      const v = row.value as unknown as Partial<StoredPaymentSettings>;
      return {
        gateways: Array.isArray(v.gateways) ? v.gateways : [],
        plans: Array.isArray(v.plans) && v.plans.length ? v.plans : DEFAULT_PLANS,
      };
    }
    // First run: bring the old single SSLCommerz store (seeded) across.
    const legacy = await this.db.systemSetting.findUnique({ where: { key: LEGACY_SSLCOMMERZ_KEY } });
    const l = legacy?.value as { store_id?: string; store_passwd?: string; is_sandbox?: boolean } | undefined;
    const gateways: StoredGateway[] = [];
    if (l?.store_id) {
      const now = new Date().toISOString();
      gateways.push({
        id: 'sslcommerz-default',
        type: 'sslcommerz',
        displayName: 'bKash / Nagad / Card',
        description: 'Pay in BDT with SSLCommerz',
        enabled: true,
        mode: l.is_sandbox === false ? 'live' : 'sandbox',
        currency: 'BDT',
        sortOrder: 0,
        // Legacy value is plaintext; decryptSecret passes plaintext through.
        sslcommerz: { storeId: l.store_id, storePasswordEnc: l.store_passwd ?? '' },
        createdAt: now,
        updatedAt: now,
      });
    }
    return { gateways, plans: DEFAULT_PLANS };
  }

  private async write(next: StoredPaymentSettings, userId?: string): Promise<void> {
    const value = next as unknown as Prisma.InputJsonValue;
    await this.db.systemSetting.upsert({
      where: { key: PAYMENT_SETTINGS_KEY },
      create: { key: PAYMENT_SETTINGS_KEY, value, updatedBy: userId ?? null },
      update: { value, updatedBy: userId ?? null },
    });
  }

  // ── views ──
  toPublic(g: StoredGateway): GatewayPublic {
    const { sslcommerz, stripe, ...rest } = g;
    return {
      ...rest,
      ...(sslcommerz && {
        sslcommerz: { storeId: sslcommerz.storeId, storePasswordSet: decryptSecret(sslcommerz.storePasswordEnc).length > 0 },
      }),
      ...(stripe && {
        stripe: {
          publishableKey: stripe.publishableKey,
          secretKeySet: decryptSecret(stripe.secretKeyEnc).length > 0,
          webhookSecretSet: decryptSecret(stripe.webhookSecretEnc).length > 0,
        },
      }),
      callbackUrls: callbackUrlsFor(g),
    };
  }

  withSecrets(g: StoredGateway): GatewayWithSecrets {
    const { sslcommerz, stripe, ...rest } = g;
    return {
      ...rest,
      ...(sslcommerz && {
        sslcommerz: { storeId: sslcommerz.storeId, storePassword: decryptSecret(sslcommerz.storePasswordEnc) },
      }),
      ...(stripe && {
        stripe: {
          publishableKey: stripe.publishableKey,
          secretKey: decryptSecret(stripe.secretKeyEnc),
          webhookSecret: decryptSecret(stripe.webhookSecretEnc),
        },
      }),
    };
  }

  async getAdminView(): Promise<{ gateways: GatewayPublic[]; plans: Plan[]; currencies: readonly string[] }> {
    const s = await this.readStored();
    return {
      gateways: [...s.gateways].sort((a, b) => a.sortOrder - b.sortOrder).map((g) => this.toPublic(g)),
      plans: s.plans,
      currencies: SUPPORTED_CURRENCIES,
    };
  }

  async getGateway(id: string): Promise<GatewayWithSecrets | null> {
    const s = await this.readStored();
    const g = s.gateways.find((x) => x.id === id);
    return g ? this.withSecrets(g) : null;
  }

  async getPlan(id: string): Promise<Plan | null> {
    const s = await this.readStored();
    return s.plans.find((p) => p.id === id) ?? null;
  }

  /** Is this gateway complete enough to take payments? */
  isUsable(g: GatewayWithSecrets): boolean {
    if (!g.enabled) return false;
    if (g.type === 'sslcommerz') return !!(g.sslcommerz?.storeId && g.sslcommerz.storePassword);
    if (g.type === 'stripe') return !!(g.stripe?.secretKey && g.stripe.webhookSecret);
    return false;
  }

  /** Options for the app: usable gateways and active plans with a price in each gateway's currency. */
  async getCheckoutOptions(): Promise<{ gateways: CheckoutOption[]; plans: PlanOption[] }> {
    const s = await this.readStored();
    const gateways = s.gateways
      .map((g) => this.withSecrets(g))
      .filter((g) => this.isUsable(g))
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const plans: PlanOption[] = s.plans
      .filter((p) => p.active)
      .map((p) => {
        const prices: PlanOption['prices'] = {};
        for (const g of gateways) {
          const amount = p.prices[g.currency];
          if (amount) prices[g.id] = { amount, currency: g.currency };
        }
        return { id: p.id, name: p.name, nameBn: p.nameBn, smsQuota: p.smsQuota, durationDays: p.durationDays, prices };
      })
      .filter((p) => Object.keys(p.prices).length > 0);
    return {
      gateways: gateways
        .filter((g) => plans.some((p) => p.prices[g.id]))
        .map((g) => ({
          gatewayId: g.id,
          type: g.type,
          displayName: g.displayName,
          description: g.description,
          mode: g.mode,
          currency: g.currency,
        })),
      plans,
    };
  }

  // ── admin mutations ──
  private validate(g: StoredGateway): void {
    if (!GATEWAY_TYPES.includes(g.type)) throw new PaymentConfigError('type must be sslcommerz or stripe');
    if (!SUPPORTED_CURRENCIES.includes(g.currency)) throw new PaymentConfigError(`currency must be one of ${SUPPORTED_CURRENCIES.join(', ')}`);
    if (g.mode !== 'sandbox' && g.mode !== 'live') throw new PaymentConfigError('mode must be sandbox or live');
    if (!g.displayName.trim()) throw new PaymentConfigError('displayName is required');
    if (g.type === 'stripe' && g.stripe) {
      const pk = g.stripe.publishableKey;
      if (pk && !/^pk_(test|live)_/.test(pk)) throw new PaymentConfigError('Stripe publishable key must start with pk_test_ or pk_live_');
      if (pk && g.mode === 'live' && pk.startsWith('pk_test_')) throw new PaymentConfigError('Live mode needs a pk_live_ key');
      if (pk && g.mode === 'sandbox' && pk.startsWith('pk_live_')) throw new PaymentConfigError('Sandbox mode needs a pk_test_ key');
    }
  }

  private applyInput(base: StoredGateway, input: GatewayInput): StoredGateway {
    const next: StoredGateway = {
      ...base,
      displayName: input.displayName !== undefined ? String(input.displayName).trim().slice(0, 60) : base.displayName,
      description: input.description !== undefined ? String(input.description).trim().slice(0, 120) : base.description,
      enabled: input.enabled ?? base.enabled,
      mode: input.mode ?? base.mode,
      currency: (input.currency ? String(input.currency).toUpperCase() : base.currency) as Currency,
      sortOrder: input.sortOrder !== undefined ? Math.trunc(Number(input.sortOrder)) || 0 : base.sortOrder,
      updatedAt: new Date().toISOString(),
    };
    if (base.type === 'sslcommerz') {
      const cur = base.sslcommerz ?? { storeId: '', storePasswordEnc: '' };
      next.sslcommerz = {
        storeId: input.sslcommerz?.storeId !== undefined ? String(input.sslcommerz.storeId).trim() : cur.storeId,
        storePasswordEnc: keepOrEncrypt(input.sslcommerz?.storePassword, cur.storePasswordEnc),
      };
    } else {
      const cur = base.stripe ?? { publishableKey: '', secretKeyEnc: '', webhookSecretEnc: '' };
      const sk = input.stripe?.secretKey?.trim();
      if (sk && !/^(sk|rk)_(test|live)_/.test(sk)) throw new PaymentConfigError('Stripe secret key must start with sk_test_, sk_live_, rk_test_ or rk_live_');
      const wh = input.stripe?.webhookSecret?.trim();
      if (wh && !wh.startsWith('whsec_')) throw new PaymentConfigError('Stripe webhook signing secret must start with whsec_');
      next.stripe = {
        publishableKey: input.stripe?.publishableKey !== undefined ? String(input.stripe.publishableKey).trim() : cur.publishableKey,
        secretKeyEnc: keepOrEncrypt(sk, cur.secretKeyEnc),
        webhookSecretEnc: keepOrEncrypt(wh, cur.webhookSecretEnc),
      };
      if (sk && next.mode === 'live' && sk.includes('_test_')) throw new PaymentConfigError('Live mode needs a live secret key');
      if (sk && next.mode === 'sandbox' && sk.includes('_live_')) throw new PaymentConfigError('Sandbox mode needs a test secret key');
    }
    this.validate(next);
    return next;
  }

  async addGateway(input: GatewayInput, userId?: string): Promise<GatewayPublic> {
    if (!input.type || !GATEWAY_TYPES.includes(input.type)) throw new PaymentConfigError('type must be sslcommerz or stripe');
    const s = await this.readStored();
    if (s.gateways.length >= 20) throw new PaymentConfigError('At most 20 gateways can be configured.');
    const now = new Date().toISOString();
    const base: StoredGateway = {
      id: `${input.type}-${crypto.randomBytes(4).toString('hex')}`,
      type: input.type,
      displayName: input.type === 'stripe' ? 'International card' : 'bKash / Nagad / Card',
      description: input.type === 'stripe' ? 'Visa, Mastercard, Amex via Stripe' : 'Pay in BDT with SSLCommerz',
      enabled: false,
      mode: 'sandbox',
      currency: input.type === 'stripe' ? 'USD' : 'BDT',
      sortOrder: s.gateways.length,
      createdAt: now,
      updatedAt: now,
    };
    const g = this.applyInput(base, input);
    if (g.enabled && !this.isUsable(this.withSecrets(g))) {
      throw new PaymentConfigError(
        g.type === 'stripe'
          ? 'Enter the Stripe secret key and webhook signing secret before enabling.'
          : 'Enter the SSLCommerz store ID and store password before enabling.',
      );
    }
    await this.write({ ...s, gateways: [...s.gateways, g] }, userId);
    return this.toPublic(g);
  }

  async updateGateway(id: string, input: GatewayInput, userId?: string): Promise<GatewayPublic> {
    const s = await this.readStored();
    const idx = s.gateways.findIndex((g) => g.id === id);
    if (idx < 0) throw new PaymentConfigError('Gateway not found');
    if (input.type && input.type !== s.gateways[idx].type) throw new PaymentConfigError('A gateway\'s type cannot be changed; add a new one.');
    const g = this.applyInput(s.gateways[idx], input);
    // A gateway can only be switched on once it is complete.
    if (g.enabled && !this.isUsable(this.withSecrets(g))) {
      throw new PaymentConfigError(
        g.type === 'stripe'
          ? 'Enter the Stripe secret key and webhook signing secret before enabling.'
          : 'Enter the SSLCommerz store ID and store password before enabling.',
      );
    }
    const gateways = [...s.gateways];
    gateways[idx] = g;
    await this.write({ ...s, gateways }, userId);
    return this.toPublic(g);
  }

  async deleteGateway(id: string, userId?: string): Promise<void> {
    const s = await this.readStored();
    if (!s.gateways.some((g) => g.id === id)) throw new PaymentConfigError('Gateway not found');
    await this.write({ ...s, gateways: s.gateways.filter((g) => g.id !== id) }, userId);
  }

  async updatePlans(plans: Partial<Plan>[], userId?: string): Promise<Plan[]> {
    if (!Array.isArray(plans) || plans.length === 0) throw new PaymentConfigError('At least one plan is required.');
    if (plans.length > 20) throw new PaymentConfigError('At most 20 plans.');
    const clean = plans.map(sanitizePlan);
    const ids = new Set(clean.map((p) => p.id));
    if (ids.size !== clean.length) throw new PaymentConfigError('Plan ids must be unique.');
    const s = await this.readStored();
    await this.write({ ...s, plans: clean }, userId);
    return clean;
  }
}
