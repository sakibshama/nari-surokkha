import { FastifyInstance } from 'fastify';
import { ResponderRepository } from './responder.repository';
import { AlertStatus, DispatchStatus, ResponderStatus, ResponderAvailability } from '@prisma/client';
import { emitToAlert } from '@/utils/alert-rooms';
import { ConflictError } from '@/utils/errors';
import { ACTIVE_ALERT_STATUSES } from '../alerts/alert-status';
import { applyStatusTransition } from '../alerts/alert-history';
import { invalidateAlertMeta } from '../alerts/alert-location.buffer';
import type { DispatchWithContext } from './responder.repository';
import {
  DISPATCH_TRANSITIONS,
  OPEN_DISPATCH_STATUSES,
  UNMASKED_DISPATCH_STATUSES,
  closeDispatchesForAlert,
  effectiveDispatchStatus,
  freeResponderIfIdle,
  type DispatchAction,
} from './dispatch-lifecycle';

export type AvailabilityInput = 'online' | 'offline' | 'busy';

const AVAILABILITY: Record<AvailabilityInput, ResponderAvailability> = {
  online: 'available',
  offline: 'offline',
  busy: 'busy',
};

/** The first acceptance moves an alert in these states to in_progress. */
const IN_PROGRESS_FROM: AlertStatus[] = ['confirmed', 'notified_contacts'];

/** What the responder app renders for one dispatch. */
export interface DispatchView {
  id: string;
  alertId: string;
  status: DispatchStatus;
  dispatchedAt: Date;
  acceptedAt: Date | null;
  arrivedAt: Date | null;
  completedAt: Date | null;
  rejectedAt: Date | null;
  withdrawnAt: Date | null;
  closedAt: Date | null;
  distanceMeters: number | null;
  alert: {
    id: string;
    /** The SOS owner — lets the app defensively hide its own SOS. */
    userId: string;
    status: AlertStatus;
    /** true once accepted: latitude/longitude are exact and the victim is named. */
    precise: boolean;
    latitude: number;
    longitude: number;
    victimName: string | null;
    victimPhone: string | null;
    bloodGroup: string | null;
  };
}

/**
 * Privacy masking: until the responder accepts, only a ~1 km location and no
 * identity. After accepting (and while on scene / after completing) the exact
 * position and the victim's name, phone and blood group.
 */
export function toDispatchView(d: DispatchWithContext): DispatchView {
  const alertActive = ACTIVE_ALERT_STATUSES.includes(d.alert.status);
  const status = effectiveDispatchStatus(d.status, alertActive);
  // Once the SOS is over (closed) or the responder stepped away, the victim's
  // exact position and identity are masked again.
  const precise = UNMASKED_DISPATCH_STATUSES.includes(status);
  const lat = Number(d.alert.latitude);
  const lng = Number(d.alert.longitude);
  return {
    id: d.id,
    alertId: d.alertId,
    status,
    dispatchedAt: d.dispatchedAt,
    acceptedAt: d.acceptedAt,
    arrivedAt: d.arrivedAt,
    completedAt: d.completedAt,
    rejectedAt: d.rejectedAt,
    withdrawnAt: d.withdrawnAt,
    closedAt: d.closedAt,
    distanceMeters: d.distanceMeters,
    alert: {
      id: d.alert.id,
      userId: d.alert.userId,
      status: d.alert.status,
      precise,
      latitude: precise ? lat : Math.round(lat * 100) / 100,
      longitude: precise ? lng : Math.round(lng * 100) / 100,
      victimName: precise ? d.alert.user.profile?.fullName || null : null,
      victimPhone: precise ? d.alert.user.phone : null,
      bloodGroup: precise ? d.alert.user.profile?.bloodGroup || null : null,
    },
  };
}

export class ResponderService {
  constructor(
    private readonly repository: ResponderRepository,
    private readonly fastify: FastifyInstance
  ) {}

  async apply(userId: string, data: { nationalId?: string, occupation?: string, organizationName?: string }) {
    const existing = await this.repository.getResponderByUserId(userId);
    if (existing) {
      throw this.fastify.httpErrors.conflict('You have already applied to be a responder');
    }
    return this.repository.createResponder({ userId, ...data });
  }

  async getMyResponderProfile(userId: string) {
    return this.repository.getResponderByUserId(userId);
  }

