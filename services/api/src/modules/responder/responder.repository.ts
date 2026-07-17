import { PrismaClient, Responder, ResponderStatus, ResponderAvailability, ResponderDispatch } from '@prisma/client';

export class ResponderRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createResponder(data: { userId: string, nationalId?: string, occupation?: string, organizationName?: string }): Promise<Responder> {
    return this.prisma.responder.create({
      data: {
        userId: data.userId,
        nationalId: data.nationalId,
        occupation: data.occupation,
        organizationName: data.organizationName,
        status: 'pending',
      },
    });
  }

  async getResponderByUserId(userId: string): Promise<Responder | null> {
    return this.prisma.responder.findUnique({
      where: { userId },
    });
  }

  async updateStatus(id: string, status: ResponderStatus, adminId: string): Promise<Responder> {
    return this.prisma.responder.update({
      where: { id },
      data: {
        status,
        approvedBy: status === 'verified' ? adminId : null,
        approvedAt: status === 'verified' ? new Date() : null,
      },
    });
  }

  async updateLocationAndAvailability(id: string, latitude: number, longitude: number, availability?: ResponderAvailability): Promise<Responder> {
    const data: any = {
      latitude,
      longitude,
      lastLocationAt: new Date(),
    };
    if (availability) data.availability = availability;

    return this.prisma.responder.update({
      where: { id },
      data,
    });
  }

  async findNearbyResponders(latitude: number, longitude: number, radiusMeters: number): Promise<any[]> {
    // PostGIS raw query
    // Find verified, online responders within radius. 
    // ST_DistanceSphere takes (lon, lat) arguments.
    // We return their IDs to create dispatches.
    const result = await this.prisma.$queryRaw`
      SELECT id, user_id as "userId"
      FROM responders
      WHERE status = 'verified'
        AND availability = 'online'
        AND latitude IS NOT NULL
        AND longitude IS NOT NULL
        AND ST_DistanceSphere(
              ST_MakePoint(longitude::float, latitude::float),
              ST_MakePoint(${longitude}::float, ${latitude}::float)
            ) <= ${radiusMeters};
    `;
    return result as any[];
  }

  async createDispatch(responderId: string, alertId: string): Promise<ResponderDispatch> {
    return this.prisma.responderDispatch.create({
      data: {
        responderId,
        alertId,
      },
    });
  }

  async getDispatchById(dispatchId: string): Promise<(ResponderDispatch & { responder: Responder, alert: any }) | null> {
    return this.prisma.responderDispatch.findUnique({
      where: { id: dispatchId },
      include: {
        responder: true,
        alert: {
          include: {
            user: { include: { profile: true } }
          }
        }
      }
    });
  }

  async getDispatchesForResponder(responderId: string): Promise<any[]> {
    return this.prisma.responderDispatch.findMany({
      where: { responderId },
      include: {
        alert: {
          include: {
            user: { include: { profile: true } }
          }
        }
      },
      orderBy: { dispatchedAt: 'desc' },
    });
  }

  async updateDispatchResponse(dispatchId: string, accepted: boolean, rejectReason?: string): Promise<ResponderDispatch> {
    return this.prisma.responderDispatch.update({
      where: { id: dispatchId },
      data: {
        acceptedAt: accepted ? new Date() : null,
        rejectedAt: !accepted ? new Date() : null,
        rejectReason: rejectReason,
      },
    });
  }

  async getPendingApplications(): Promise<Responder[]> {
    return this.prisma.responder.findMany({
      where: { status: 'pending' },
      include: { user: { include: { profile: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }
}
