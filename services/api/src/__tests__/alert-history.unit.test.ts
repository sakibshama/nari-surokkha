/**
 * SOS permanent record — status history unit tests.
 *
 * Every SOS / soft alert stays on record whatever happens to it: creation,
 * cancel and resolve change the status and append a history row; nothing is
 * ever deleted. The admin list returns every status (cancelled included) and
 * the detail returns the timeline.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { AlertsRepository } from '@/modules/alerts/alerts.repository';
import { AlertsService } from '@/modules/alerts/alerts.service';
import { AdminRepository } from '@/modules/admin/admin.repository';
import { AdminService, toAlertFilters } from '@/modules/admin/admin.service';
import { applyStatusTransition } from '@/modules/alerts/alert-history';
import { ValidationError } from '@/utils/errors';

/** A Prisma stand-in whose interactive transactions run against itself. */
function makePrisma() {
  const prisma: any = {
    emergencyAlert: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    alertStatusEvent: {
      create: vi.fn().mockResolvedValue({ id: 'ev-1' }),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    auditLog: { create: vi.fn() },
  };
  prisma.$transaction = vi.fn(async (fn: (tx: any) => unknown) => fn(prisma));
  return prisma;
}

function expectNothingDeleted(prisma: any) {
  expect(prisma.emergencyAlert.delete).not.toHaveBeenCalled();
  expect(prisma.emergencyAlert.deleteMany).not.toHaveBeenCalled();
  expect(prisma.alertStatusEvent.delete).not.toHaveBeenCalled();
  expect(prisma.alertStatusEvent.deleteMany).not.toHaveBeenCalled();
}

const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };

describe('AlertsRepository — history on create', () => {
  beforeEach(() => vi.clearAllMocks());

  it('a manual SOS is created together with its "created" history event', async () => {
    const prisma = makePrisma();
    prisma.emergencyAlert.create.mockResolvedValue({ id: 'a1', status: 'confirmed' });
    const repo = new AlertsRepository(prisma, log);

    await repo.createAlert({ userId: 'u1', latitude: 23.7, longitude: 90.4, status: 'confirmed' });

    expect(prisma.emergencyAlert.create).toHaveBeenCalledTimes(1);
    const { data } = prisma.emergencyAlert.create.mock.calls[0][0];
    expect(data.status).toBe('confirmed');
    expect(data.statusEvents.create).toMatchObject({
      fromStatus: null,
      toStatus: 'confirmed',
      actorKind: 'user',
      actorId: 'u1',
    });
  });

  it('a soft alert is recorded as "created"', async () => {
    const prisma = makePrisma();
    prisma.emergencyAlert.create.mockResolvedValue({ id: 'a2', status: 'created' });
    const repo = new AlertsRepository(prisma, log);

    await repo.createAlert({ userId: 'u1', latitude: 1, longitude: 1, status: 'created', isSoftAlert: true, type: 'sensor_triggered' });

    const { data } = prisma.emergencyAlert.create.mock.calls[0][0];
    expect(data.statusEvents.create).toMatchObject({ toStatus: 'created', metadata: expect.objectContaining({ isSoftAlert: true }) });
  });

  it('a history failure never blocks the SOS: the alert is created without it and the failure logged', async () => {
    const prisma = makePrisma();
    prisma.emergencyAlert.create
      .mockRejectedValueOnce(new Error('relation "alert_status_events" does not exist'))
      .mockResolvedValueOnce({ id: 'a3', status: 'confirmed' });
    const repo = new AlertsRepository(prisma, log);

    const alert = await repo.createAlert({ userId: 'u1', latitude: 1, longitude: 1 });

    expect(alert.id).toBe('a3');
    expect(prisma.emergencyAlert.create).toHaveBeenCalledTimes(2);
    expect(prisma.emergencyAlert.create.mock.calls[1][0].data.statusEvents).toBeUndefined();
    expect(log.error).toHaveBeenCalled();
  });
});

