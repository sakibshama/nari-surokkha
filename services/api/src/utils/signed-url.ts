/**
 * HMAC-signed URLs for local-disk storage (B6).
 *
 * Object storage hands out real pre-signed URLs. In local mode the API serves
 * files itself from /evidence/mock-s3/<key>, and that route used to accept any
 * request: `expires=` was decorative. Now the URL carries
 * `sig = HMAC-SHA256(secret, "<key>:<expires>")` and the route rejects missing,
 * expired or forged signatures.
 */

import crypto from 'crypto';
import { env } from '@/config/env';

function signingKey(): string {
  return (
    env.EVIDENCE_URL_SECRET ??
    crypto.createHmac('sha256', env.JWT_SECRET).update('evidence-url-signing').digest('hex')
  );
}

export function signStorageKey(fileKey: string, expiresAtMs: number): string {
  return crypto.createHmac('sha256', signingKey()).update(`${fileKey}:${expiresAtMs}`).digest('hex');
}

export function verifyStorageSignature(
  fileKey: string,
  expires: unknown,
  sig: unknown,
  now = Date.now(),
): boolean {
  if (typeof expires !== 'string' || typeof sig !== 'string' || !/^\d+$/.test(expires)) return false;
  const expiresAtMs = Number(expires);
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs < now) return false;
  const expected = Buffer.from(signStorageKey(fileKey, expiresAtMs), 'hex');
  const given = Buffer.from(sig, 'hex');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}
