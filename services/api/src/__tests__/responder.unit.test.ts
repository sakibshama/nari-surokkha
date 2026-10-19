import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ResponderService, toDispatchView } from '../modules/responder/responder.service';
import type { ResponderRepository } from '../modules/responder/responder.repository';
import {
  DISPATCH_TRANSITIONS,
  closeDispatchesForAlert,
  effectiveDispatchStatus,
} from '../modules/responder/dispatch-lifecycle';

function httpError(statusCode: number) {
  return (message: string) => Object.assign(new Error(message), { statusCode });
}

type Fn = ReturnType<typeof vi.fn>;

/** A dispatch row as getDispatchById returns it. */
function dispatchRow(over: Record<string, unknown> = {}, alertOver: Record<string, unknown> = {}) {
  return {
    id: 'd1',
    alertId: 'a1',
    responderId: 'r1',
    status: 'pending',
    dispatchedAt: new Date('2026-10-19T10:00:00Z'),
    acceptedAt: null,
    rejectedAt: null,
    arrivedAt: null,
    completedAt: null,
    withdrawnAt: null,
    closedAt: null,
    distanceMeters: 420,
    responder: { id: 'r1', userId: 'u1', status: 'verified' },
    alert: {
      id: 'a1',
      userId: 'victim',
      status: 'confirmed',
      latitude: 23.78912,
      longitude: 90.41234,
      user: { phone: '+8801700000000', profile: { fullName: 'Rina', bloodGroup: 'B+' } },
      ...alertOver,
    },
    ...over,
  };
}

