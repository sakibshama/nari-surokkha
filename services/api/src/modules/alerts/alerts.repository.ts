/**
 * Alerts Repository — Database Access Layer
 */

import { PrismaClient, Prisma, EmergencyAlert, AuditAction } from '@prisma/client';

export class AlertsRepository {
  constructor(private readonly db: PrismaClient) {}

  async findUserByPhone(phone: string) {
    return this.db.user.findUnique({
      where: { phone },
    });
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

  async updateAlert(alertId: string, data: Prisma.EmergencyAlertUpdateInput): Promise<EmergencyAlert> {
    return this.db.emergencyAlert.update({
      where: { id: alertId },
      data,
    });
  }

  /**
   * Apply `data` only while the alert is still a pending soft alert (status
   * 'created'), atomically. Returns the updated alert, or null when another
   * transition (cancel / confirm / auto-escalation) got there first.
   */
  async updateIfSoftAlertPending(
    alertId: string,
    data: Prisma.EmergencyAlertUpdateManyMutationInput,
  ): Promise<EmergencyAlert | null> {
    const { count } = await this.db.emergencyAlert.updateMany({
      where: { id: alertId, status: 'created' },
      data,
    });
    if (count === 0) return null;
    return this.db.emergencyAlert.findUnique({ where: { id: alertId } });
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
