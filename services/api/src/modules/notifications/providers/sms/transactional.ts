/**
 * One-off SMS that is not part of an SOS fan-out (OTP codes, contact consent
 * links). Uses the provider configured in the Admin Portal, ignoring the
 * "SOS SMS enabled" switch: without these the account cannot be verified.
 */

import type { FastifyInstance } from 'fastify';
import { createSmsProvider } from './sms.factory';
import type { SmsSendResult } from './sms.provider';

export async function sendTransactionalSms(
  fastify: FastifyInstance,
  to: string,
  message: string,
): Promise<SmsSendResult & { provider: string }> {
  const provider = createSmsProvider(await fastify.settings.getSmsConfig());
  try {
    return { ...(await provider.sendSms(to, message)), provider: provider.name };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err), provider: provider.name };
  }
}
