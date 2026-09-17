import { FastifyRequest, FastifyReply } from 'fastify';
import { ResponderAvailability, ResponderStatus } from '@prisma/client';
import { ResponderService } from './responder.service';

export interface ApplyResponderDTO {
  nationalId: string;
  emergencyContact: string;
  address?: string;
}

export interface UpdateResponderLocationDTO {
  latitude: number;
  longitude: number;
  availability?: string;
}

export interface RespondDispatchDTO {
  action: 'accept' | 'reject';
  rejectReason?: string;
}

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
    await this.service.updateLocation(user.id, req.body.latitude, req.body.longitude, req.body.availability as ResponderAvailability);
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
    await this.service.respondToDispatch(user.id, req.params.dispatchId, req.body.action, req.body.rejectReason);
    return reply.send({ message: `Dispatch ${req.body.action}ed successfully` });
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
