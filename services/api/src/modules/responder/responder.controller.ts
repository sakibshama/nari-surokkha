import { FastifyRequest, FastifyReply } from 'fastify';
import { ResponderStatus } from '@prisma/client';
import { ResponderService, AvailabilityInput } from './responder.service';
import type { DispatchAction } from './dispatch-lifecycle';

export interface ApplyResponderDTO {
  nationalId: string;
  emergencyContact: string;
  address?: string;
}

export interface UpdateResponderLocationDTO {
  latitude?: number;
  longitude?: number;
  availability?: AvailabilityInput;
}

export interface RespondDispatchDTO {
  action: DispatchAction;
  rejectReason?: string;
}

const ACTION_MESSAGE: Record<DispatchAction, string> = {
  accept: 'Dispatch accepted',
  reject: 'Dispatch declined',
  arrive: 'Marked as arrived',
  complete: 'Dispatch completed',
  withdraw: 'Acceptance withdrawn',
};

export class ResponderController {
  constructor(private readonly service: ResponderService) {}

  apply = async (
    req: FastifyRequest<{ Body: ApplyResponderDTO }>,
    reply: FastifyReply,
  ) => {
    const user = req.user!;
    const responder = await this.service.apply(user.id, req.body);
    return reply.code(201).send({
      message: 'Application submitted successfully',
      data: { id: responder.id, status: responder.status }
    });
  };

  updateLocation = async (
    req: FastifyRequest<{ Body: UpdateResponderLocationDTO }>,
    reply: FastifyReply,
  ) => {
    const user = req.user!;
    await this.service.updateLocation(user.id, req.body);
    return reply.send({ message: 'Location updated' });
  };

  updateStatus = async (
    req: FastifyRequest<{ Params: { id: string }; Body: { status: string } }>,
    reply: FastifyReply,
  ) => {
    const user = req.user!;
    // Only Admin can do this
    if (user.role !== 'admin' && user.role !== 'superadmin') {
      throw req.server.httpErrors.forbidden('Only admins can verify responders');
    }
    const updated = await this.service.updateStatus(user.id, req.params.id, req.body.status as ResponderStatus);
    return reply.send({ message: 'Status updated', data: updated });
  };

  getMyProfile = async (req: FastifyRequest, reply: FastifyReply) => {
    const user = req.user!;
    const profile = await this.service.getMyResponderProfile(user.id);
    return reply.send({ data: profile });
  };

  getPending = async (req: FastifyRequest, reply: FastifyReply) => {
    const user = req.user!;
    if (user.role !== 'admin' && user.role !== 'superadmin') {
      throw req.server.httpErrors.forbidden('Only admins can view applications');
    }
    const apps = await this.service.getPendingApplications();
    return reply.send({ data: apps });
  };

  respondToDispatch = async (
    req: FastifyRequest<{ Params: { dispatchId: string }; Body: RespondDispatchDTO }>,
    reply: FastifyReply,
  ) => {
    const user = req.user!;
    const dispatch = await this.service.respondToDispatch(
      user.id,
      req.params.dispatchId,
      req.body.action,
      req.body.rejectReason,
    );
    return reply.send({ message: ACTION_MESSAGE[req.body.action], data: dispatch });
  };

  getMyDispatches = async (req: FastifyRequest, reply: FastifyReply) => {
    const user = req.user!;
    const dispatches = await this.service.getMyDispatches(user.id);
    return reply.send({ data: dispatches });
  };

  verifyDispatch = async (
    req: FastifyRequest<{ Params: { dispatchId: string } }>,
    reply: FastifyReply,
  ) => {
    const user = req.user!;
    if (user.role !== 'admin' && user.role !== 'superadmin') {
      throw req.server.httpErrors.forbidden('Only admins can verify dispatches');
    }
    const updated = await this.service.verifyDispatch(user.id, req.params.dispatchId);
    return reply.send({ message: 'Responder verified and reputation points awarded', data: updated });
  };
}