describe('ResponderService', () => {
  let repo: Record<string, Fn>;
  let prisma: {
    auditLog: { create: Fn };
    responderDispatch: { update: Fn; findMany: Fn; updateMany: Fn };
    responder: { update: Fn; updateMany: Fn };
    emergencyAlert: { updateMany: Fn; findUnique: Fn };
    alertStatusEvent: { create: Fn };
    $transaction: Fn;
  };
  let io: { to: Fn; emit: Fn };
  let fastify: FastifyInstance;
  let service: ResponderService;

  beforeEach(() => {
    repo = {
      getDispatchById: vi.fn(),
      transitionDispatch: vi.fn().mockResolvedValue(true),
      markBusy: vi.fn().mockResolvedValue(undefined),
      getDispatchesForResponder: vi.fn().mockResolvedValue([]),
      getResponderByUserId: vi.fn().mockResolvedValue({ id: 'r1', userId: 'u1' }),
      updateLocationAndAvailability: vi.fn().mockResolvedValue({ id: 'r1' }),
    };
    prisma = {
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      responderDispatch: {
        update: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      responder: {
        update: vi.fn().mockResolvedValue({ id: 'r1', reputationScore: 10 }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      emergencyAlert: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue({ id: 'a1', status: 'in_progress' }),
      },
      alertStatusEvent: { create: vi.fn().mockResolvedValue({}) },
      $transaction: vi.fn(),
    };
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
    io = { to: vi.fn(), emit: vi.fn() };
    io.to.mockReturnValue(io);
    fastify = {
      prisma,
      io,
      redis: { del: vi.fn().mockResolvedValue(1) },
      log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
      httpErrors: {
        notFound: httpError(404),
        forbidden: httpError(403),
        conflict: httpError(409),
        badRequest: httpError(400),
      },
    } as unknown as FastifyInstance;
    service = new ResponderService(repo as unknown as ResponderRepository, fastify);
  });

  /** getDispatchById: first the row as read, then the row after the write. */
  function readsAs(before: ReturnType<typeof dispatchRow>, after?: ReturnType<typeof dispatchRow>) {
    repo.getDispatchById.mockResolvedValueOnce(before).mockResolvedValueOnce(after ?? before);
  }

  it('accepting a dispatch writes a valid audit row (metadata, known action)', async () => {
    readsAs(dispatchRow(), dispatchRow({ status: 'accepted', acceptedAt: new Date() }));

    await service.respondToDispatch('u1', 'd1', 'accept');

    const { data } = prisma.auditLog.create.mock.calls[0][0];
    expect(data.action).toBe('alert_acknowledged');
    expect(data.metadata).toMatchObject({ alertId: 'a1', responderId: 'r1' });
    expect(data).not.toHaveProperty('details');
  });

  it('rejects a dispatch that belongs to another responder (403, nothing written)', async () => {
    repo.getDispatchById.mockResolvedValue(
      dispatchRow({ responderId: 'r2', responder: { id: 'r2', userId: 'other', status: 'verified' } }),
    );
    for (const action of ['accept', 'reject', 'arrive', 'complete', 'withdraw'] as const) {
      await expect(service.respondToDispatch('u1', 'd1', action)).rejects.toMatchObject({ statusCode: 403 });
    }
    expect(repo.transitionDispatch).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('404 for an unknown dispatch', async () => {
    repo.getDispatchById.mockResolvedValue(null);
    await expect(service.respondToDispatch('u1', 'nope', 'accept')).rejects.toMatchObject({ statusCode: 404 });
  });

  describe('dispatch state transitions', () => {
    it('accept: pending → accepted, conditional on pending; reveals the precise location', async () => {
      readsAs(dispatchRow(), dispatchRow({ status: 'accepted', acceptedAt: new Date() }));

      const view = await service.respondToDispatch('u1', 'd1', 'accept');

      expect(repo.transitionDispatch).toHaveBeenCalledWith(
        'd1', ['pending'], expect.objectContaining({ status: 'accepted', acceptedAt: expect.any(Date) }),
      );
      expect(view.status).toBe('accepted');
      expect(view.alert).toMatchObject({
        precise: true, latitude: 23.78912, longitude: 90.41234, victimName: 'Rina', victimPhone: '+8801700000000',
      });
      expect(repo.markBusy).toHaveBeenCalledWith('r1');
    });

    it('first accept moves the SOS to in_progress and records it in the status history', async () => {
      readsAs(dispatchRow(), dispatchRow({ status: 'accepted' }));

      await service.respondToDispatch('u1', 'd1', 'accept');

      expect(prisma.emergencyAlert.updateMany).toHaveBeenCalledWith({
        where: { id: 'a1', status: { in: ['confirmed', 'notified_contacts'] } },
        data: { status: 'in_progress' },
      });
      expect(prisma.alertStatusEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          alertId: 'a1', fromStatus: 'confirmed', toStatus: 'in_progress', actorKind: 'user', actorId: 'u1',
        }),
      });
      // The victim's screen and the admin view hear it.
      expect(io.to).toHaveBeenCalledWith(['alert:a1', 'admin:global']);
      expect(io.emit).toHaveBeenCalledWith('responder:dispatch_update',
        expect.objectContaining({ alertId: 'a1', dispatchId: 'd1', status: 'accepted' }));
      expect(io.emit).toHaveBeenCalledWith('alert_status_update', { alertId: 'a1', status: 'in_progress' });
    });

    it('a second responder accepting an in_progress SOS succeeds without another history row', async () => {
      readsAs(dispatchRow({}, { status: 'in_progress' }), dispatchRow({ status: 'accepted' }, { status: 'in_progress' }));

      const view = await service.respondToDispatch('u1', 'd1', 'accept');

      expect(view.status).toBe('accepted');
      expect(prisma.emergencyAlert.updateMany).not.toHaveBeenCalled();
      expect(prisma.alertStatusEvent.create).not.toHaveBeenCalled();
    });

    it('double accept → 409 DISPATCH_STATE, no second side effects', async () => {
      repo.getDispatchById.mockResolvedValue(dispatchRow({ status: 'accepted', acceptedAt: new Date() }));

      await expect(service.respondToDispatch('u1', 'd1', 'accept'))
        .rejects.toMatchObject({ statusCode: 409, code: 'DISPATCH_STATE' });
      expect(repo.transitionDispatch).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
      expect(io.emit).not.toHaveBeenCalled();
    });

    it('a concurrent request that wins the race → the loser gets 409, not 500', async () => {
      // Both read 'pending'; the conditional UPDATE matches 0 rows for the loser.
      repo.getDispatchById
        .mockResolvedValueOnce(dispatchRow())
        .mockResolvedValueOnce(dispatchRow({ status: 'declined' }));
      repo.transitionDispatch.mockResolvedValue(false);

      await expect(service.respondToDispatch('u1', 'd1', 'accept'))
        .rejects.toMatchObject({ statusCode: 409, code: 'DISPATCH_STATE' });
      expect(repo.markBusy).not.toHaveBeenCalled();
    });

    it('reject: pending → declined with the reason; not announced to the victim', async () => {
      readsAs(dispatchRow(), dispatchRow({ status: 'declined', rejectedAt: new Date() }));

      const view = await service.respondToDispatch('u1', 'd1', 'reject', 'Too far');

      expect(repo.transitionDispatch).toHaveBeenCalledWith(
        'd1', ['pending'], expect.objectContaining({ status: 'declined', rejectReason: 'Too far' }),
      );
      expect(view.status).toBe('declined');
      expect(view.alert.precise).toBe(false);
      expect(io.emit).not.toHaveBeenCalled();
    });

    it('reject after accepting → 409 (withdraw is the action for that)', async () => {
      repo.getDispatchById.mockResolvedValue(dispatchRow({ status: 'accepted' }));
      await expect(service.respondToDispatch('u1', 'd1', 'reject')).rejects.toMatchObject({ statusCode: 409 });
    });

    it('arrive: only from accepted', async () => {
      readsAs(dispatchRow({ status: 'accepted' }, { status: 'in_progress' }),
        dispatchRow({ status: 'arrived' }, { status: 'in_progress' }));
      const view = await service.respondToDispatch('u1', 'd1', 'arrive');
      expect(repo.transitionDispatch).toHaveBeenCalledWith(
        'd1', ['accepted'], expect.objectContaining({ status: 'arrived', arrivedAt: expect.any(Date) }),
      );
      expect(view.status).toBe('arrived');

      repo.getDispatchById.mockReset().mockResolvedValue(dispatchRow({ status: 'pending' }));
      await expect(service.respondToDispatch('u1', 'd1', 'arrive')).rejects.toMatchObject({ statusCode: 409 });
    });

    it('complete: from accepted or arrived, frees the responder', async () => {
      readsAs(dispatchRow({ status: 'arrived' }, { status: 'in_progress' }),
        dispatchRow({ status: 'completed' }, { status: 'in_progress' }));
      const view = await service.respondToDispatch('u1', 'd1', 'complete');
      expect(repo.transitionDispatch).toHaveBeenCalledWith(
        'd1', ['accepted', 'arrived'], expect.objectContaining({ status: 'completed', completedAt: expect.any(Date) }),
      );
      expect(view.status).toBe('completed');
      expect(prisma.responder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ id: 'r1', availability: 'busy' }),
        data: { availability: 'available' },
      }));

      repo.getDispatchById.mockReset().mockResolvedValue(dispatchRow({ status: 'pending' }));
      await expect(service.respondToDispatch('u1', 'd1', 'complete')).rejects.toMatchObject({ statusCode: 409 });
    });

    it('withdraw: cancels an acceptance, masks the location again, frees the responder', async () => {
      readsAs(dispatchRow({ status: 'accepted' }, { status: 'in_progress' }),
        dispatchRow({ status: 'withdrawn' }, { status: 'in_progress' }));
      const view = await service.respondToDispatch('u1', 'd1', 'withdraw');
      expect(view.status).toBe('withdrawn');
      expect(view.alert).toMatchObject({ precise: false, latitude: 23.79, longitude: 90.41, victimName: null, victimPhone: null });
      expect(prisma.responder.updateMany).toHaveBeenCalled();
      expect(io.emit).toHaveBeenCalledWith('responder:dispatch_update', expect.objectContaining({ status: 'withdrawn' }));
    });

    it('acting on a dispatch whose SOS was cancelled → 409 SOS_ENDED and the dispatch is closed', async () => {
      repo.getDispatchById.mockResolvedValue(dispatchRow({}, { status: 'false_alarm' }));
      prisma.responderDispatch.findMany.mockResolvedValue([
        { id: 'd1', responderId: 'r1', status: 'pending', responder: { userId: 'u1' } },
      ]);

      await expect(service.respondToDispatch('u1', 'd1', 'accept'))
        .rejects.toMatchObject({ statusCode: 409, code: 'SOS_ENDED' });
      expect(repo.transitionDispatch).not.toHaveBeenCalled();
      expect(prisma.responderDispatch.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['d1'] }, status: { in: ['pending', 'accepted', 'arrived'] } },
        data: { status: 'closed', closedAt: expect.any(Date) },
      });
    });

    it('an already-closed dispatch → 409 SOS_ENDED for every action', async () => {
      repo.getDispatchById.mockResolvedValue(dispatchRow({ status: 'closed' }, { status: 'resolved' }));
      for (const action of ['accept', 'reject', 'arrive', 'complete', 'withdraw'] as const) {
        await expect(service.respondToDispatch('u1', 'd1', action))
          .rejects.toMatchObject({ statusCode: 409, code: 'SOS_ENDED' });
      }
    });

    it('the SOS closing between the read and the write → 409 SOS_ENDED', async () => {
      repo.getDispatchById
        .mockResolvedValueOnce(dispatchRow())
        .mockResolvedValueOnce(dispatchRow({ status: 'closed' }, { status: 'resolved' }));
      repo.transitionDispatch.mockResolvedValue(false);
      await expect(service.respondToDispatch('u1', 'd1', 'accept'))
        .rejects.toMatchObject({ statusCode: 409, code: 'SOS_ENDED' });
    });

    it('a user can never act on a dispatch for their own SOS (409 OWN_ALERT, dispatch closed)', async () => {
      repo.getDispatchById.mockResolvedValue(dispatchRow({}, { userId: 'u1' }));
      await expect(service.respondToDispatch('u1', 'd1', 'accept'))
        .rejects.toMatchObject({ statusCode: 409, code: 'OWN_ALERT' });
      expect(repo.transitionDispatch).toHaveBeenCalledTimes(1);
      expect(repo.transitionDispatch).toHaveBeenCalledWith(
        'd1', ['pending', 'accepted', 'arrived'], expect.objectContaining({ status: 'closed' }),
      );
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('a suspended responder cannot act (403)', async () => {
      repo.getDispatchById.mockResolvedValue(
        dispatchRow({ responder: { id: 'r1', userId: 'u1', status: 'suspended' } }),
      );
      await expect(service.respondToDispatch('u1', 'd1', 'accept')).rejects.toMatchObject({ statusCode: 403 });
    });

    it('a failing side effect never turns a successful transition into an error', async () => {
      readsAs(dispatchRow(), dispatchRow({ status: 'accepted' }));
      prisma.auditLog.create.mockRejectedValue(new Error('db hiccup'));
      await expect(service.respondToDispatch('u1', 'd1', 'accept')).resolves.toMatchObject({ status: 'accepted' });
    });
  });

  describe('getMyDispatches', () => {
    it("never lists the responder's own SOS, and masks pending dispatches", async () => {
      repo.getDispatchesForResponder.mockResolvedValue([
        dispatchRow({ id: 'own' }, { userId: 'u1' }),
        dispatchRow({ id: 'other' }),
      ]);
      const list = await service.getMyDispatches('u1');
      expect(repo.getDispatchesForResponder).toHaveBeenCalledWith('r1', 'u1');
      expect(list.map((d) => d.id)).toEqual(['other']);
      expect(list[0].alert).toMatchObject({ precise: false, latitude: 23.79, longitude: 90.41, victimName: null, userId: 'victim' });
    });

    it('an open dispatch whose SOS has ended is reported closed', async () => {
      repo.getDispatchesForResponder.mockResolvedValue([
        dispatchRow({ status: 'accepted' }, { status: 'resolved' }),
      ]);
      const [d] = await service.getMyDispatches('u1');
      expect(d.status).toBe('closed');
      expect(d.alert.precise).toBe(false);
    });

    it('404 when the user is not a responder', async () => {
      repo.getResponderByUserId.mockResolvedValue(null);
      await expect(service.getMyDispatches('u1')).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('closeDispatchesForAlert (SOS cancelled / resolved)', () => {
    it('closes every open dispatch, frees engaged responders, tells each responder app', async () => {
      prisma.responderDispatch.findMany.mockResolvedValue([
        { id: 'd1', responderId: 'r1', status: 'pending', responder: { userId: 'u1' } },
        { id: 'd2', responderId: 'r2', status: 'accepted', responder: { userId: 'u2' } },
      ]);

      const n = await closeDispatchesForAlert(fastify, 'a1', 'false_alarm');

      expect(n).toBe(2);
      expect(prisma.responderDispatch.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['d1', 'd2'] }, status: { in: ['pending', 'accepted', 'arrived'] } },
        data: { status: 'closed', closedAt: expect.any(Date) },
      });
      // Only the engaged responder was busy.
      expect(prisma.responder.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.responder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ id: 'r2' }),
      }));
      expect(io.to).toHaveBeenCalledWith('user:u1');
      expect(io.to).toHaveBeenCalledWith('user:u2');
      expect(io.emit).toHaveBeenCalledWith('responder:dispatch_closed',
        expect.objectContaining({ dispatchId: 'd2', alertId: 'a1', status: 'closed', alertStatus: 'false_alarm' }));
    });

    it('never throws (ending an SOS must not fail because of it)', async () => {
      prisma.responderDispatch.findMany.mockRejectedValue(new Error('db down'));
      await expect(closeDispatchesForAlert(fastify, 'a1', 'resolved')).resolves.toBe(0);
    });
  });

  it('verifying a dispatch writes a valid audit row', async () => {
    repo.getDispatchById.mockResolvedValue({ id: 'd1', verifiedAt: null });
    prisma.responderDispatch.update.mockResolvedValue({
      id: 'd1', responderId: 'r1', responder: { reputationScore: 45, badges: [] },
    });

    await service.verifyDispatch('admin-1', 'd1');

    expect(prisma.responder.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { reputationScore: 55, badges: ['Verified Protector'] },
    });
    const { data } = prisma.auditLog.create.mock.calls[0][0];
    expect(data.action).toBe('responder_approved');
    expect(data.metadata).toMatchObject({ newScore: 55 });
    expect(data).not.toHaveProperty('details');
  });

  describe('updateLocation', () => {
    it("maps 'online' to the enum's 'available'", async () => {
      await service.updateLocation('u1', { latitude: 23.8, longitude: 90.4, availability: 'online' });
      expect(repo.updateLocationAndAvailability).toHaveBeenCalledWith(
        'r1', { latitude: 23.8, longitude: 90.4 }, 'available',
      );
    });

    it('going offline without a fix never writes 0,0', async () => {
      await service.updateLocation('u1', { availability: 'offline' });
      expect(repo.updateLocationAndAvailability).toHaveBeenCalledWith('r1', null, 'offline');

      await service.updateLocation('u1', { latitude: 0, longitude: 0, availability: 'offline' });
      expect(repo.updateLocationAndAvailability).toHaveBeenLastCalledWith('r1', null, 'offline');
    });

    it('requires coordinates unless going offline', async () => {
      await expect(service.updateLocation('u1', { availability: 'online' })).rejects.toMatchObject({ statusCode: 400 });
      await expect(service.updateLocation('u1', {})).rejects.toMatchObject({ statusCode: 400 });
      expect(repo.updateLocationAndAvailability).not.toHaveBeenCalled();
    });
  });
});