describe('AlertsRepository — history on transitions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updateAlert with history writes the event in the same transaction', async () => {
    const prisma = makePrisma();
    prisma.emergencyAlert.update.mockResolvedValue({ id: 'a1', status: 'resolved' });
    const repo = new AlertsRepository(prisma, log);

    await repo.updateAlert('a1', { status: 'resolved' }, { fromStatus: 'confirmed', actorKind: 'user', actorId: 'u1' });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.alertStatusEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ alertId: 'a1', fromStatus: 'confirmed', toStatus: 'resolved', actorKind: 'user', actorId: 'u1' }),
    });
  });

  it('a history insert failure still applies the status change (and logs)', async () => {
    const prisma = makePrisma();
    prisma.emergencyAlert.update.mockResolvedValue({ id: 'a1', status: 'false_alarm' });
    prisma.alertStatusEvent.create.mockRejectedValueOnce(new Error('boom'));
    const repo = new AlertsRepository(prisma, log);

    const r = await repo.updateAlert('a1', { status: 'false_alarm' }, { fromStatus: 'confirmed', actorKind: 'user' });

    expect(r.status).toBe('false_alarm');
    // once inside the rolled-back transaction, once on its own
    expect(prisma.emergencyAlert.update).toHaveBeenCalledTimes(2);
    expect(log.error).toHaveBeenCalled();
  });

  it('a non-history failure is not swallowed', async () => {
    const prisma = makePrisma();
    prisma.emergencyAlert.update.mockRejectedValue(new Error('P2025 not found'));
    await expect(
      applyStatusTransition(prisma, log, (tx) => tx.emergencyAlert.update({ where: { id: 'x' }, data: {} }), () => ({
        alertId: 'x', fromStatus: null, toStatus: 'resolved', actorKind: 'system',
      })),
    ).rejects.toThrow('P2025');
    expect(prisma.alertStatusEvent.create).not.toHaveBeenCalled();
  });

  it('a soft-alert transition that lost the race writes no history', async () => {
    const prisma = makePrisma();
    prisma.emergencyAlert.updateMany.mockResolvedValue({ count: 0 });
    const repo = new AlertsRepository(prisma, log);

    const r = await repo.updateIfSoftAlertPending('a1', { status: 'false_alarm' }, { actorKind: 'user', actorId: 'u1' });

    expect(r).toBeNull();
    expect(prisma.alertStatusEvent.create).not.toHaveBeenCalled();
  });
});

describe('AlertsService + repository — cancel / resolve keep the record', () => {
  let prisma: any;
  let service: AlertsService;
  let fastify: any;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = makePrisma();
    fastify = {
      log,
      prisma,
      redis: { del: vi.fn().mockResolvedValue(1) },
      io: { to: vi.fn().mockReturnThis(), emit: vi.fn() },
      queues: {
        notifications: { add: vi.fn().mockResolvedValue({ id: 'n' }) },
        dispatch: { add: vi.fn().mockResolvedValue({ id: 'd' }) },
        escalations: { add: vi.fn().mockResolvedValue({ id: 'e' }) },
      },
    };
    const repo = new AlertsRepository(prisma, log);
    const contacts: any = { getContactsByUserId: vi.fn().mockResolvedValue([]) };
    const responders: any = { findNearbyResponders: vi.fn().mockResolvedValue([]) };
    service = new AlertsService(repo, contacts, responders, fastify as unknown as FastifyInstance);
  });

  it('triggering an SOS records the creation event', async () => {
    prisma.emergencyAlert.create.mockResolvedValue({ id: 'a1', userId: 'u1', status: 'confirmed', type: 'manual', latitude: 1, longitude: 1 });
    prisma.subscription = { findUnique: vi.fn().mockResolvedValue({ status: 'active', smsRemaining: 5 }) };

    await service.triggerManualSos('u1', { latitude: 1, longitude: 1 });

    expect(prisma.emergencyAlert.create.mock.calls[0][0].data.statusEvents.create).toMatchObject({ toStatus: 'confirmed', actorKind: 'user' });
  });

  it('cancelling an SOS only changes its status and appends history — nothing is deleted', async () => {
    prisma.emergencyAlert.findUnique.mockResolvedValue({ id: 'a1', userId: 'u1', status: 'confirmed' });
    prisma.emergencyAlert.update.mockResolvedValue({ id: 'a1', userId: 'u1', status: 'false_alarm' });

    await service.cancelSosAlert('u1', 'a1');

    expect(prisma.emergencyAlert.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: expect.objectContaining({ status: 'false_alarm', closedAt: expect.any(Date) }),
    });
    expect(prisma.alertStatusEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ alertId: 'a1', fromStatus: 'confirmed', toStatus: 'false_alarm', actorKind: 'user', actorId: 'u1' }),
    });
    expectNothingDeleted(prisma);
  });

  it('cancelling a soft alert appends a soft-cancel event', async () => {
    prisma.emergencyAlert.findUnique.mockResolvedValue({ id: 'a1', userId: 'u1', status: 'created' });
    prisma.emergencyAlert.updateMany.mockResolvedValue({ count: 1 });

    await service.cancelSoftAlert('u1', 'a1');

    expect(prisma.alertStatusEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ fromStatus: 'created', toStatus: 'false_alarm', actorKind: 'user' }),
    });
    expectNothingDeleted(prisma);
  });

  it('resolving appends a resolved event', async () => {
    prisma.emergencyAlert.findUnique.mockResolvedValue({ id: 'a1', userId: 'u1', status: 'in_progress' });
    prisma.emergencyAlert.update.mockResolvedValue({ id: 'a1', status: 'resolved' });

    await service.resolveOwnAlert('u1', 'a1');

    expect(prisma.alertStatusEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ fromStatus: 'in_progress', toStatus: 'resolved', actorKind: 'user' }),
    });
    expectNothingDeleted(prisma);
  });

  it('auto-escalation is recorded as a system event', async () => {
    const soft = { id: 'a1', userId: 'u1', status: 'created', type: 'sensor_triggered', latitude: 1, longitude: 1 };
    prisma.emergencyAlert.findUnique
      .mockResolvedValueOnce(soft)
      .mockResolvedValueOnce({ ...soft, status: 'confirmed' });
    prisma.emergencyAlert.updateMany.mockResolvedValue({ count: 1 });
    prisma.subscription = { findUnique: vi.fn().mockResolvedValue(null) };

    await expect(service.autoEscalateSoftAlert('a1', 'u1')).resolves.toBe(true);

    expect(prisma.alertStatusEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ fromStatus: 'created', toStatus: 'confirmed', actorKind: 'system', actorId: null }),
    });
  });
});

