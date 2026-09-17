/**
 * Shared types for runtime system settings.
 */

export type SmsProviderName = 'mock' | 'twilio' | 'bulksmsbd';

/** Full SMS config with decrypted secrets — server-side use only. */
export interface SmsConfig {
  provider: SmsProviderName;
  senderId: string;
  /** Whether outbound SMS to trusted contacts is enabled on SOS. */
  enabled: boolean;
  twilio: {
    accountSid: string;
    authToken: string;
    fromNumber: string;
  };
  bulksmsbd: {
    apiKey: string;
    senderId: string;
  };
}

/**
 * Safe representation returned to the Admin Portal. Secrets are never
 * sent back — instead a boolean flags whether each secret is set.
 */
export interface SmsConfigPublic {
  provider: SmsProviderName;
  senderId: string;
  enabled: boolean;
  twilio: {
    accountSid: string;
    fromNumber: string;
    authTokenSet: boolean;
  };
  bulksmsbd: {
    senderId: string;
    apiKeySet: boolean;
  };
}

/** Partial update payload from the admin UI. Empty secret = keep existing. */
export interface SmsConfigUpdate {
  provider?: SmsProviderName;
  senderId?: string;
  enabled?: boolean;
  twilio?: {
    accountSid?: string;
    authToken?: string;
    fromNumber?: string;
  };
  bulksmsbd?: {
    apiKey?: string;
    senderId?: string;
  };
}

export const SMS_SETTINGS_KEY = 'sms';

// ─── SOS SMS message template ────────────────────────────────
// Admin-editable text sent to trusted contacts when an SOS fires. Supports the
// placeholders below; unknown placeholders are left as-is.
export const SMS_TEMPLATE_KEY = 'sms_template';

export const SMS_TEMPLATE_DEFAULT =
  'EMERGENCY: {name} has triggered an SOS alert via Nari Surokkha. Live location: {mapLink} — Track: {trackLink}';

/** The variables an admin may use in the SMS template. */
export const SMS_TEMPLATE_PLACEHOLDERS = ['{name}', '{mapLink}', '{trackLink}', '{lat}', '{lng}'] as const;

/** Render an SMS template by substituting {placeholders} with real values. */
export function renderSmsTemplate(template: string, vars: Record<string, string>): string {
  return (template || SMS_TEMPLATE_DEFAULT).replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match,
  );
}
