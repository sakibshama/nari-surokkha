/**
 * Twilio SMS provider.
 *
 * Calls the Twilio REST API directly with fetch (no SDK dependency) so
 * the service stays lightweight. Auth is HTTP Basic with
 * accountSid:authToken. Returns a structured result rather than throwing.
 *
 * Docs: https://www.twilio.com/docs/sms/api/message-resource
 */

import { SmsProvider, SmsSendResult } from './sms.provider';

export interface TwilioSmsOptions {
  accountSid: string;
  authToken: string;
  fromNumber: string;
}

export class TwilioSmsProvider implements SmsProvider {
  readonly name = 'twilio';

  constructor(private readonly opts: TwilioSmsOptions) {}

  async sendSms(to: string, message: string): Promise<SmsSendResult> {
    const { accountSid, authToken, fromNumber } = this.opts;
    if (!accountSid || !authToken || !fromNumber) {
      return { success: false, error: 'Twilio not fully configured (accountSid/authToken/fromNumber)' };
    }

    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;
    const body = new URLSearchParams({ To: to, From: fromNumber, Body: message });
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const data = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
      if (!res.ok) {
        return { success: false, error: data.message || `Twilio HTTP ${res.status}` };
      }
      return { success: true, messageId: data.sid };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Twilio request failed';
      return { success: false, error: msg };
    }
  }
}
