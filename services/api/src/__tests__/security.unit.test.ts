/**
 * Cross-cutting fixes: 4xx pass-through (contract 1), evidence access + signed
 * local URLs (B6 / IDOR), rate-limit keying (B3), ephemeral TURN credentials (B5).
 */

import { describe, it, expect, vi } from 'vitest';
import crypto from 'crypto';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { registerErrorHandler } from '@/middleware/error-handler';
import { signStorageKey, verifyStorageSignature } from '@/utils/signed-url';
import { canAccessAlert } from '@/utils/alert-access';
import { EvidenceService } from '@/modules/evidence/evidence.service';
import type { EvidenceRepository } from '@/modules/evidence/evidence.repository';
import { resolveRateLimitKey } from '@/plugins/rate-limit';
import { parseTrustProxy } from '@/config/env';
import { turnRestCredentials } from '@/modules/config/ice-servers';

describe('error handler', () => {
  it('passes fastify.httpErrors 4xx through with their status and message', async () => {
    const app = Fastify();
    await app.register(sensible);
    app.get('/conflict', async () => { throw app.httpErrors.conflict('Already applied'); });
    app.get('/gone', async () => { throw Object.assign(new Error('Moved'), { statusCode: 410 }); });
    app.get('/boom', async () => { throw new Error('db exploded'); });
    registerErrorHandler(app);

    const conflict = await app.inject({ method: 'GET', url: '/conflict' });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toEqual({ success: false, error: { code: 'HTTP_409', message: 'Already applied' } });

    expect((await app.inject({ method: 'GET', url: '/gone' })).statusCode).toBe(410);

    const boom = await app.inject({ method: 'GET', url: '/boom' });
    expect(boom.statusCode).toBe(500);
    expect(boom.body).not.toContain('db exploded');
    await app.close();
  });
});

describe('signed local-storage URLs (B6)', () => {
  const key = 'evidence/2026-10-12/abc.jpg';

  it('accepts a valid, unexpired signature only', () => {
    const exp = Date.now() + 60_000;
    const sig = signStorageKey(key, exp);
    expect(verifyStorageSignature(key, String(exp), sig)).toBe(true);
    expect(verifyStorageSignature('evidence/other.jpg', String(exp), sig)).toBe(false);
    expect(verifyStorageSignature(key, String(exp + 1), sig)).toBe(false);
    expect(verifyStorageSignature(key, String(exp), undefined)).toBe(false);
    expect(verifyStorageSignature(key, undefined, sig)).toBe(false);
    expect(verifyStorageSignature(key, String(exp), 'zz')).toBe(false);
  });

  it('rejects an expired link', () => {
    const exp = Date.now() - 1;
    expect(verifyStorageSignature(key, String(exp), signStorageKey(key, exp))).toBe(false);
  });
});

describe('alert access (evidence IDOR, responder room joins)', () => {
  function prismaWith(alert: unknown) {
    return { emergencyAlert: { findUnique: vi.fn().mockResolvedValue(alert) } } as never;
  }

  it('owner, admin and a responder with an ACCEPTED dispatch may access; others may not', async () => {
    const own = prismaWith({ userId: 'owner', responderDispatches: [] });
    expect(await canAccessAlert(own, 'a1', { id: 'owner', role: 'citizen' })).toBe(true);
    expect(await canAccessAlert(own, 'a1', { id: 'admin', role: 'admin' })).toBe(true);
    expect(await canAccessAlert(own, 'a1', { id: 'r-user', role: 'responder' })).toBe(false);
    expect(await canAccessAlert(own, 'a1', { id: 'x', role: 'custom_role' })).toBe(false);

    const accepted = prismaWith({ userId: 'owner', responderDispatches: [{ id: 'd1' }] });
    expect(await canAccessAlert(accepted, 'a1', { id: 'r-user', role: 'responder' })).toBe(true);
  });

  it('the dispatch lookup is restricted to accepted dispatches of this responder', async () => {
    const prisma = prismaWith({ userId: 'owner', responderDispatches: [] }) as unknown as {
      emergencyAlert: { findUnique: ReturnType<typeof vi.fn> };
    };
    await canAccessAlert(prisma as never, 'a1', { id: 'r-user', role: 'responder' });
    const where = prisma.emergencyAlert.findUnique.mock.calls[0][0].select.responderDispatches.where;
    expect(where).toEqual({ acceptedAt: { not: null }, responder: { userId: 'r-user' } });
  });

  it('a non-citizen role can no longer stream someone else\'s evidence', async () => {
    const repo = {
      getEvidenceById: vi.fn().mockResolvedValue({ id: 'e1', alertId: 'a1', fileKey: 'k', alert: { userId: 'owner' } }),
      logAccess: vi.fn(),
    };
    const fastify = {
      prisma: prismaWith({ userId: 'owner', responderDispatches: [] }),
      storage: { getFileBuffer: vi.fn().mockResolvedValue(Buffer.from('x')) },
      httpErrors: {
        forbidden: (m: string) => Object.assign(new Error(m), { statusCode: 403 }),
        notFound: (m: string) => Object.assign(new Error(m), { statusCode: 404 }),
      },
      log: { error: vi.fn(), warn: vi.fn() },
    } as unknown as FastifyInstance;
    const service = new EvidenceService(repo as unknown as EvidenceRepository, fastify);

    await expect(service.getFileContent('e1', { id: 'r-user', role: 'responder' })).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.getPresignedUrl('e1', { id: 'r-user', role: 'responder' })).rejects.toMatchObject({ statusCode: 403 });
    expect(fastify.storage.getFileBuffer).not.toHaveBeenCalled();
  });
});

describe('rate-limit key (B3)', () => {
  it('uses request.ip and ignores a client-supplied X-Forwarded-For', () => {
    const req = {
      headers: { 'x-forwarded-for': '6.6.6.6' },
      cookies: {},
      ip: '10.0.0.7',
    } as unknown as FastifyRequest;
    expect(resolveRateLimitKey(req)).toBe('ip:10.0.0.7');
  });

  it('parses TRUST_PROXY', () => {
    expect(parseTrustProxy(undefined, true)).toBe(1);
    expect(parseTrustProxy(undefined, false)).toBe(false);
    expect(parseTrustProxy('true', false)).toBe(true);
    expect(parseTrustProxy('FALSE', true)).toBe(false);
    expect(parseTrustProxy('2', false)).toBe(2);
    expect(parseTrustProxy('10.0.0.0/8, 127.0.0.1', false)).toEqual(['10.0.0.0/8', '127.0.0.1']);
  });

  it('Fastify honours trustProxy for request.ip', async () => {
    const app = Fastify({ trustProxy: 1 });
    app.get('/ip', async (req) => ({ ip: req.ip }));
    const res = await app.inject({ method: 'GET', url: '/ip', headers: { 'x-forwarded-for': '1.2.3.4, 9.9.9.9' } });
    expect(res.json().ip).toBe('9.9.9.9'); // only the hop nginx added is trusted
    await app.close();
  });
});

describe('TURN REST credentials (B5)', () => {
  it('are per user, expire after an hour, and verify with the shared secret', () => {
    const now = Date.parse('2026-10-12T12:00:00Z');
    const { username, credential } = turnRestCredentials('s3cret', 'user-1', now);
    expect(username).toBe(`${now / 1000 + 3600}:user-1`);
    expect(credential).toBe(crypto.createHmac('sha1', 's3cret').update(username).digest('base64'));
  });
});
