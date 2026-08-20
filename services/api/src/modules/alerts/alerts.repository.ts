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
   * Find the nearest active police station.
   *
   * Uses the maintained `location` geometry column (kept in sync with
   * latitude/longitude by trg_sync_police_station_location) rather than
   * rebuilding the point with ST_MakePoint. That distinction matters: an
   * expression over the lat/lng columns cannot use the GIST index, so the old
   * form sequentially scanned police_stations on every single SOS.
   *
   * `location::geography <-> ...::geography` is a true metre-accurate KNN
   * search and is index-assisted by idx_police_stations_location_geog
   * (20260819000000_spatial_index_usage).
   */
  async findNearestPoliceStation(lat: number, lng: number): Promise<PoliceStation | null> {
    const stations: PoliceStation[] = await this.db.$queryRaw`
      SELECT id, name, thana_code as "thanaCode", district, division, address, phone, is_active as "isActive", latitude, longitude, created_at as "createdAt", updated_at as "updatedAt"
      FROM police_stations
      WHERE is_active = true
      -- No "location IS NOT NULL" guard: the ORDER BY already drives index
      -- selection here, so the guard only adds a per-row filter, and a NULL
      -- location sorts last under <-> regardless.
      ORDER BY location::geography <-> ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
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
