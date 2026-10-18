/**
 * Alerts Repository — Database Access Layer
 */

import { PrismaClient, Prisma, EmergencyAlert, AuditAction, AlertStatus } from '@prisma/client';
import {
  AlertStatusActor,
  HistoryLogger,
  applyStatusTransition,
} from './alert-history';

export class AlertsRepository {
  constructor(
    private readonly db: PrismaClient,
    /** Where history-write failures are reported (they never fail the SOS). */
    private readonly log?: HistoryLogger,
  ) {}

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
    const status: AlertStatus = data.status || 'confirmed';
    const type = data.type || 'manual';
    const alertData: Prisma.EmergencyAlertUncheckedCreateInput = {
      userId: data.userId,
      type,
      status,
      latitude: data.latitude,
      longitude: data.longitude,
      accuracy: data.accuracy,
      assignedStationId: data.assignedStationId,
      // Same predicate as before (status defaults to 'confirmed' above, but an
      // omitted status kept confirmedAt null — preserved).
      confirmedAt: data.status === 'confirmed' ? new Date() : null,
      isSoftAlert: data.isSoftAlert || false,
      softAlertAt: data.softAlertAt,
      mlMetadata: data.mlMetadata,
    };

    // The creation event goes in with the alert (one nested write, one
    // transaction) so every SOS is on record from its first moment.
    const creationEvent: Prisma.AlertStatusEventCreateWithoutAlertInput = {
      fromStatus: null,
      toStatus: status,
      actorKind: 'user',
      actorId: data.userId,
      metadata: { event: 'created', type, isSoftAlert: data.isSoftAlert || false },
    };
    try {
      return await this.db.emergencyAlert.create({
        data: { ...alertData, statusEvents: { create: creationEvent } },
      });
    } catch (err) {
      // Never let the history table stop an SOS (e.g. migration not applied
      // yet): record the alert without it and say so loudly.
      this.log?.error({ err, userId: data.userId }, 'Alert creation with status history failed — creating the alert without it');
      return this.db.emergencyAlert.create({ data: alertData });
    }
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

  /**
   * Update an alert. When `history` is given and the update sets a status,
   * the change is appended to the alert's status history in the same
   * transaction (see alert-history.ts).
   */
  async updateAlert(
    alertId: string,
    data: Prisma.EmergencyAlertUpdateInput,
    history?: AlertStatusActor & { fromStatus: AlertStatus | null },
  ): Promise<EmergencyAlert> {
    const toStatus = typeof data.status === 'string' ? data.status : undefined;
    if (!history || !toStatus) {
      return this.db.emergencyAlert.update({ where: { id: alertId }, data });
    }
    const updated = await applyStatusTransition(
      this.db,
      this.log,
      (tx) => tx.emergencyAlert.update({ where: { id: alertId }, data }),
      () => ({ ...history, alertId, toStatus }),
    );
    // update() throws rather than returning null, so this is always set.
    return updated as EmergencyAlert;
  }

  /**
   * Apply `data` only while the alert is still a pending soft alert (status
   * 'created'), atomically. Returns the updated alert, or null when another
   * transition (cancel / confirm / auto-escalation) got there first.
   */
  async updateIfSoftAlertPending(
    alertId: string,
    data: Prisma.EmergencyAlertUpdateManyMutationInput,
    history?: AlertStatusActor,
  ): Promise<EmergencyAlert | null> {
    const apply = async (db: PrismaClient | Prisma.TransactionClient) => {
      const { count } = await db.emergencyAlert.updateMany({
        where: { id: alertId, status: 'created' },
        data,
      });
      if (count === 0) return null;
      return db.emergencyAlert.findUnique({ where: { id: alertId } });
    };
    const toStatus = typeof data.status === 'string' ? data.status : undefined;
    if (!history || !toStatus) return apply(this.db);
    // The conditional update and its history row commit together: a lost
    // race (count 0) writes no history.
    return applyStatusTransition(this.db, this.log, apply, () => ({
      ...history,
      alertId,
      fromStatus: 'created',
      toStatus,
    }));
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
