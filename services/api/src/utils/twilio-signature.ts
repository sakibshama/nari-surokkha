/**
 * Twilio request signature validation.
 *
 * Implements Twilio's documented HMAC-SHA1 scheme so we don't need to pull in
 * the full Twilio SDK. The public SMS webhook MUST reject any request that
 * isn't a genuine, untampered Twilio callback — otherwise anyone could POST a
 * spoofed `{From, Body}` and drive emergency-alert processing.
 *
 * Algorithm (per Twilio docs):
 *   1. Start with the full request URL (scheme + host + path + query).
 *   2. Append every POST param, sorted alphabetically by key, as key+value.
 *   3. HMAC-SHA1 the result with the account auth token, base64-encode it.
 *   4. Constant-time compare against the `X-Twilio-Signature` header.
 */

import crypto from 'crypto';

export function computeTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, unknown>,
): string {
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) {
    data += key + String(params[key] ?? '');
  }
  return crypto.createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64');
}

export function isValidTwilioSignature(
  authToken: string,
  signatureHeader: string | undefined,
  url: string,
  params: Record<string, unknown>,
): boolean {
  if (!signatureHeader) return false;
  const expected = computeTwilioSignature(authToken, url, params);
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  // Length check first — timingSafeEqual throws on length mismatch.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