  /**
   * Location and/or availability. The app sends 'online'; the enum's on-duty
   * value is `available`. Coordinates are optional only when going offline,
   * and a missing (or 0,0) fix never overwrites the last real location.
   */
  async updateLocation(
    userId: string,
    data: { latitude?: number; longitude?: number; availability?: AvailabilityInput },
  ) {
    const responder = await this.repository.getResponderByUserId(userId);
    if (!responder) {
      throw this.fastify.httpErrors.notFound('Responder profile not found');
    }
    const hasFix =
      data.latitude !== undefined &&
      data.longitude !== undefined &&
      !(data.latitude === 0 && data.longitude === 0);
    if (!hasFix && data.availability !== 'offline') {
      throw this.fastify.httpErrors.badRequest('latitude and longitude are required unless going offline');
    }
    return this.repository.updateLocationAndAvailability(
      responder.id,
      hasFix ? { latitude: data.latitude!, longitude: data.longitude! } : null,
      data.availability ? AVAILABILITY[data.availability] : undefined,
    );
  }

  async updateStatus(adminId: string, responderId: string, status: ResponderStatus) {
    return this.repository.updateStatus(responderId, status, adminId);
  }

  async getPendingApplications() {
    return this.repository.getPendingApplications();
  }

  /**
   * Accept / reject / arrive / complete / withdraw — one conditional state
   * transition per call (see dispatch-lifecycle.ts).
   *
   *   404  no such dispatch
   *   403  not your dispatch, or you are not a verified responder
   *   409  OWN_ALERT       it is your own SOS (the dispatch is closed)
   *        SOS_ENDED       the SOS was cancelled / resolved (dispatch closed)
   *        DISPATCH_STATE  wrong state for this action, incl. a double tap or
   *                        a concurrent request that won the race
   */
  async respondToDispatch(
    userId: string,
    dispatchId: string,
    action: DispatchAction,
    rejectReason?: string,
  ): Promise<DispatchView> {
    const dispatch = await this.repository.getDispatchById(dispatchId);
    if (!dispatch) {
      throw this.fastify.httpErrors.notFound('Dispatch not found');
    }
    if (dispatch.responder.userId !== userId) {
      throw this.fastify.httpErrors.forbidden('Not authorized');
    }
    if (dispatch.alert.userId === userId) {
      // Should never exist (the fan-out excludes the owner) — close it if it does.
      await this.repository.transitionDispatch(dispatchId, OPEN_DISPATCH_STATUSES, {
        status: 'closed',
        closedAt: new Date(),
      });
      throw new ConflictError('You cannot respond to your own SOS', 'OWN_ALERT');
    }
    if (dispatch.responder.status !== 'verified') {
      throw this.fastify.httpErrors.forbidden('Only verified responders can respond to dispatches');
    }

    const alertActive = ACTIVE_ALERT_STATUSES.includes(dispatch.alert.status);
    if (!alertActive || dispatch.status === 'closed') {
      if (OPEN_DISPATCH_STATUSES.includes(dispatch.status)) {
        await closeDispatchesForAlert(this.fastify, dispatch.alertId, dispatch.alert.status);
      }
      throw new ConflictError('This SOS has already ended', 'SOS_ENDED');
    }

    const transition = DISPATCH_TRANSITIONS[action];
    const now = new Date();
    const moved = transition.from.includes(dispatch.status) &&
      (await this.repository.transitionDispatch(dispatchId, transition.from, {
        status: transition.to,
        [transition.stamp]: now,
        ...(action === 'reject' && rejectReason ? { rejectReason: rejectReason.slice(0, 255) } : {}),
      }));
    if (!moved) {
      // Re-read so the message says what actually happened (e.g. the SOS
      // was closed between our read and the write).
      const current = await this.repository.getDispatchById(dispatchId);
      if (current?.status === 'closed') {
        throw new ConflictError('This SOS has already ended', 'SOS_ENDED');
      }
      const state = current?.status ?? dispatch.status;
      throw new ConflictError(
        `Cannot ${action} a dispatch that is ${state}`,
        'DISPATCH_STATE',
      );
    }

    // Side effects. None of them may turn a successful transition into an
    // error for the responder, so each is guarded.
    await this.afterTransition(userId, dispatch, action, now);

    const fallback = { ...dispatch, status: transition.to, [transition.stamp]: now };
    const updated = await this.repository.getDispatchById(dispatchId).catch(() => null);
    return toDispatchView(updated ?? fallback);
  }

