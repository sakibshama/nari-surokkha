import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IncidentsService } from '../modules/incidents/incidents.service';
import { IncidentsRepository } from '../modules/incidents/incidents.repository';

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
    service = new IncidentsService(mockRepository, undefined as any);
  });

  it('should return a perfect score of 100 when there are no verified incidents', async () => {
    vi.mocked(mockRepository.getVerifiedIncidentsInRadius).mockResolvedValue([]);

    const result = await service.calculateSafetyScore(23.8103, 90.4125);

    expect(result.score).toBe(100);
    expect(result.factors.total_deductions).toBe(0);
  });

  it('should deduct points correctly based on incident types', async () => {
    vi.mocked(mockRepository.getVerifiedIncidentsInRadius).mockResolvedValue([
      { id: '1', type: 'robbery', status: 'verified', latitude: 0, longitude: 0, createdAt: new Date(), updatedAt: new Date(), description: '' } as any,
      { id: '2', type: 'harassment', status: 'verified', latitude: 0, longitude: 0, createdAt: new Date(), updatedAt: new Date(), description: '' } as any,
      { id: '3', type: 'poor_lighting', status: 'verified', latitude: 0, longitude: 0, createdAt: new Date(), updatedAt: new Date(), description: '' } as any,
    ] as any);

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
      id: '1', type: 'robbery', status: 'verified', latitude: 0, longitude: 0, createdAt: new Date(), updatedAt: new Date(), description: ''
    });

    vi.mocked(mockRepository.getVerifiedIncidentsInRadius).mockResolvedValue(incidents);

    const result = await service.calculateSafetyScore(23.8103, 90.4125);

    // 10 * -20 = -200 points. Base is 100. So it should be capped at 0.
    expect(result.score).toBe(0);
    expect(result.factors.total_deductions).toBe(200);
  });
});
