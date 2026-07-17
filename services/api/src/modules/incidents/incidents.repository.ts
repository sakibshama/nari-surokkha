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
    // PostGIS raw query to find incidents within radius
    const incidents = await this.prisma.$queryRaw<IncidentReport[]>`
      SELECT * FROM "incident_reports"
      WHERE status = 'verified'
        AND "created_at" >= ${since}
        AND ST_DWithin(
          ST_MakePoint(longitude::float, latitude::float)::geography,
          ST_MakePoint(${longitude}::float, ${latitude}::float)::geography,
          ${radiusMeters}
        );
    `;

    return incidents;
  }
}
