/**
 * End-to-end SOS flow — INTEGRATION test (real Postgres + Redis).
 *
 * Exercises the whole critical path over real HTTP against a booted app:
 *   register citizen → login → add trusted contact → trigger SOS
 * and asserts the alert is persisted and active. This is the safety-critical
 * path, so it gets a real end-to-end guard rather than a mock.
 *
 * Runs only in the `integration` vitest project (needs a migrated test DB and
 * Redis). CI applies migrations before running it.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '@/app';

const API = '/api/v1';

// Unique citizen per run so re-runs never collide on the phone unique index.
function randomPhone(): string {
  const digits = Math.floor(10_000_000 + Math.random() * 89_999_999); // 8 digits
  return `+88017${digits}`; // matches ^\+8801[3-9]\d{8}$
}

describe('E2E: SOS emergency flow', () => {
  let app: FastifyInstance;
  const phone = randomPhone();
  const password = 'Test@1234';
  let token = '';
  let userId = '';
  let alertId = '';

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    // Best-effort cleanup so a shared local DB doesn't accumulate rows.
    try {
      if (userId) {
        // Test fixtures only: status history is RESTRICT-protected, clear it first.
        await app.prisma.alertStatusEvent.deleteMany({ where: { alert: { userId } } }).catch(() => undefined);
        await app.prisma.emergencyAlert.deleteMany({ where: { userId } });
        await app.prisma.trustedContact.deleteMany({ where: { userId } });
        await app.prisma.userSession.deleteMany({ where: { userId } }).catch(() => undefined);
        await app.prisma.userProfile.deleteMany({ where: { userId } }).catch(() => undefined);
        await app.prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
      }
    } catch {
      /* ignore cleanup errors — the ephemeral CI DB is discarded anyway */
    }
    await app.close();
  });

  it('registers a citizen', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${API}/auth/register`,
      payload: { phone, password, fullName: 'E2E Test Citizen', preferredLanguage: 'en' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.success).toBe(true);
    userId = body.data?.user?.id ?? body.data?.id ?? '';
    expect(userId).toBeTruthy();
  });

  it('logs in and receives an access token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${API}/auth/login`,
      payload: { phone, password },
    });
    expect(res.statusCode).toBe(200);
    token = res.json().data?.tokens?.accessToken ?? '';
    expect(token).toBeTruthy();
  });

  it('adds a trusted contact', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${API}/contacts`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'E2E Contact', phone: '+8801712345670', relation: 'sister' },
    });
    // 201 created (or 200) — tolerate either success shape
    expect([200, 201]).toContain(res.statusCode);
    expect(res.json().success).toBe(true);
  });

  it('rejects an unauthenticated SOS', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${API}/alerts/sos`,
      payload: { latitude: 23.8103, longitude: 90.4125 },
    });
    expect(res.statusCode).toBe(401);
  });

  it('validates SOS coordinates', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${API}/alerts/sos`,
      headers: { authorization: `Bearer ${token}` },
      payload: { latitude: 999, longitude: 90.4125 }, // out of range
    });
    expect(res.statusCode).toBe(400);
  });

  it('triggers an SOS and persists an active alert', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${API}/alerts/sos`,
      headers: { authorization: `Bearer ${token}` },
      payload: { latitude: 23.8103, longitude: 90.4125, accuracy: 12 },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.success).toBe(true);
    alertId = body.data?.id ?? '';
    expect(alertId).toBeTruthy();

    // Verify it actually landed in the database and is active.
    const row = await app.prisma.emergencyAlert.findUnique({ where: { id: alertId } });
    expect(row).not.toBeNull();
    expect(row?.userId).toBe(userId);
    expect(Number(row?.latitude)).toBeCloseTo(23.8103, 3);
    // An SOS must be created in an active-ish state (never cancelled/resolved).
    expect(['created', 'confirmed', 'dispatched', 'active', 'acknowledged']).toContain(row?.status);
  });
});