describe('Admin — SOS reports', () => {
  let prisma: any;
  let repo: AdminRepository;
  let service: AdminService;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = makePrisma();
    repo = new AdminRepository(prisma, prisma, log);
    service = new AdminService(repo, { log, redis: { del: vi.fn() }, io: { to: vi.fn().mockReturnThis(), emit: vi.fn() } } as any);
  });

  it('the list includes cancelled, false-alarm and resolved alerts (no status filter by default)', async () => {
    const rows = [
      { id: '1', status: 'cancelled' },
      { id: '2', status: 'false_alarm' },
      { id: '3', status: 'resolved' },
      { id: '4', status: 'confirmed' },
    ];
    prisma.emergencyAlert.findMany.mockResolvedValue(rows);
    prisma.emergencyAlert.count.mockResolvedValue(4);

    const r = await service.listAlerts({});

    expect(r.data.map((a: any) => a.status)).toEqual(['cancelled', 'false_alarm', 'resolved', 'confirmed']);
    expect(r.total).toBe(4);
    const args = prisma.emergencyAlert.findMany.mock.calls[0][0];
    expect(args.where).toEqual({});
    expect(args.take).toBe(50);
    expect(args.skip).toBe(0);
  });

  it('applies status, type, date-range and name/phone filters with pagination', async () => {
    await service.listAlerts({
      status: 'cancelled,false_alarm', type: 'manual', from: '2026-10-01', to: '2026-10-14',
      search: ' Rina ', limit: 25, offset: 50,
    });

    const args = prisma.emergencyAlert.findMany.mock.calls[0][0];
    expect(args.where.status).toEqual({ in: ['cancelled', 'false_alarm'] });
    expect(args.where.type).toEqual({ in: ['manual'] });
    expect(args.where.createdAt.gte.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(args.where.createdAt.lte.toISOString()).toBe('2026-10-14T23:59:59.999Z');
    expect(args.where.user.OR).toEqual([
      { phone: { contains: 'Rina', mode: 'insensitive' } },
      { profile: { fullName: { contains: 'Rina', mode: 'insensitive' } } },
    ]);
    expect(args.take).toBe(25);
    expect(args.skip).toBe(50);
    expect(prisma.emergencyAlert.count).toHaveBeenCalledWith({ where: args.where });
  });

  it('rejects unknown statuses and clamps the page size', () => {
    expect(() => toAlertFilters({ status: 'deleted' })).toThrow(ValidationError);
    expect(toAlertFilters({ limit: 10_000 }).limit).toBe(200);
  });

  it('detail returns the status timeline (oldest first) and counts', async () => {
    prisma.emergencyAlert.findUnique.mockResolvedValue({
      id: 'a1', status: 'false_alarm',
      statusEvents: [
        { id: 'e1', fromStatus: null, toStatus: 'confirmed', createdAt: new Date('2026-10-01T10:00:00Z') },
        { id: 'e2', fromStatus: 'confirmed', toStatus: 'false_alarm', createdAt: new Date('2026-10-01T10:05:00Z') },
      ],
      recipients: [],
      notificationLogs: [{ id: 'n1', recipient: 'ExponentPushToken[abcdefghijklmnop]' }, { id: 'n2', recipient: '+8801711111111' }],
      _count: { evidence: 2, locationUpdates: 9, recipients: 1, responderDispatches: 0, notificationLogs: 2, cases: 0 },
    });

    const d: any = await service.getAlertById('a1');

    const include = prisma.emergencyAlert.findUnique.mock.calls[0][0].include;
    expect(include.statusEvents).toEqual({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    expect(d.statusEvents.map((e: any) => e.toStatus)).toEqual(['confirmed', 'false_alarm']);
    expect(d.counts).toMatchObject({ evidence: 2, notifications: 2 });
    expect(d.notificationLogs[0].recipient).toBe('…lmnop]');
    expect(d.notificationLogs[1].recipient).toBe('+8801711111111');
  });

  it('an admin status update appends an admin event carrying the note', async () => {
    prisma.emergencyAlert.findUnique.mockResolvedValue({
      id: 'a1', status: 'confirmed', statusEvents: [], recipients: [], notificationLogs: [], _count: {},
    });
    prisma.emergencyAlert.update.mockResolvedValue({ id: 'a1', status: 'resolved' });

    await service.setAlertStatus({ id: 'admin-1', permissions: [] }, 'a1', 'resolved', 'Family reached her');

    expect(prisma.alertStatusEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        alertId: 'a1', fromStatus: 'confirmed', toStatus: 'resolved',
        actorKind: 'admin', actorId: 'admin-1', reason: 'Family reached her',
      }),
    });
    expectNothingDeleted(prisma);
  });
});
