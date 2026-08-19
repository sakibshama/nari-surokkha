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

  /**
   * Verified + AVAILABLE responders within `radiusMeters`, nearest first.
   *
   * NOTE: the ResponderAvailability enum is { available, busy, offline } — the
   * "on duty" state is `available` (there is no `online`). Filtering on a
   * non-existent value returns zero rows, which silently breaks dispatch.
   *
   * Queries the maintained `location` geometry column (trg_sync_responder_location)
   * instead of rebuilding the point from latitude/longitude. ST_DWithin over
   * `location::geography` is index-assisted by idx_responders_location_geog;
   * the previous ST_DistanceSphere(ST_MakePoint(...)) form could not use any
   * index and scanned the whole responders table on every SOS.
   *
   * `limit` caps the fan-out: notifying 200 responders for one alert is noise,
   * not coverage. The nearest N are the ones who can actually respond.
   */
  async findNearbyResponders(
    latitude: number,
    longitude: number,
    radiusMeters: number,
    limit = 20,
  ): Promise<Array<{ id: string; userId: string; distanceMeters: number }>> {
    const result = await this.prisma.$queryRaw<Array<{ id: string; userId: string; distanceMeters: number }>>`
      SELECT id,
             user_id AS "userId",
             ST_Distance(
               location::geography,
               ST_SetSRID(ST_MakePoint(${longitude}::float, ${latitude}::float), 4326)::geography
             )::float AS "distanceMeters"
      FROM responders
      WHERE status = 'verified'
        AND availability = 'available'
        AND location IS NOT NULL
        AND NOT (latitude = 0 AND longitude = 0)
        AND ST_DWithin(
              location::geography,
              ST_SetSRID(ST_MakePoint(${longitude}::float, ${latitude}::float), 4326)::geography,
              ${radiusMeters}
            )
      ORDER BY location::geography <-> ST_SetSRID(ST_MakePoint(${longitude}::float, ${latitude}::float), 4326)::geography
      LIMIT ${limit};
    `;
    return result;
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
