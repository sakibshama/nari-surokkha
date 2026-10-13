import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ResponderService } from '../modules/responder/responder.service';
import type { ResponderRepository } from '../modules/responder/responder.repository';

function httpError(statusCode: number) {
  return (message: string) => Object.assign(new Error(message), { statusCode });
}

describe('ResponderService', () => {
  let repo: Record<string, ReturnType<typeof vi.fn>>;
  let prisma: {
    auditLog: { create: ReturnType<typeof vi.fn> };
    responderDispatch: { update: ReturnType<typeof vi.fn> };
    responder: { update: ReturnType<typeof vi.fn> };
  };
  let service: ResponderService;

  beforeEach(() => {
    repo = {
      getDispatchById: vi.fn(),
      updateDispatchResponse: vi.fn().mockResolvedValue({ id: 'd1' }),
      getResponderByUserId: vi.fn().mockResolvedValue({ id: 'r1', userId: 'u1' }),
      updateLocationAndAvailability: vi.fn().mockResolvedValue({ id: 'r1' }),
    };
    prisma = {
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      responderDispatch: { update: vi.fn() },
      responder: { update: vi.fn().mockResolvedValue({ id: 'r1', reputationScore: 10 }) },
    };
    const fastify = {
      prisma,
      io: undefined,
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

  it('accepting a dispatch writes a valid audit row (metadata, known action)', async () => {
    repo.getDispatchById.mockResolvedValue({
      id: 'd1', alertId: 'a1', responderId: 'r1', responder: { userId: 'u1' },
    });

    await service.respondToDispatch('u1', 'd1', 'accept');

    const { data } = prisma.auditLog.create.mock.calls[0][0];
    expect(data.action).toBe('alert_acknowledged');
    expect(data.metadata).toMatchObject({ alertId: 'a1', responderId: 'r1' });
    expect(data).not.toHaveProperty('details');
  });

  it('rejects a dispatch that belongs to another responder', async () => {
    repo.getDispatchById.mockResolvedValue({
      id: 'd1', alertId: 'a1', responderId: 'r2', responder: { userId: 'other' },
    });
    await expect(service.respondToDispatch('u1', 'd1', 'accept')).rejects.toMatchObject({ statusCode: 403 });
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
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