describe('dispatch lifecycle rules', () => {
  it('every action has exactly the documented from-states', () => {
    expect(DISPATCH_TRANSITIONS.accept.from).toEqual(['pending']);
    expect(DISPATCH_TRANSITIONS.reject.from).toEqual(['pending']);
    expect(DISPATCH_TRANSITIONS.arrive.from).toEqual(['accepted']);
    expect(DISPATCH_TRANSITIONS.complete.from).toEqual(['accepted', 'arrived']);
    expect(DISPATCH_TRANSITIONS.withdraw.from).toEqual(['accepted', 'arrived']);
  });

  it('open dispatches of an ended SOS are closed; final states stay', () => {
    expect(effectiveDispatchStatus('pending', false)).toBe('closed');
    expect(effectiveDispatchStatus('arrived', false)).toBe('closed');
    expect(effectiveDispatchStatus('completed', false)).toBe('completed');
    expect(effectiveDispatchStatus('pending', true)).toBe('pending');
  });

  it('toDispatchView reveals identity only while accepted / arrived / completed', () => {
    const v = toDispatchView(dispatchRow({ status: 'completed' }, { status: 'resolved' }) as never);
    expect(v.alert).toMatchObject({ precise: true, victimName: 'Rina', bloodGroup: 'B+' });
  });
});
