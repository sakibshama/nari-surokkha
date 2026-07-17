/**
 * Builds the active SMS provider from the runtime SmsConfig.
 * Falls back to the Mock provider when the selected provider is not
 * fully configured, so an SOS never crashes on a missing key.
 */

import { SmsConfig } from '@/modules/settings/settings.types';
import { SmsProvider } from './sms.provider';
import { TwilioSmsProvider } from './twilio-sms.provider';
import { BulkSmsBdProvider } from './bulksmsbd-sms.provider';
import { MockSmsProvider } from './mock-sms.provider';

export function createSmsProvider(config: SmsConfig): SmsProvider {
  switch (config.provider) {
    case 'twilio': {
      const { accountSid, authToken, fromNumber } = config.twilio;
      if (accountSid && authToken && fromNumber) {
        return new TwilioSmsProvider({ accountSid, authToken, fromNumber });
      }
      return new MockSmsProvider();
    }
    case 'bulksmsbd': {
      const { apiKey, senderId } = config.bulksmsbd;
      if (apiKey && senderId) {
        return new BulkSmsBdProvider({ apiKey, senderId });
      }
      return new MockSmsProvider();
    }
    default:
      return new MockSmsProvider();
  }
}
