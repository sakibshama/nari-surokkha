/**
 * Mock SMS provider for local development / unconfigured environments.
 * Logs to console and reports success so the notification pipeline can be
 * exercised end-to-end without a real gateway.
 */

import { SmsProvider, SmsSendResult } from './sms.provider';

export class MockSmsProvider implements SmsProvider {
  readonly name = 'mock';

  async sendSms(to: string, message: string): Promise<SmsSendResult> {
    // eslint-disable-next-line no-console
    console.log(
      `[MOCK SMS] → ${to.slice(0, 6)}…  "${message.slice(0, 60)}${message.length > 60 ? '…' : ''}"`,
    );
    return { success: true, messageId: `mock-sms-${Date.now()}` };
  }
}
