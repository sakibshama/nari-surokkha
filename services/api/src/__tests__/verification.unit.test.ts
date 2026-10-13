/**
 * B4 — phone OTP and trusted-contact consent.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import type { FastifyInstance } from 'fastify';
import { PhoneOtpService, OTP_MAX_ATTEMPTS } from '../modules/auth/phone-otp.service';
import { ContactConsentService } from '../modules/contacts/contact-consent';
import { contactConsentRoutes } from '../routes/contact-consent.route';
import { TooManyRequestsError, ValidationError } from '@/utils/errors';

/** Just enough of ioredis for these services. */
function fakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    set: vi.fn(async (k: string, v: string, ...args: unknown[]) => {
      if (args.includes('NX') && store.has(k)) return null;
      store.set(k, v);
      return 'OK';
    }),
    del: vi.fn(async (...keys: string[]) => keys.filter((k) => store.delete(k)).length),
    incr: vi.fn(async (k: string) => {
      const n = Number(store.get(k) ?? 0) + 1;
      store.set(k, String(n));
      return n;
    }),
    expire: vi.fn(async () => 1),
    getdel: vi.fn(async (k: string) => {
      const v = store.get(k) ?? null;
      store.delete(k);
      return v;
    }),
  };
}

function fakeFastify() {
  const redis = fakeRedis();
  const fastify = {
    redis,
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    settings: { getSmsConfig: vi.fn().mockResolvedValue({ provider: 'mock', enabled: true }) },
    prisma: {
      trustedContact: { findFirst: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    },
  };
  return { fastify, redis };
}

vi.mock('@/modules/notifications/providers/sms/transactional', () => ({
  sendTransactionalSms: vi.fn(async (_f: unknown, to: string, message: string) => {
    lastSms = { to, message };
    return { success: true, provider: 'mock' };
  }),
}));
let lastSms: { to: string; message: string } | null = null;

const codeFromSms = () => /code: (\d{6})/.exec(lastSms!.message)![1];

describe('PhoneOtpService', () => {
  let otp: PhoneOtpService;
  let redis: ReturnType<typeof fakeRedis>;

  beforeEach(() => {
    lastSms = null;
    const f = fakeFastify();
    redis = f.redis;
    otp = new PhoneOtpService(f.fastify as unknown as FastifyInstance);
  });

  it('sends a 6-digit code, stores only its hash, and never returns it outside development', async () => {
    const res = await otp.request('01712345678');
    expect(res).toEqual({ expiresInSec: 300 });
    expect(lastSms!.to).toBe('+8801712345678');
    const code = codeFromSms();
    expect(code).toMatch(/^\d{6}$/);
    const stored = redis.store.get('otp:code:+8801712345678')!;
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(stored).not.toContain(code);
  });

  it('limits requests per phone (3 per window)', async () => {
    await otp.request('+8801712345678');
    await otp.request('+8801712345678');
    await otp.request('+8801712345678');
    await expect(otp.request('+8801712345678')).rejects.toBeInstanceOf(TooManyRequestsError);
  });

  it('verify → otpToken that registers this number exactly once', async () => {
    await otp.request('+8801712345678');
    const { otpToken } = await otp.verify('01712345678', codeFromSms());
    await expect(otp.consume(otpToken, '+8801799999999')).rejects.toBeInstanceOf(ValidationError);
    await otp.consume(otpToken, '+8801712345678');
    await expect(otp.consume(otpToken, '+8801712345678')).rejects.toBeInstanceOf(ValidationError);
  });

  it('wipes the code after 5 wrong attempts', async () => {
    await otp.request('+8801712345678');
    const code = codeFromSms();
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
      await expect(otp.verify('+8801712345678', wrong)).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(otp.verify('+8801712345678', code)).rejects.toBeInstanceOf(TooManyRequestsError);
    // And the right code no longer works either: it is gone.
    await expect(otp.verify('+8801712345678', code)).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a forged token', async () => {
    await expect(otp.consume('not-a-jwt', '+8801712345678')).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('Trusted-contact consent', () => {
  let f: ReturnType<typeof fakeFastify>;
  let consent: ContactConsentService;

  beforeEach(() => {
    lastSms = null;
    f = fakeFastify();
    f.fastify.prisma.trustedContact.findFirst.mockResolvedValue({
      id: 'c1', userId: 'u1', phone: '+8801811111111', isVerified: false,
      user: { profile: { fullName: 'Rina <b>Akter</b>' } },
    });
    consent = new ContactConsentService(f.fastify as unknown as FastifyInstance);
  });

  const tokenFromSms = () => /\/c\/([A-Za-z0-9_-]{43})/.exec(lastSms!.message)![1];

  it('SMSes the contact a link; only the token hash is stored', async () => {
    await expect(consent.send('u1', 'c1')).resolves.toEqual({ sent: true });
    expect(lastSms!.to).toBe('+8801811111111');
    const token = tokenFromSms();
    const keys = [...f.redis.store.keys()].filter((k) => k.startsWith('contact-consent:') && !k.includes('cooldown'));
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toContain(token);
  });

  it('cannot be re-sent within the cooldown', async () => {
    await consent.send('u1', 'c1');
    await expect(consent.send('u1', 'c1')).rejects.toBeInstanceOf(TooManyRequestsError);
  });

  it('public page: GET shows the request (escaped, bilingual); POST accept verifies once', async () => {
    await consent.send('u1', 'c1');
    const token = tokenFromSms();

    const app = Fastify();
    app.decorate('redis', f.fastify.redis as never);
    app.decorate('prisma', f.fastify.prisma as never);
    app.decorate('settings', f.fastify.settings as never);
    await app.register(formbody);
    await app.register(contactConsentRoutes);

    const page = await app.inject({ method: 'GET', url: `/c/${token}` });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('I agree to be an emergency contact for Rina');
    expect(page.body).toContain('lang="bn"');
    expect(page.body).not.toContain('<b>');
    expect(f.fastify.prisma.trustedContact.updateMany).not.toHaveBeenCalled();

    const accept = await app.inject({ method: 'POST', url: `/c/${token}/accept` });
    expect(accept.statusCode).toBe(200);
    expect(f.fastify.prisma.trustedContact.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', userId: 'u1', phone: '+8801811111111' },
      data: { isVerified: true },
    });

    const again = await app.inject({ method: 'POST', url: `/c/${token}/accept` });
    expect(again.statusCode).toBe(404);
    const bogus = await app.inject({ method: 'GET', url: '/c/nope' });
    expect(bogus.statusCode).toBe(404);
    await app.close();
  });
});
