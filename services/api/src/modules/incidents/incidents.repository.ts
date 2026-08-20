import { PrismaClient, IncidentReport, IncidentType, IncidentStatus } from '@prisma/client';

export class IncidentsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createIncident(
    type: IncidentType,
    latitude: number,
    longitude: number,
    description?: string
  ): Promise<IncidentReport> {
    return this.prisma.incidentReport.create({
      data: {
        type,
        latitude,
        longitude,
        description,
        status: 'pending'
      }
    });
  }

  async getIncidentsByStatus(status: IncidentStatus, limit: number = 50): Promise<IncidentReport[]> {
    return this.prisma.incidentReport.findMany({
      where: { status },
      orderBy: { createdAt: 'desc' },
      take: limit
    });
  }

  async updateIncidentStatus(id: string, status: IncidentStatus): Promise<IncidentReport> {
    return this.prisma.incidentReport.update({
      where: { id },
      data: { status }
    });
  }

  async updateIncident(id: string, data: { type?: IncidentType; description?: string }): Promise<IncidentReport> {
    return this.prisma.incidentReport.update({
      where: { id },
      data: {
        ...(data.type && { type: data.type }),
        ...(data.description !== undefined && { description: data.description }),
      }
    });
  }

  async deleteIncident(id: string): Promise<IncidentReport> {
    return this.prisma.incidentReport.delete({
      where: { id }
    });
  }

  async getVerifiedIncidentsInRadius(
    latitude: number,
    longitude: number,
    radiusMeters: number,
    since: Date
  ): Promise<IncidentReport[]> {
    // Uses the maintained `location` geometry column (trg_sync_incident_location)
    // so ST_DWithin can be answered from idx_incident_reports_location_geog.
    // Rebuilding the point with ST_MakePoint(longitude, latitude) — as this
    // did previously — defeats the index and scans the whole table.
    const incidents = await this.prisma.$queryRaw<IncidentReport[]>`
      SELECT * FROM "incident_reports"
      WHERE status = 'verified'
        AND "created_at" >= ${since}
        -- NOTE: deliberately no "location IS NOT NULL" guard.
        --
        -- It reads as harmless defensive SQL, but it is what makes this query
        -- slow: the planner satisfies the NOT NULL predicate with the plain
        -- geometry index and then evaluates ST_DWithin as a filter over every
        -- row. Measured on 20,000 responders that is 17,855 rows removed by
        -- filter; without it the planner uses the geography expression index
        -- with a real bounding-box Index Cond and removes only 908.
        --
        -- The guard is redundant anyway: ST_DWithin(NULL, ...) is NULL, which
        -- WHERE already treats as false.
        AND ST_DWithin(
          location::geography,
          ST_SetSRID(ST_MakePoint(${longitude}::float, ${latitude}::float), 4326)::geography,
          ${radiusMeters}
        );
    `;

    return incidents;
  }
}
