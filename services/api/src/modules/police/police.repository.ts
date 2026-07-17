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

  async getActiveAlertsForStation(stationId: string): Promise<EmergencyAlert[]> {
    return this.db.emergencyAlert.findMany({
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

  // Create a minimal case
  async createCase(alertId: string, stationId: string, assignedOfficerId: string): Promise<Case> {
    const caseNumber = `CASE-${Date.now()}`;
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