  private async afterTransition(
    userId: string,
    dispatch: DispatchWithContext,
    action: DispatchAction,
    at: Date,
  ): Promise<void> {
    const { alertId, responderId } = dispatch;
    const status = DISPATCH_TRANSITIONS[action].to;
    try {
      if (action === 'accept') {
        await this.repository.markBusy(responderId);
        await this.markAlertInProgress(userId, dispatch);
      } else if (action === 'complete' || action === 'withdraw') {
        await freeResponderIfIdle(this.fastify.prisma, responderId);
      }

      if (action !== 'reject') {
        await this.fastify.prisma.auditLog.create({
          data: {
            action: action === 'accept' ? 'alert_acknowledged' : 'updated',
            entityType: 'ResponderDispatch',
            entityId: dispatch.id,
            userId,
            metadata: { alertId, responderId, event: `dispatch_${status}` },
          },
        });
      }
    } catch (err) {
      this.fastify.log.error({ err, dispatchId: dispatch.id, action }, 'Dispatch side effect failed');
    }

    // The victim (alert room) and the admin view hear every change that
    // matters to them. A decline is not news to the victim.
    if (action !== 'reject') {
      const payload = {
        alertId,
        dispatchId: dispatch.id,
        responderId,
        status,
        timestamp: at.toISOString(),
      };
      emitToAlert(this.fastify, alertId, 'responder:dispatch_update', payload);
      // Kept for existing listeners (admin portal).
      if (action === 'accept') {
        emitToAlert(this.fastify, alertId, 'responder_accepted', { alertId, responderId });
      }
    }
  }

  /** First acceptance: the SOS is now being handled. Recorded in its history. */
  private async markAlertInProgress(userId: string, dispatch: DispatchWithContext): Promise<void> {
    const from = dispatch.alert.status;
    if (!IN_PROGRESS_FROM.includes(from)) return;
    const prisma = this.fastify.prisma;
    const updated = await applyStatusTransition(
      prisma,
      this.fastify.log,
      async (tx) => {
        const { count } = await tx.emergencyAlert.updateMany({
          where: { id: dispatch.alertId, status: { in: IN_PROGRESS_FROM } },
          data: { status: 'in_progress' },
        });
        if (count === 0) return null;
        return tx.emergencyAlert.findUnique({ where: { id: dispatch.alertId } });
      },
      () => ({
        alertId: dispatch.alertId,
        fromStatus: from,
        toStatus: 'in_progress',
        actorKind: 'user',
        actorId: userId,
        reason: 'A community responder accepted the SOS',
        metadata: { event: 'responder_accepted', dispatchId: dispatch.id, responderId: dispatch.responderId },
      }),
    );
    if (updated) {
      await invalidateAlertMeta(this.fastify, dispatch.alertId);
      emitToAlert(this.fastify, dispatch.alertId, 'alert_status_update', {
        alertId: dispatch.alertId,
        status: 'in_progress',
      });
    }
  }

  async getMyDispatches(userId: string): Promise<DispatchView[]> {
    const responder = await this.repository.getResponderByUserId(userId);
    if (!responder) {
      throw this.fastify.httpErrors.notFound('Responder profile not found');
    }

    const dispatches = await this.repository.getDispatchesForResponder(responder.id, userId);
    // Defence in depth: never show a user their own SOS.
    return dispatches.filter((d) => d.alert.userId !== userId).map(toDispatchView);
  }

  /** Responders who accepted the alert — for its owner (or an admin). */
  async getAlertResponders(alertId: string) {
    const rows = await this.repository.getAlertResponders(alertId);
    return rows.map((r) => ({
      dispatchId: r.id,
      responderId: r.responder.id,
      status: r.status,
      name: r.responder.user.profile?.fullName || null,
      phone: r.responder.user.phone,
      organizationName: r.responder.organizationName,
      distanceMeters: r.distanceMeters,
      acceptedAt: r.acceptedAt,
      arrivedAt: r.arrivedAt,
      completedAt: r.completedAt,
    }));
  }

  async verifyDispatch(adminUserId: string, dispatchId: string) {
    const dispatch = await this.repository.getDispatchById(dispatchId);
    if (!dispatch) {
      throw this.fastify.httpErrors.notFound('Dispatch not found');
    }
    if (dispatch.verifiedAt) {
      throw this.fastify.httpErrors.conflict('Dispatch already verified');
    }

    // Verify the dispatch
    const updatedDispatch = await this.fastify.prisma.responderDispatch.update({
      where: { id: dispatchId },
      data: {
        verifiedAt: new Date(),
        verifiedBy: adminUserId,
      },
      include: { responder: true },
    });

    // Update reputation score
    const newScore = updatedDispatch.responder.reputationScore + 10;
    const badges = [...updatedDispatch.responder.badges];
    if (newScore >= 50 && !badges.includes('Verified Protector')) {
      badges.push('Verified Protector');
    }

    const updatedResponder = await this.fastify.prisma.responder.update({
      where: { id: updatedDispatch.responderId },
      data: {
        reputationScore: newScore,
        badges,
      },
    });

    await this.fastify.prisma.auditLog.create({
      data: {
        action: 'responder_approved',
        entityType: 'ResponderDispatch',
        entityId: dispatchId,
        userId: adminUserId,
        metadata: { event: 'dispatch_verified', responderId: updatedDispatch.responderId, newScore, badges },
      },
    });

    return updatedResponder;
  }
}
