import { FastifyInstance } from 'fastify';
import { ResponderRepository } from './responder.repository';
import { ResponderStatus, ResponderAvailability } from '@prisma/client';

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

  async updateLocation(userId: string, latitude: number, longitude: number, availability?: ResponderAvailability) {
    const responder = await this.repository.getResponderByUserId(userId);
    if (!responder) {
      throw this.fastify.httpErrors.notFound('Responder profile not found');
    }
    return this.repository.updateLocationAndAvailability(responder.id, latitude, longitude, availability);
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
      // Create Audit Log
      await this.fastify.prisma.auditLog.create({
        data: {
          action: 'alert_acknowledged',
          entityType: 'ResponderDispatch',
          entityId: dispatchId,
          userId: userId,
          details: { message: 'Responder accepted dispatch' } as any
        } as any
      });
      // Emit to police portal that responder accepted
      this.fastify.io.emit('responder_accepted', {
        alertId: dispatch.alertId,
        responderId: dispatch.responderId,
      });
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

  async verifyDispatch(policeUserId: string, dispatchId: string) {
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
        verifiedBy: policeUserId,
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

    // Audit Log
    await this.fastify.prisma.auditLog.create({
      data: {
        action: 'responder_verified',
        entityType: 'ResponderDispatch',
        entityId: dispatchId,
        userId: policeUserId,
        details: { newScore, badges } as any,
      } as any,
    });

    return updatedResponder;
  }
}
