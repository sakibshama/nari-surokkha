/**
 * BulkSMSBD provider (bulksmsbd.net OneAPI).
 *
 * A popular Bangladeshi SMS gateway. Sends via a single HTTP call with
 * api_key + senderid. A response_code of 202 means "SMS submitted
 * successfully"; anything else is treated as a failure.
 *
 * Docs: https://bulksmsbd.net/  (OneAPI / smsapi)
 */

import { SmsProvider, SmsSendResult } from './sms.provider';

export interface BulkSmsBdOptions {
  apiKey: string;
  senderId: string;
  endpoint?: string; // override for testing
}

const SUCCESS_CODE = 202;

export class BulkSmsBdProvider implements SmsProvider {
  readonly name = 'bulksmsbd';

  constructor(private readonly opts: BulkSmsBdOptions) {}

  /** BulkSMSBD wants local numbers without the leading '+' (e.g. 8801XXXXXXXXX). */
  private normalize(to: string): string {
    return to.replace(/[^\d]/g, '');
  }

  async sendSms(to: string, message: string): Promise<SmsSendResult> {
    const { apiKey, senderId } = this.opts;
    if (!apiKey || !senderId) {
      return { success: false, error: 'BulkSMSBD not configured (apiKey/senderId)' };
    }

    const endpoint = this.opts.endpoint || 'https://bulksmsbd.net/api/smsapi';
    const body = new URLSearchParams({
      api_key: apiKey,
      senderid: senderId,
      number: this.normalize(to),
      message,
    });

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const data = (await res.json().catch(() => ({}))) as {
        response_code?: number;
        success_message?: string;
        error_message?: string;
      };

      if (res.ok && data.response_code === SUCCESS_CODE) {
        return { success: true, messageId: data.success_message };
      }
      return {
        success: false,
        error: data.error_message || `BulkSMSBD response_code ${data.response_code ?? res.status}`,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'BulkSMSBD request failed';
      return { success: false, error: msg };
    }
  }
}
