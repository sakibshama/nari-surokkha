import { FastifyRequest, FastifyReply } from 'fastify';
import { AdminService } from './admin.service';

import type { CreateUserInput, UpdateUserInput, AdminActor, ListAlertsQuery } from './admin.service';
import type { AdminSettableStatus } from '@/modules/alerts/alert-status';

function actorOf(req: FastifyRequest): AdminActor {
  return { id: req.user!.id, permissions: req.user!.permissions };
}

export class AdminController {
  constructor(private readonly service: AdminService) {}

  listUsers = async (
    req: FastifyRequest<{ Querystring: { role?: string; search?: string; limit?: number; offset?: number } }>,
    reply: FastifyReply,
  ) => {
    const result = await this.service.listUsers(req.query.role, req.query.search, req.query.limit, req.query.offset);
    return reply.send({ success: true, ...result });
  };

  createUser = async (req: FastifyRequest<{ Body: CreateUserInput }>, reply: FastifyReply) => {
    const user = await this.service.createUser(actorOf(req), req.body);
    return reply.send({ success: true, data: user });
  };

  updateUser = async (req: FastifyRequest<{ Params: { id: string }; Body: UpdateUserInput }>, reply: FastifyReply) => {
    const user = await this.service.updateUser(actorOf(req), req.params.id, req.body);
    return reply.send({ success: true, data: user });
  };

  deleteUser = async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const data = await this.service.deleteUser(actorOf(req), req.params.id);
    const message = data.result === 'deleted' ? 'User deleted' : 'User has history and was deactivated instead';
    return reply.send({ success: true, message, data });
  };

  updateUserStatus = async (
    req: FastifyRequest<{ Params: { id: string }; Body: { isVerified: boolean } }>,
    reply: FastifyReply,
  ) => {
    await this.service.updateUserVerification(req.params.id, req.body.isVerified);
    return reply.send({ success: true, message: 'User status updated' });
  };

  listResponders = async (
    req: FastifyRequest<{ Querystring: { isVerified?: boolean; search?: string; limit?: number } }>,
    reply: FastifyReply,
  ) => {
    const data = await this.service.listResponders(req.query.isVerified, req.query.search, req.query.limit);
    return reply.send({ success: true, data });
  };

  verifyResponder = async (
    req: FastifyRequest<{ Params: { id: string }; Body: { isVerified: boolean } }>,
    reply: FastifyReply,
  ) => {
    await this.service.verifyResponder(req.params.id, req.body.isVerified);
    return reply.send({ success: true, message: 'Responder verification updated' });
  };

  deleteResponder = async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    await this.service.deleteResponder(req.params.id);
    return reply.send({ success: true, message: 'Responder deleted successfully' });
  };

  listAuditLogs = async (
    req: FastifyRequest<{ Querystring: { search?: string; limit?: number; cursor?: string } }>,
    reply: FastifyReply,
  ) => {
    const { items, nextCursor } = await this.service.listAuditLogs(
      req.query.search,
      req.query.limit,
      req.query.cursor,
    );
    // `data` keeps its existing shape (an array) so the admin portal is
    // unaffected; pass `nextCursor` back as ?cursor= to page further.
    return reply.send({ success: true, data: items, nextCursor });
  };

  getHealth = async (
    _req: FastifyRequest,
    reply: FastifyReply,
  ) => {
    const data = await this.service.getHealth();
    return reply.send({ success: true, data });
  };

  listAlerts = async (req: FastifyRequest<{ Querystring: ListAlertsQuery }>, reply: FastifyReply) => {
    // `data` stays an array (existing portal callers); paging info alongside.
    const { data, total, limit, offset } = await this.service.listAlerts(req.query);
    return reply.send({ success: true, data, total, limit, offset });
  };

  getAlertById = async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const data = await this.service.getAlertById(req.params.id);
    return reply.send({ success: true, data });
  };

  setAlertStatus = async (
    req: FastifyRequest<{ Params: { id: string }; Body: { status: AdminSettableStatus; note?: string } }>,
    reply: FastifyReply,
  ) => {
    const data = await this.service.setAlertStatus(actorOf(req), req.params.id, req.body.status, req.body.note);
    return reply.send({ success: true, data });
  };

  listIncidents = async (
    req: FastifyRequest<{ Querystring: { status?: string; limit?: string | number } }>,
    reply: FastifyReply,
  ) => {
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const data = await this.service.listIncidents(req.query.status, limit);
    return reply.send({ success: true, data });
  };

  updateIncidentStatus = async (
    req: FastifyRequest<{ Params: { id: string }; Body: { status: string } }>,
    reply: FastifyReply,
  ) => {
    const data = await this.service.updateIncidentStatus(req.params.id, req.body.status);
    return reply.send({ success: true, data });
  };

  getAnalytics = async (
    _req: FastifyRequest,
    reply: FastifyReply,
  ) => {
    const data = await this.service.getAnalyticsData();
    return reply.send({ success: true, data });
  };
}
