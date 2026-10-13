import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IncidentsService } from '../modules/incidents/incidents.service';
import { IncidentsRepository } from '../modules/incidents/incidents.repository';
import { FastifyInstance } from 'fastify';
import { IncidentReport, Prisma } from '@prisma/client';

// Mock repository
const mockRepository = {
  createIncident: vi.fn(),
  getIncidentsByStatus: vi.fn(),
  updateIncidentStatus: vi.fn(),
  getVerifiedIncidentsInRadius: vi.fn(),
} as unknown as IncidentsRepository;

describe('IncidentsService - Safety Score Calculation', () => {
  let service: IncidentsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new IncidentsService(mockRepository, {} as FastifyInstance);
  });

  it('should return a perfect score of 100 when there are no verified incidents', async () => {
    vi.mocked(mockRepository.getVerifiedIncidentsInRadius).mockResolvedValue([]);

    const result = await service.calculateSafetyScore(23.8103, 90.4125);

    expect(result.score).toBe(100);
    expect(result.factors.total_deductions).toBe(0);
  });

  it('should deduct points correctly based on incident types', async () => {
    vi.mocked(mockRepository.getVerifiedIncidentsInRadius).mockResolvedValue([
      { id: '1', type: 'robbery', status: 'verified', latitude: new Prisma.Decimal(0), longitude: new Prisma.Decimal(0), createdAt: new Date(), updatedAt: new Date(), description: '' } as IncidentReport,
      { id: '2', type: 'harassment', status: 'verified', latitude: new Prisma.Decimal(0), longitude: new Prisma.Decimal(0), createdAt: new Date(), updatedAt: new Date(), description: '' } as IncidentReport,
      { id: '3', type: 'poor_lighting', status: 'verified', latitude: new Prisma.Decimal(0), longitude: new Prisma.Decimal(0), createdAt: new Date(), updatedAt: new Date(), description: '' } as IncidentReport,
    ]);

    const result = await service.calculateSafetyScore(23.8103, 90.4125);

    // 100 - 20 (robbery) - 15 (harassment) - 5 (poor lighting) = 60
    expect(result.score).toBe(60);
    expect(result.factors.robbery).toBe(1);
    expect(result.factors.harassment).toBe(1);
    expect(result.factors.poor_lighting).toBe(1);
    expect(result.factors.total_deductions).toBe(40);
  });

  it('should never drop below a score of 0', async () => {
    const incidents = Array(10).fill({
      id: '1', type: 'robbery', status: 'verified', latitude: new Prisma.Decimal(0), longitude: new Prisma.Decimal(0), createdAt: new Date(), updatedAt: new Date(), description: ''
    }) as IncidentReport[];

    vi.mocked(mockRepository.getVerifiedIncidentsInRadius).mockResolvedValue(incidents);

    const result = await service.calculateSafetyScore(23.8103, 90.4125);

    // 10 * -20 = -200 points. Base is 100. So it should be capped at 0.
    expect(result.score).toBe(0);
    expect(result.factors.total_deductions).toBe(200);
  });
});

describe('IncidentsService - location privacy', () => {
  it('fuzzes the reported location once, to 3 decimal places (~110 m)', async () => {
    vi.mocked(mockRepository.createIncident).mockResolvedValue({ id: 'i1' } as IncidentReport);
    const service = new IncidentsService(mockRepository, {} as FastifyInstance);

    await service.submitIncident('harassment', 23.810349, 90.412549);

    expect(mockRepository.createIncident).toHaveBeenCalledWith('harassment', 23.81, 90.413, undefined);
  });
});
