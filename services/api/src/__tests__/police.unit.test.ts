import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PoliceService } from '@/modules/police/police.service';
import { PoliceRepository } from '@/modules/police/police.repository';
import argon2 from 'argon2';

vi.mock('argon2');

describe('PoliceService', () => {
  let repoMock: any;
  let fastifyMock: any;
  let service: PoliceService;

  beforeEach(() => {
    repoMock = {
      findPoliceUserByIdentifier: vi.fn(),
      getActiveAlertsForStation: vi.fn(),
      updateAlertStatus: vi.fn(),
      createCase: vi.fn(),
    };

    fastifyMock = {
      io: {
        to: vi.fn().mockReturnThis(),
        emit: vi.fn(),
      },
      // Case numbers come from case_number_seq, and the service checks for an
      // existing case before opening a new one.
      prisma: {
        case: { findFirst: vi.fn().mockResolvedValue(null) },
        $queryRaw: vi.fn().mockResolvedValue([{ n: BigInt(7) }]),
      },
    };

    service = new PoliceService(repoMock as unknown as PoliceRepository, fastifyMock);
  });

  it('throws error for invalid login badge', async () => {
    repoMock.findPoliceUserByIdentifier.mockResolvedValue(null);
    vi.mocked(argon2.verify).mockResolvedValue(false);

    await expect(service.login('invalid', 'pass')).rejects.toThrow('Invalid credentials.');
  });

  it('authenticates valid police user', async () => {
    repoMock.findPoliceUserByIdentifier.mockResolvedValue({
      id: 'police-1',
      badgeNumber: 'B-123',
      passwordHash: 'hash',
      role: 'officer',
      stationId: 'station-1',
      isActive: true,
    });
    vi.mocked(argon2.verify).mockResolvedValue(true);

    const result = await service.login('B-123', 'pass');
    expect(result.user.badgeNumber).toBe('B-123');
    expect(result.tokens.accessToken).toBeDefined();
  });

  it('updates alert status to in_progress and creates case', async () => {
    repoMock.updateAlertStatus.mockResolvedValue({ id: 'alert-1', status: 'in_progress' });

    await service.updateAlertStatus('alert-1', 'in_progress', 'station-1', 'police-1');

    expect(repoMock.updateAlertStatus).toHaveBeenCalledWith('alert-1', 'in_progress');
    // The case number is now allocated from the sequence and passed in, rather
    // than minted inside the repository from Date.now().
    expect(repoMock.createCase).toHaveBeenCalledWith(
      'alert-1',
      'station-1',
      'police-1',
      expect.stringMatching(/^CASE-\d{4}-\d{6}$/),
    );
    expect(fastifyMock.io.to).toHaveBeenCalledWith('station:station-1');
    expect(fastifyMock.io.emit).toHaveBeenCalledWith('alert_status_update', expect.any(Object));
  });

  it('does not open a second case when the alert already has one', async () => {
    repoMock.updateAlertStatus.mockResolvedValue({ id: 'alert-1', status: 'in_progress' });
    fastifyMock.prisma.case.findFirst.mockResolvedValue({ id: 'existing-case' });

    await service.updateAlertStatus('alert-1', 'in_progress', 'station-1', 'police-1');

    expect(repoMock.createCase).not.toHaveBeenCalled();
  });
});
