/**
 * Settings Service.
 *
 * Runtime-configurable settings backed by the `system_settings` table.
 * Currently manages the SMS provider configuration (Twilio / BulkSMSBD)
 * so an admin can switch providers and rotate API keys from the portal
 * with no redeploy.
 *
 * Secret fields (auth tokens / API keys) are encrypted at rest with
 * AES-256-GCM (see utils/crypto-secret). Reads for the admin UI mask
 * secrets; reads for the send path decrypt them.
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { env } from '@/config/env';
import { encryptSecret, decryptSecret } from '@/utils/crypto-secret';
import {
  SMS_SETTINGS_KEY,
  SmsConfig,
  SmsConfigPublic,
  SmsConfigUpdate,
  SmsProviderName,
} from './settings.types';

/** Shape actually persisted in the DB (secrets encrypted). */
interface StoredSmsConfig {
  provider: SmsProviderName;
  senderId: string;
  enabled: boolean;
  twilio: { accountSid: string; authTokenEnc: string; fromNumber: string };
  bulksmsbd: { apiKeyEnc: string; senderId: string };
}

function mapEnvProvider(): SmsProviderName {
  switch (env.SMS_PROVIDER) {
    case 'twilio':
      return 'twilio';
    case 'bdbulksms':
      return 'bulksmsbd';
    default:
      return 'mock';
  }
}

/** Fallback config sourced from env when no DB row exists yet. */
function envFallback(): StoredSmsConfig {
  return {
    provider: mapEnvProvider(),
    senderId: env.SMS_SENDER_ID,
    enabled: mapEnvProvider() !== 'mock',
    twilio: {
      accountSid: env.TWILIO_ACCOUNT_SID ?? '',
      // env secrets are stored in plaintext env, wrap so decrypt passes through
      authTokenEnc: env.TWILIO_AUTH_TOKEN ?? env.SMS_API_SECRET ?? '',
      fromNumber: env.TWILIO_FROM_NUMBER ?? '',
    },
    bulksmsbd: {
      apiKeyEnc: env.SMS_API_KEY ?? '',
      senderId: env.SMS_SENDER_ID,
    },
  };
}

export class SettingsService {
  constructor(private readonly db: PrismaClient) {}

  private async readStored(): Promise<StoredSmsConfig> {
    const row = await this.db.systemSetting.findUnique({ where: { key: SMS_SETTINGS_KEY } });
    if (!row) return envFallback();
    const stored = row.value as unknown as Partial<StoredSmsConfig>;
    const fb = envFallback();
    // Defensive merge so a partial/old row never throws.
    return {
      provider: stored.provider ?? fb.provider,
      senderId: stored.senderId ?? fb.senderId,
      enabled: stored.enabled ?? fb.enabled,
      twilio: {
        accountSid: stored.twilio?.accountSid ?? fb.twilio.accountSid,
        authTokenEnc: stored.twilio?.authTokenEnc ?? fb.twilio.authTokenEnc,
        fromNumber: stored.twilio?.fromNumber ?? fb.twilio.fromNumber,
      },
      bulksmsbd: {
        apiKeyEnc: stored.bulksmsbd?.apiKeyEnc ?? fb.bulksmsbd.apiKeyEnc,
        senderId: stored.bulksmsbd?.senderId ?? fb.bulksmsbd.senderId,
      },
    };
  }

  /** Full config with decrypted secrets — for the send path only. */
  async getSmsConfig(): Promise<SmsConfig> {
    const s = await this.readStored();
    return {
      provider: s.provider,
      senderId: s.senderId,
      enabled: s.enabled,
      twilio: {
        accountSid: s.twilio.accountSid,
        authToken: decryptSecret(s.twilio.authTokenEnc),
        fromNumber: s.twilio.fromNumber,
      },
      bulksmsbd: {
        apiKey: decryptSecret(s.bulksmsbd.apiKeyEnc),
        senderId: s.bulksmsbd.senderId,
      },
    };
  }

  /** Masked config for the Admin Portal. */
  async getSmsConfigPublic(): Promise<SmsConfigPublic> {
    const s = await this.readStored();
    return {
      provider: s.provider,
      senderId: s.senderId,
      enabled: s.enabled,
      twilio: {
        accountSid: s.twilio.accountSid,
        fromNumber: s.twilio.fromNumber,
        authTokenSet: decryptSecret(s.twilio.authTokenEnc).length > 0,
      },
      bulksmsbd: {
        senderId: s.bulksmsbd.senderId,
        apiKeySet: decryptSecret(s.bulksmsbd.apiKeyEnc).length > 0,
      },
    };
  }

  /**
   * The auth token used to validate inbound Twilio webhook signatures.
   * Prefers the DB Twilio token, then legacy env SMS_API_SECRET.
   */
  async getWebhookAuthToken(): Promise<string | null> {
    const cfg = await this.getSmsConfig();
    return cfg.twilio.authToken || env.SMS_API_SECRET || null;
  }

  /**
   * Merge a partial update into the stored config. Empty/undefined secret
   * fields leave the existing secret untouched (so the admin never has to
   * re-enter a key just to change the sender ID).
   */
  async updateSmsConfig(update: SmsConfigUpdate, userId?: string): Promise<SmsConfigPublic> {
    const current = await this.readStored();

    const next: StoredSmsConfig = {
      provider: update.provider ?? current.provider,
      senderId: update.senderId ?? current.senderId,
      enabled: update.enabled ?? current.enabled,
      twilio: {
        accountSid: update.twilio?.accountSid ?? current.twilio.accountSid,
        authTokenEnc:
          update.twilio?.authToken && update.twilio.authToken.trim().length > 0
            ? encryptSecret(update.twilio.authToken.trim())
            : current.twilio.authTokenEnc,
        fromNumber: update.twilio?.fromNumber ?? current.twilio.fromNumber,
      },
      bulksmsbd: {
        apiKeyEnc:
          update.bulksmsbd?.apiKey && update.bulksmsbd.apiKey.trim().length > 0
            ? encryptSecret(update.bulksmsbd.apiKey.trim())
            : current.bulksmsbd.apiKeyEnc,
        senderId: update.bulksmsbd?.senderId ?? current.bulksmsbd.senderId,
      },
    };

    await this.db.systemSetting.upsert({
      where: { key: SMS_SETTINGS_KEY },
      create: {
        key: SMS_SETTINGS_KEY,
        value: next as unknown as Prisma.InputJsonValue,
        updatedBy: userId ?? null,
      },
      update: {
        value: next as unknown as Prisma.InputJsonValue,
        updatedBy: userId ?? null,
      },
    });

    return this.getSmsConfigPublic();
  }
}
