import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CasesService } from '../cases.service';
import { CasesRepository } from '../cases.repository';
import { FastifyInstance } from 'fastify';

describe('CasesService', () => {
  let service: CasesService;
  let mockRepo: any;
  let mockFastify: any;

  beforeEach(() => {
    mockRepo = {
      createCase: vi.fn(),
      findCaseById: vi.fn(),
      updateCaseStatus: vi.fn(),
      getCaseUpdates: vi.fn().mockResolvedValue([]),
      getAlertLocations: vi.fn().mockResolvedValue([]),
      getAlertEvidence: vi.fn().mockResolvedValue([]),
    };
    mockFastify = {
      log: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      // Case numbers now come from the case_number_seq sequence rather than
      // from random hex, so the service needs a queryable Prisma client.
      prisma: {
        $queryRaw: vi.fn().mockResolvedValue([{ n: BigInt(42) }]),
      },
    };
    service = new CasesService(mockRepo as unknown as CasesRepository, mockFastify as unknown as FastifyInstance);
  });

  describe('createCaseFromAlert', () => {
    it('allocates a sequential case number and creates a case', async () => {
      mockRepo.createCase.mockResolvedValue({ id: 'case-123', caseNumber: 'CASE-2026-000042' });

      const result = await service.createCaseFromAlert('alert-1', 'station-1');

      expect(mockRepo.createCase).toHaveBeenCalledWith(
        'alert-1',
        'station-1',
        expect.stringMatching(/^CASE-\d{4}-\d{6}$/),
      );
      expect(mockRepo.createCase).toHaveBeenCalledWith(
        'alert-1',
        'station-1',
        'CASE-' + new Date().getFullYear() + '-000042',
      );
      expect(result.id).toBe('case-123');
    });

    it('never reuses a number, because the sequence never repeats', async () => {
      mockFastify.prisma.$queryRaw
        .mockResolvedValueOnce([{ n: BigInt(1) }])
        .mockResolvedValueOnce([{ n: BigInt(2) }]);
      mockRepo.createCase.mockResolvedValue({ id: 'c' });

      await service.createCaseFromAlert('alert-1', 'station-1');
      await service.createCaseFromAlert('alert-2', 'station-1');

      const first = mockRepo.createCase.mock.calls[0][2];
      const second = mockRepo.createCase.mock.calls[1][2];
      expect(first).not.toBe(second);
    });
  });

  describe('getCaseTimeline', () => {
    it('aggregates and sorts timeline items', async () => {
      const mockCase = { id: 'case-1', alertId: 'alert-1', stationId: 'station-1', status: 'open' };
      mockRepo.findCaseById.mockResolvedValue(mockCase);

      const d1 = new Date('2026-01-01T10:00:00Z');
      const d2 = new Date('2026-01-01T10:05:00Z');
      const d3 = new Date('2026-01-01T10:10:00Z');

      mockRepo.getCaseUpdates.mockResolvedValue([{ id: 'u1', createdAt: d2, note: 'Update' }]);
      mockRepo.getAlertLocations.mockResolvedValue([{ id: 'l1', timestamp: d1, latitude: 1, longitude: 1 }]);
      mockRepo.getAlertEvidence.mockResolvedValue([{ id: 'e1', uploadedAt: d3, fileType: 'image' }]);

      const { case: c, timeline } = await service.getCaseTimeline('case-1', 'station-1');

      expect(c).toBe(mockCase);
      expect(timeline).toHaveLength(3);
      // Should be sorted desc
      expect(timeline[0].timestamp).toEqual(d3);
      expect(timeline[0].type).toBe('evidence');
      
      expect(timeline[1].timestamp).toEqual(d2);
      expect(timeline[1].type).toBe('update');

      expect(timeline[2].timestamp).toEqual(d1);
      expect(timeline[2].type).toBe('location');
    });
  });

  describe('updateStatus', () => {
    it('throws if case is closed', async () => {
      mockRepo.findCaseById.mockResolvedValue({ id: 'case-1', stationId: 'station-1', status: 'closed' });
      
      await expect(service.updateStatus('case-1', 'in_progress', 'officer-1', 'station-1')).rejects.toThrow('Cannot modify closed case');
    });

    it('should throw ForbiddenError if stationId does not match', async () => {
      mockRepo.findCaseById.mockResolvedValue({ status: 'open', stationId: 'station-2' } as any);

      await expect(service.updateStatus('case-1', 'in_progress', 'officer-1', 'station-1')).rejects.toThrow('Case belongs to another station');
    });
  });
});
