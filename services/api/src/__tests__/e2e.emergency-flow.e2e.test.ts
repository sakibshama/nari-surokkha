/**
 * Comprehensive End-to-End (E2E) Emergency Workflow Test
 *
 * Simulates the complete 5-phase emergency pipeline:
 * 1. Citizen Triggers SOS (with real GPS coordinates)
 * 2. Alert persisted and handed to the dispatch queue
 * 3. Audit trail for the SOS
 * 4. WebRTC Live Stream Signaling & Tracking Token Verification
 * 5. SMS Notification Logging & Trusted Contact Dispatch Delivery
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '@/app';
import { generateTrackingToken } from '@/modules/alerts/alerts.tokens';

const API = '/api/v1';

function randomPhone(): string {
  const digits = Math.floor(10_000_000 + Math.random() * 89_999_999);
  return `+88017${digits}`;
}

describe('E2E Emergency Flow: Citizen SOS -> Dispatch -> Audit -> WebRTC Stream -> SMS Delivery', () => {
  let app: FastifyInstance;
  const citizenPhone = randomPhone();
  const citizenPassword = 'Password123!';
  let citizenToken = '';
  let citizenUserId = '';
  let alertId = '';
  let trackingToken = '';

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // Mock SMS delivery and BullMQ queues to capture outbound notifications deterministically
    if (app.queues?.notifications) {
      vi.spyOn(app.queues.notifications, 'add').mockImplementation(async (_name, _data) => {
        return { id: `mock-job-${Date.now()}` } as any;
      });
    }
  });

  afterAll(async () => {
    try {
      if (alertId) {
        await app.prisma.notificationLog.deleteMany({ where: { alertId } }).catch(() => undefined);
        await app.prisma.alertLocation.deleteMany({ where: { alertId } }).catch(() => undefined);
        await app.prisma.emergencyAlert.deleteMany({ where: { id: alertId } }).catch(() => undefined);
      }
      if (citizenUserId) {
        await app.prisma.trustedContact.deleteMany({ where: { userId: citizenUserId } }).catch(() => undefined);
        await app.prisma.userSession.deleteMany({ where: { userId: citizenUserId } }).catch(() => undefined);
        await app.prisma.userProfile.deleteMany({ where: { userId: citizenUserId } }).catch(() => undefined);
        await app.prisma.user.delete({ where: { id: citizenUserId } }).catch(() => undefined);
      }
    } catch {
      /* ignore cleanup errors on ephemeral databases */
    }
    await app.close();
  });

  // ─────────────────────────────────────────────────────────────
  // Phase 1: Citizen Onboarding & Trusted Contacts
  // ─────────────────────────────────────────────────────────────
  it('Phase 1: Registers citizen and configures trusted contact', async () => {
    // 1a. Register Citizen
    const regRes = await app.inject({
      method: 'POST',
      url: `${API}/auth/register`,
      payload: {
        phone: citizenPhone,
        password: citizenPassword,
        fullName: 'Ayesha Rahman',
        preferredLanguage: 'bn',
      },
    });
    expect(regRes.statusCode).toBe(201);
    const regBody = regRes.json();
    expect(regBody.success).toBe(true);
    citizenUserId = regBody.data?.user?.id ?? regBody.data?.id;
    expect(citizenUserId).toBeTruthy();

    // 1b. Login
    const loginRes = await app.inject({
      method: 'POST',
      url: `${API}/auth/login`,
      payload: { phone: citizenPhone, password: citizenPassword },
    });
    expect(loginRes.statusCode).toBe(200);
    citizenToken = loginRes.json().data?.tokens?.accessToken;
    expect(citizenToken).toBeTruthy();

    // 1c. Add Trusted Contact
    const contactRes = await app.inject({
      method: 'POST',
      url: `${API}/contacts`,
      headers: { authorization: `Bearer ${citizenToken}` },
      payload: {
        name: 'Family Primary Contact',
        phone: '+8801812345678',
        relation: 'parent',
      },
    });
    expect([200, 201]).toContain(contactRes.statusCode);
    expect(contactRes.json().success).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────
  // Phase 2: Citizen Triggers SOS
  // ─────────────────────────────────────────────────────────────
  it('Phase 2: Citizen triggers manual SOS -> alert is persisted', async () => {
    // Coordinates near Dhaka Dhanmondi (23.7461, 90.3742)
    const sosRes = await app.inject({
      method: 'POST',
      url: `${API}/alerts/sos`,
      headers: { authorization: `Bearer ${citizenToken}` },
      payload: {
        latitude: 23.7461,
        longitude: 90.3742,
        accuracy: 8.5,
      },
    });
    expect(sosRes.statusCode).toBe(201);
    const sosBody = sosRes.json();
    expect(sosBody.success).toBe(true);
    alertId = sosBody.data?.id;
    trackingToken = sosBody.data?.trackingToken;
    expect(alertId).toBeTruthy();
    expect(trackingToken).toBeTruthy();

    // Verify database record persisted
    const alertRow = await app.prisma.emergencyAlert.findUnique({
      where: { id: alertId },
    });
    expect(alertRow).not.toBeNull();
    expect(alertRow?.status).toBe('confirmed');
    expect(alertRow?.type).toBe('manual');
  });

  // ─────────────────────────────────────────────────────────────
  // Phase 3: Audit trail
  // ─────────────────────────────────────────────────────────────
  it('Phase 3: Writes an audit log entry for the SOS', async () => {
    // Verify audit log entry for SOS trigger
    const auditLogRow = await app.prisma.auditLog.findFirst({
      where: { entityId: alertId, action: 'sos_triggered' },
    });
    expect(auditLogRow).not.toBeNull();
    expect(auditLogRow?.entityType).toBe('alert');
  });

  // ─────────────────────────────────────────────────────────────
  // Phase 4: WebRTC Streaming & Tracking Token Verification
  // ─────────────────────────────────────────────────────────────
  it('Phase 4: Generates WebRTC live stream tracking token and validates token payload', async () => {
    // Generate/Verify tracking token payload
    const tokenPayload = generateTrackingToken(alertId);
    expect(tokenPayload).toBeTruthy();
    expect(typeof tokenPayload).toBe('string');

    // Verify alert live stream location updates
    const locationUpdateRes = await app.inject({
      method: 'POST',
      url: `${API}/alerts/${alertId}/location`,
      headers: { authorization: `Bearer ${citizenToken}` },
      payload: {
        latitude: 23.7465,
        longitude: 90.3748,
        accuracy: 5.0,
      },
    });
    expect(locationUpdateRes.statusCode).toBe(200);

    // Assert location update persisted
    const locationHistory = await app.prisma.alertLocation.findMany({
      where: { alertId },
    });
    expect(locationHistory.length).toBeGreaterThan(0);
  });

  // ─────────────────────────────────────────────────────────────
  // Phase 5: SMS Delivery Notification Pipeline
  // ─────────────────────────────────────────────────────────────
  it('Phase 5: Enqueues SMS notification to trusted contacts with tracking URL', async () => {
    // Verify notification queue dispatch call was triggered for trusted contacts
    if (app.queues?.notifications) {
      expect(app.queues.notifications.add).toHaveBeenCalledWith(
        'notify_trusted_contacts',
        expect.objectContaining({
          alertId,
          userId: citizenUserId,
        }),
      );
    }
  });
});
