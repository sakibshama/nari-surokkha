/**
 * Police Repository
 */

import { PrismaClient, PoliceUser, EmergencyAlert, Case } from '@prisma/client';

export class PoliceRepository {
  constructor(private readonly db: PrismaClient) {}

  async findPoliceUserByIdentifier(identifier: string): Promise<(PoliceUser & { station: any }) | null> {
    return this.db.policeUser.findFirst({
      where: {
        OR: [
          { badgeNumber: identifier },
          { phone: identifier },
          { email: identifier }
        ]
      },
      include: { station: true }
    });
  }

  async findPoliceUserById(id: string): Promise<PoliceUser | null> {
    return this.db.policeUser.findUnique({
      where: { id },
    });
  }

  async updatePoliceProfile(id: string, data: { phone?: string; email?: string }): Promise<PoliceUser> {
    return this.db.policeUser.update({
      where: { id },
      data: {
        ...(data.phone && { phone: data.phone }),
        ...(data.email !== undefined && { email: data.email || null }),
      },
    });
  }

  async updatePolicePassword(id: string, passwordHash: string): Promise<PoliceUser> {
    return this.db.policeUser.update({
      where: { id },
      data: { passwordHash },
    });
  }

  async getStations(): Promise<any[]> {
    return this.db.policeStation.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async getResponders(): Promise<any[]> {
    return this.db.responder.findMany({
      where: { status: 'verified' },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        user: {
          select: { phone: true, profile: { select: { fullName: true } } }
        }
      }
    });
  }

  /**
   * Active alerts for a station's dashboard.
   *
   * This had no `take` at all, so a busy station's dashboard fetched every
   * open alert plus a join to users and profiles, growing without limit. The
   * result also feeds a live map, so an unbounded response is a slow page at
   * exactly the moment it needs to be fast.
   *
   * Bounded and cursor-paginated. The (assigned_station_id, status,
   * created_at DESC) composite index added in 20260819000000 serves this
   * exactly.
   */
  async getActiveAlertsForStation(
    stationId: string,
    limit = 100,
    cursor?: string,
  ): Promise<EmergencyAlert[]> {
    return this.db.emergencyAlert.findMany({
      // Cursor pagination, not offset: OFFSET degrades badly past a few
      // thousand rows because Postgres still walks everything it skips.
      take: Math.min(limit, 200),
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      where: {
        assignedStationId: stationId,
        status: {
          in: ['created', 'confirmed', 'notified_contacts', 'sent_to_police', 'in_progress'],
        },
      },
      include: {
        user: {
          select: {
            id: true,
            phone: true,
            profile: {
              select: {
                fullName: true,
                bloodGroup: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async getAlertById(alertId: string, stationId: string): Promise<EmergencyAlert | null> {
    return this.db.emergencyAlert.findFirst({
      where: {
        id: alertId,
        assignedStationId: stationId,
      },
      include: {
        user: {
          select: {
            id: true,
            phone: true,
            profile: {
              select: {
                fullName: true,
                bloodGroup: true,
              },
            },
          },
        },
        responderDispatches: {
          include: {
            responder: {
              include: {
                user: { select: { profile: { select: { fullName: true } } } }
              }
            }
          }
        }
      },
    });
  }

  async updateAlertStatus(alertId: string, status: any): Promise<EmergencyAlert> {
    return this.db.emergencyAlert.update({
      where: { id: alertId },
      data: { status },
    });
  }

  /**
   * Create a minimal case with a caller-supplied case number.
   *
   * This used to mint its own `CASE-${Date.now()}`, a second and incompatible
   * numbering scheme competing with cases.service for the same UNIQUE column.
   * There is now exactly one allocator — CasesService.nextCaseNumber(), backed
   * by case_number_seq — and it is passed in.
   */
  async createCase(
    alertId: string,
    stationId: string,
    assignedOfficerId: string,
    caseNumber: string,
  ): Promise<Case> {
    return this.db.case.create({
      data: {
        alertId,
        stationId,
        assignedOfficerId,
        caseNumber,
        status: 'in_progress',
      },
    });
  }
}
