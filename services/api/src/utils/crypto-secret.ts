/**
 * Secret-at-rest encryption for runtime settings.
 *
 * Uses AES-256-GCM (authenticated encryption). The key comes from
 * CONFIG_ENCRYPTION_KEY and must be 32 bytes, supplied as 64 hex chars
 * or base64. Ciphertext is stored as: <iv>:<authTag>:<ciphertext>, all
 * base64. If no key is configured we FAIL CLOSED rather than silently
 * persisting plaintext secrets.
 */

import crypto from 'crypto';
import { env } from '@/config/env';

const ALGO = 'aes-256-gcm';
const PREFIX = 'enc:v1:';

/** Resolve the 32-byte key from env, or null if not configured. */
function getKey(): Buffer | null {
  const raw = env.CONFIG_ENCRYPTION_KEY;
  if (!raw) return null;

  // Accept hex (64 chars) or base64.
  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, 'hex');
  } else {
    key = Buffer.from(raw, 'base64');
  }
  if (key.length !== 32) {
    throw new Error(
      'CONFIG_ENCRYPTION_KEY must decode to exactly 32 bytes (use `openssl rand -hex 32`).',
    );
  }
  return key;
}

export function isEncryptionConfigured(): boolean {
  return getKey() !== null;
}

/** Encrypt a plaintext string. Throws if no key is configured. */
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  if (!key) {
    throw new Error(
      'Cannot encrypt secret: CONFIG_ENCRYPTION_KEY is not set. Refusing to store plaintext secrets.',
    );
  }
  const iv = crypto.randomBytes(12); // 96-bit nonce (GCM standard)
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return (
    PREFIX +
    [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(':')
  );
}

/** Decrypt a value produced by encryptSecret. Returns '' on any failure. */
export function decryptSecret(value: string): string {
  if (!value || !value.startsWith(PREFIX)) {
    // Not encrypted (legacy/plaintext) — return as-is for forward compat.
    return value ?? '';
  }
  const key = getKey();
  if (!key) return '';
  try {
    const [ivB64, tagB64, dataB64] = value.slice(PREFIX.length).split(':');
    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(tagB64, 'base64');
    const ciphertext = Buffer.from(dataB64, 'base64');
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString('utf8');
  } catch {
    return '';
  }
}

/** True if a stored value is an encrypted blob. */
export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX);
}
