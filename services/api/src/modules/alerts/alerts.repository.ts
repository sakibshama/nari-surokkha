/**
 * Alerts Repository — Database Access Layer
 */

import { PrismaClient, EmergencyAlert, PoliceStation, AuditAction } from '@prisma/client';

export class AlertsRepository {
  constructor(private readonly db: PrismaClient) {}

  async findUserByPhone(phone: string) {
    return this.db.user.findUnique({
      where: { phone },
    });
  }

  /**
   * Find the nearest active police station using PostGIS ST_Distance.
   */
  async findNearestPoliceStation(lat: number, lng: number): Promise<PoliceStation | null> {
    // We use a raw query because Prisma doesn't natively support PostGIS <-> (distance) operator well yet.
    // Order by distance to the provided point and limit to 1.
    const stations: PoliceStation[] = await this.db.$queryRaw`
      SELECT id, name, thana_code as "thanaCode", district, division, address, phone, is_active as "isActive", latitude, longitude, created_at as "createdAt", updated_at as "updatedAt"
      FROM police_stations
      WHERE is_active = true
      ORDER BY ST_SetSRID(ST_MakePoint(longitude::float, latitude::float), 4326) <-> ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)
      LIMIT 1;
    `;
    return stations[0] || null;
  }

  async createAlert(data: {
    userId: string;
    latitude: number;
    longitude: number;
    accuracy?: number;
    assignedStationId?: string | null;
    status?: any;
    type?: any;
    isSoftAlert?: boolean;
    softAlertAt?: Date;
    mlMetadata?: any;
  }): Promise<EmergencyAlert> {
    return this.db.emergencyAlert.create({
      data: {
        userId: data.userId,
        type: data.type || 'manual',
        status: data.status || 'confirmed',
        latitude: data.latitude,
        longitude: data.longitude,
        accuracy: data.accuracy,
        assignedStationId: data.assignedStationId,
        confirmedAt: data.status === 'confirmed' ? new Date() : null,
        isSoftAlert: data.isSoftAlert || false,
        softAlertAt: data.softAlertAt,
        mlMetadata: data.mlMetadata,
      },
    });
  }

  async createAuditLog(data: {
    userId: string;
    action: AuditAction;
    entityType: string;
    entityId: string;
    metadata?: any;
    ipAddress?: string;
  }): Promise<void> {
    await this.db.auditLog.create({
      data: {
        userId: data.userId,
        action: data.action,
        entityType: data.entityType,
        entityId: data.entityId,
        metadata: data.metadata,
        ipAddress: data.ipAddress,
      },
    });
  }

  async getAlertById(alertId: string): Promise<EmergencyAlert | null> {
    return this.db.emergencyAlert.findUnique({
      where: { id: alertId },
    });
  }

  async updateAlert(alertId: string, data: any): Promise<EmergencyAlert> {
    return this.db.emergencyAlert.update({
      where: { id: alertId },
      data,
    });
  }

  async addLocationUpdate(
    alertId: string,
    latitude: number,
    longitude: number,
    accuracy?: number,
  ): Promise<void> {
    // 1. Insert into alert_locations
    await this.db.alertLocation.create({
      data: {
        alertId,
        latitude,
        longitude,
        accuracy,
      },
    });

    // 2. Update the main emergency_alert record with the latest coordinates
    await this.db.emergencyAlert.update({
      where: { id: alertId },
      data: {
        latitude,
        longitude,
        accuracy,
      },
    });
  }
}
