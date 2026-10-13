/**
 * Phone verification by SMS one-time code (B4).
 *
 *   POST /auth/otp/request { phone }        → SMS a 6-digit code (5 min)
 *   POST /auth/otp/verify  { phone, code }  → { otpToken } (15 min, single use)
 *   POST /auth/register    { ..., otpToken }
 *
 * Only an HMAC of the code is stored (Redis, keyed by the normalised phone).
 * A code allows 5 attempts; the 6th wipes it. The otpToken is a JWT signed
 * with a key derived for this purpose only, bound to the normalised phone,
 * and is consumed on use.
 */

import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import type { FastifyInstance } from 'fastify';
import { env } from '@/config/env';
import { normalizePhone } from '@/utils/phone';
import { AppError, TooManyRequestsError, ValidationError } from '@/utils/errors';
import { sendTransactionalSms } from '@/modules/notifications/providers/sms/transactional';

export const OTP_TTL_SECONDS = 5 * 60;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_TOKEN_TTL_SECONDS = 15 * 60;
/** Per phone: 3 codes per 10 minutes. (Per IP is a route-level rate limit.) */
const REQUESTS_PER_PHONE = 3;
const REQUEST_WINDOW_SECONDS = 10 * 60;

const PURPOSE = 'phone-verify';

const codeKey = (phone: string) => `otp:code:${phone}`;
const attemptsKey = (phone: string) => `otp:attempts:${phone}`;
const requestsKey = (phone: string) => `otp:requests:${phone}`;
const tokenKey = (phone: string) => `otp:token:${phone}`;

function derivedKey(label: string): string {
  return crypto.createHmac('sha256', env.JWT_SECRET).update(label).digest('hex');
}

function hashCode(phone: string, code: string): string {
  return crypto.createHmac('sha256', derivedKey('otp-code')).update(`${phone}:${code}`).digest('hex');
}

interface OtpTokenPayload {
  purpose: typeof PURPOSE;
  phone: string;
  jti: string;
}

export class PhoneOtpService {
  constructor(private readonly fastify: FastifyInstance) {}

  async request(rawPhone: string): Promise<{ expiresInSec: number; devCode?: string }> {
    const phone = normalizePhone(rawPhone);
    const redis = this.fastify.redis;

    const sent = await redis.incr(requestsKey(phone));
    if (sent === 1) await redis.expire(requestsKey(phone), REQUEST_WINDOW_SECONDS);
    if (sent > REQUESTS_PER_PHONE) {
      throw new TooManyRequestsError('Too many codes requested for this number. Try again in a few minutes.');
    }

    const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
    await redis.set(codeKey(phone), hashCode(phone, code), 'EX', OTP_TTL_SECONDS);
    await redis.del(attemptsKey(phone));

    const result = await sendTransactionalSms(
      this.fastify,
      phone,
      `Nari Surokkha code: ${code}. Valid for 5 minutes. Do not share it. / যাচাই কোড: ${code}`,
    );
    if (!result.success) {
      await redis.del(codeKey(phone));
      this.fastify.log.error({ error: result.error, provider: result.provider }, 'OTP SMS failed');
      throw new AppError('Could not send the verification SMS. Please try again.', 503, 'SMS_001');
    }

    const exposeCode = env.NODE_ENV === 'development' && result.provider === 'mock';
    return { expiresInSec: OTP_TTL_SECONDS, ...(exposeCode ? { devCode: code } : {}) };
  }

  async verify(rawPhone: string, code: string): Promise<{ otpToken: string }> {
    const phone = normalizePhone(rawPhone);
    const redis = this.fastify.redis;

    const stored = await redis.get(codeKey(phone));
    if (!stored) throw new ValidationError('The code has expired or was never requested.');

    // Count the attempt BEFORE comparing, atomically, so parallel guesses
    // cannot exceed the limit.
    const attempts = await redis.incr(attemptsKey(phone));
    if (attempts === 1) await redis.expire(attemptsKey(phone), OTP_TTL_SECONDS);
    if (attempts > OTP_MAX_ATTEMPTS) {
      await redis.del(codeKey(phone), attemptsKey(phone));
      throw new TooManyRequestsError('Too many incorrect attempts. Request a new code.');
    }

    const given = Buffer.from(hashCode(phone, code), 'hex');
    const expected = Buffer.from(stored, 'hex');
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
      throw new ValidationError('Incorrect code.');
    }

    await redis.del(codeKey(phone), attemptsKey(phone));
    const jti = crypto.randomUUID();
    await redis.set(tokenKey(phone), jti, 'EX', OTP_TOKEN_TTL_SECONDS);
    const payload: OtpTokenPayload = { purpose: PURPOSE, phone, jti };
    const otpToken = jwt.sign(payload, derivedKey(PURPOSE), { expiresIn: OTP_TOKEN_TTL_SECONDS });
    return { otpToken };
  }

  /**
   * Check an otpToken against the phone being registered and spend it.
   * Throws ValidationError if it is invalid, expired, for another number, or
   * already used.
   */
  async consume(otpToken: string, rawPhone: string): Promise<void> {
    const phone = normalizePhone(rawPhone);
    let payload: OtpTokenPayload;
    try {
      payload = jwt.verify(otpToken, derivedKey(PURPOSE)) as OtpTokenPayload;
    } catch {
      throw new ValidationError('Phone verification has expired. Please verify your number again.');
    }
    if (payload?.purpose !== PURPOSE || payload.phone !== phone) {
      throw new ValidationError('Phone verification does not match this number.');
    }
    const current = await this.fastify.redis.getdel(tokenKey(phone));
    if (current !== payload.jti) {
      throw new ValidationError('Phone verification was already used. Please verify your number again.');
    }
  }
}
