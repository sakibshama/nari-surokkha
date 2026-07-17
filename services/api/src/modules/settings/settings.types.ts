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
