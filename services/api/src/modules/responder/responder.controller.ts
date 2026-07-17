import { FastifyRequest, FastifyReply } from 'fastify';
import { AuthenticatedUser } from '../../types';
import { ResponderService } from './responder.service';

export class ResponderController {
  constructor(private readonly service: ResponderService) {}

  apply = async (req: FastifyRequest<any>, reply: FastifyReply) => {
    const user = req.user as AuthenticatedUser;
    const responder = await this.service.apply(user.id, req.body as any);
    return reply.code(201).send({
      message: 'Application submitted successfully',
      data: { id: responder.id, status: responder.status }
    });
  };

  updateLocation = async (req: FastifyRequest<any>, reply: FastifyReply) => {
    const user = req.user as AuthenticatedUser;
    const body = req.body as any;
    await this.service.updateLocation(user.id, body.latitude, body.longitude, body.availability);
    return reply.send({ message: 'Location updated' });
  };

  updateStatus = async (req: FastifyRequest<any>, reply: FastifyReply) => {
    const user = req.user as AuthenticatedUser;
    const params = req.params as any;
    const body = req.body as any;
    // Only Admin can do this
    if (user.role !== 'admin' && user.role !== 'superadmin') {
      throw req.server.httpErrors.forbidden('Only admins can verify responders');
    }
    const updated = await this.service.updateStatus(user.id, params.id, body.status);
    return reply.send({ message: 'Status updated', data: updated });
  };

  getMyProfile = async (req: FastifyRequest, reply: FastifyReply) => {
    const user = req.user as AuthenticatedUser;
    const profile = await this.service.getMyResponderProfile(user.id);
    return reply.send({ data: profile });
  };

  getPending = async (req: FastifyRequest, reply: FastifyReply) => {
    const user = req.user as AuthenticatedUser;
    if (user.role !== 'admin' && user.role !== 'superadmin') {
      throw req.server.httpErrors.forbidden('Only admins can view applications');
    }
    const apps = await this.service.getPendingApplications();
    return reply.send({ data: apps });
  };

  respondToDispatch = async (req: FastifyRequest<any>, reply: FastifyReply) => {
    const user = req.user as AuthenticatedUser;
    const params = req.params as any;
    const body = req.body as any;
    await this.service.respondToDispatch(user.id, params.dispatchId, body.action, body.rejectReason);
    return reply.send({ message: `Dispatch ${body.action}ed successfully` });
  };

  getMyDispatches = async (req: FastifyRequest, reply: FastifyReply) => {
    const user = req.user as AuthenticatedUser;
    const dispatches = await this.service.getMyDispatches(user.id);
    return reply.send({ data: dispatches });
  };

  verifyDispatch = async (req: FastifyRequest<any>, reply: FastifyReply) => {
    const user = req.user as AuthenticatedUser;
    const params = req.params as any;
    if (user.role !== 'police' && user.role !== 'admin') {
      throw req.server.httpErrors.forbidden('Only police/admins can verify dispatches');
    }
    const updated = await this.service.verifyDispatch(user.id, params.dispatchId);
    return reply.send({ message: 'Responder verified and reputation points awarded', data: updated });
  };
}
