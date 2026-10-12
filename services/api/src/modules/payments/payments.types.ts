/**
 * Payment gateways and subscription plans — managed at runtime from the Admin
 * Portal (stored in system_settings under PAYMENT_SETTINGS_KEY).
 *
 * An admin can add any number of gateway entries (e.g. an SSLCommerz store for
 * bKash/Nagad/cards in BDT and a Stripe account for international cards),
 * switch each between sandbox and live, enable/disable it, and edit the plans
 * the app sells. Secrets are encrypted at rest and never returned.
 */

export const PAYMENT_SETTINGS_KEY = 'payment_gateways';
/** Older single-store config written by the seed; migrated on first read. */
export const LEGACY_SSLCOMMERZ_KEY = 'sslcommerz_config';

export type GatewayType = 'sslcommerz' | 'stripe';
export const GATEWAY_TYPES: GatewayType[] = ['sslcommerz', 'stripe'];
export type GatewayMode = 'sandbox' | 'live';

/** Currencies a plan can be priced in (ISO 4217, upper case). */
export const SUPPORTED_CURRENCIES = ['BDT', 'USD', 'EUR', 'GBP', 'INR'] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

export interface SslcommerzCredentials {
  storeId: string;
  storePassword: string;
}
export interface StripeCredentials {
  publishableKey: string;
  secretKey: string;
  webhookSecret: string;
}

/** Stored shape (secrets encrypted with utils/crypto-secret). */
export interface StoredGateway {
  id: string;
  type: GatewayType;
  /** Shown to users in the app, e.g. "bKash / Nagad / Card". */
  displayName: string;
  /** Short subtitle in the app, e.g. "Pay in BDT". */
  description: string;
  enabled: boolean;
  mode: GatewayMode;
  currency: Currency;
  sortOrder: number;
  sslcommerz?: { storeId: string; storePasswordEnc: string };
  stripe?: { publishableKey: string; secretKeyEnc: string; webhookSecretEnc: string };
  createdAt: string;
  updatedAt: string;
}

export interface Plan {
  id: string;
  name: string;
  nameBn: string;
  /** SMS to trusted contacts sent by the server per period. */
  smsQuota: number;
  durationDays: number;
  /** Price per currency; a gateway can sell the plan only if its currency has a price. */
  prices: Partial<Record<Currency, number>>;
  active: boolean;
}

export interface StoredPaymentSettings {
  gateways: StoredGateway[];
  plans: Plan[];
}

/** Safe view for the Admin Portal: secrets replaced by "is set" flags. */
export interface GatewayPublic extends Omit<StoredGateway, 'sslcommerz' | 'stripe'> {
  sslcommerz?: { storeId: string; storePasswordSet: boolean };
  stripe?: { publishableKey: string; secretKeySet: boolean; webhookSecretSet: boolean };
  /** URLs the admin must register at the gateway (Stripe webhook, SSLCommerz IPN). */
  callbackUrls: Record<string, string>;
}

/** Gateway with decrypted secrets — server-side only. */
export interface GatewayWithSecrets extends Omit<StoredGateway, 'sslcommerz' | 'stripe'> {
  sslcommerz?: SslcommerzCredentials;
  stripe?: StripeCredentials;
}

/** Admin create/update payload. Empty or missing secret = keep the saved one. */
export interface GatewayInput {
  type?: GatewayType;
  displayName?: string;
  description?: string;
  enabled?: boolean;
  mode?: GatewayMode;
  currency?: Currency;
  sortOrder?: number;
  sslcommerz?: { storeId?: string; storePassword?: string };
  stripe?: { publishableKey?: string; secretKey?: string; webhookSecret?: string };
}

export const DEFAULT_PLANS: Plan[] = [
  {
    id: 'monthly_50',
    name: 'Monthly Basic',
    nameBn: 'মাসিক বেসিক',
    smsQuota: 12,
    durationDays: 30,
    prices: { BDT: 50, USD: 0.5 },
    active: true,
  },
];

/** What the app sees: enabled gateways and active plans priced for each. */
export interface CheckoutOption {
  gatewayId: string;
  type: GatewayType;
  displayName: string;
  description: string;
  mode: GatewayMode;
  currency: Currency;
}
export interface PlanOption {
  id: string;
  name: string;
  nameBn: string;
  smsQuota: number;
  durationDays: number;
  /** gatewayId → amount in that gateway's currency (only gateways that can sell it). */
  prices: Record<string, { amount: number; currency: Currency }>;
}

/** Result of a gateway checkout start. */
export interface CheckoutStart {
  url: string;
  gatewayRef?: string;
}

/** A verified payment, as confirmed with the gateway (never trusted from the browser). */
export interface VerifiedPayment {
  ok: boolean;
  amount?: number;
  currency?: string;
  gatewayTrxId?: string;
  method?: string;
  reason?: string;
}
