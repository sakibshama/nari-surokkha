/**
 * Outbound SMS provider abstraction.
 *
 * Every provider (Twilio, BulkSMSBD, Mock) implements this interface.
 * `sendSms` must never throw for a delivery failure — it returns a
 * structured result so the caller can log per-recipient outcomes and
 * decide on retries.
 */

export interface SmsSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface SmsProvider {
  readonly name: string;
  sendSms(to: string, message: string): Promise<SmsSendResult>;
}
