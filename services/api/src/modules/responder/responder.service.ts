import { FastifyInstance } from 'fastify';
import { ResponderRepository } from './responder.repository';
import { ResponderStatus, ResponderAvailability } from '@prisma/client';
import { emitToAlert } from '@/utils/alert-rooms';

export type AvailabilityInput = 'online' | 'offline' | 'busy';

const AVAILABILITY: Record<AvailabilityInput, ResponderAvailability> = {
  online: 'available',
  offline: 'offline',
  busy: 'busy',
};

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

  async respondToDispatch(userId: string, dispatchId: string, action: 'accept' | 'reject', rejectReason?: string) {
    const dispatch = await this.repository.getDispatchById(dispatchId);
    if (!dispatch) {
      throw this.fastify.httpErrors.notFound('Dispatch not found');
    }
    if (dispatch.responder.userId !== userId) {
      throw this.fastify.httpErrors.forbidden('Not authorized');
    }

    const accepted = action === 'accept';
    const updated = await this.repository.updateDispatchResponse(dispatchId, accepted, rejectReason);
    
    if (accepted) {
      await this.fastify.prisma.auditLog.create({
        data: {
          action: 'alert_acknowledged',
          entityType: 'ResponderDispatch',
          entityId: dispatchId,
          userId,
          metadata: { alertId: dispatch.alertId, responderId: dispatch.responderId, event: 'dispatch_accepted' },
        },
      });
      // Tell the alert room and the admin view that a responder accepted.
      emitToAlert(
        this.fastify,
        dispatch.alertId,
        'responder_accepted',
        { alertId: dispatch.alertId, responderId: dispatch.responderId },
      );
    }

    return updated;
  }

  async getMyDispatches(userId: string) {
    const responder = await this.repository.getResponderByUserId(userId);
    if (!responder) {
      throw this.fastify.httpErrors.notFound('Responder profile not found');
    }

    const dispatches = await this.repository.getDispatchesForResponder(responder.id);

    // Apply Privacy Masking
    return dispatches.map(d => {
      const isAccepted = !!d.acceptedAt;
      const alertData = d.alert;

      // Unmask only if accepted
      if (isAccepted) {
        return {
          id: d.id,
          dispatchedAt: d.dispatchedAt,
          acceptedAt: d.acceptedAt,
          status: 'accepted',
          alert: {
            id: alertData.id,
            latitude: alertData.latitude,
            longitude: alertData.longitude,
            victimName: alertData.user.profile?.fullName || 'Unknown',
            victimPhone: alertData.user.phone,
            bloodGroup: alertData.user.profile?.bloodGroup,
          }
        };
      } else if (d.rejectedAt) {
        return {
          id: d.id,
          status: 'rejected',
        };
      } else {
        // Pending: Mask sensitive details, provide rough location/distance
        return {
          id: d.id,
          dispatchedAt: d.dispatchedAt,
          status: 'pending',
          alert: {
            id: alertData.id,
            latitude: Math.round(Number(alertData.latitude) * 100) / 100, // Roughly masked
            longitude: Math.round(Number(alertData.longitude) * 100) / 100,
            victimName: 'Hidden (Accept to view)',
            victimPhone: 'Hidden',
          }
        };
      }
    });
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
