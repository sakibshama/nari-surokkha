import { FastifyRequest, FastifyReply } from 'fastify';
import { AdminService } from './admin.service';

import { ForbiddenError } from '@/utils/errors';

export class AdminController {
  constructor(private readonly service: AdminService) {}

  listUsers = async (
    req: FastifyRequest<{ Querystring: { role?: string; search?: string; limit?: number; offset?: number } }>,
    reply: FastifyReply,
  ) => {
    const result = await this.service.listUsers(req.query.role, req.query.search, req.query.limit, req.query.offset);
    return reply.send({ success: true, ...result });
  };

  createUser = async (req: FastifyRequest<{ Body: any }>, reply: FastifyReply) => {
    const body = req.body as any;
    const permissions = req.user?.permissions || [];
    if (body.role === 'admin' && !permissions.includes('manage_admins')) {
      throw new ForbiddenError('You do not have permission to create an admin user');
    }
    const user = await this.service.createUser(body);
    return reply.send({ success: true, data: user });
  };

  updateUser = async (req: FastifyRequest<{ Params: { id: string }; Body: any }>, reply: FastifyReply) => {
    const body = req.body as any;
    const permissions = req.user?.permissions || [];
    if (body.role === 'admin' && !permissions.includes('manage_admins')) {
      throw new ForbiddenError('You do not have permission to assign the admin role');
    }
    const user = await this.service.updateUser(req.params.id, body);
    return reply.send({ success: true, data: user });
  };

  deleteUser = async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    await this.service.deleteUser(req.params.id);
    return reply.send({ success: true, message: 'User deleted successfully' });
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

  listStations = async (req: FastifyRequest<{ Querystring: { search?: string; limit?: number } }>, reply: FastifyReply) => {
    const data = await this.service.listStations(req.query.search, req.query.limit);
    return reply.send({ success: true, data });
  };

  createStation = async (req: FastifyRequest<{ Body: any }>, reply: FastifyReply) => {
    const station = await this.service.createStation(req.body);
    return reply.send({ success: true, data: station });
  };

  updateStation = async (req: FastifyRequest<{ Params: { id: string }; Body: any }>, reply: FastifyReply) => {
    const station = await this.service.updateStation(req.params.id, req.body);
    return reply.send({ success: true, data: station });
  };

  deleteStation = async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    await this.service.deleteStation(req.params.id);
    return reply.send({ success: true, message: 'Station deleted successfully' });
  };

  listAuditLogs = async (
    req: FastifyRequest<{ Querystring: { search?: string; limit?: number } }>,
    reply: FastifyReply,
  ) => {
    const data = await this.service.listAuditLogs(req.query.search, req.query.limit);
    return reply.send({ success: true, data });
  };

  getHealth = async (
    _req: FastifyRequest,
    reply: FastifyReply,
  ) => {
    const data = await this.service.getHealth();
    return reply.send({ success: true, data });
  };

  listAlerts = async (
    req: FastifyRequest<{ Querystring: { status?: any; limit?: string | number } }>,
    reply: FastifyReply,
  ) => {
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const data = await this.service.listAlerts(req.query.status, limit);
    return reply.send({ success: true, data });
  };

  getAlertById = async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const data = await this.service.getAlertById(req.params.id);
    return reply.send({ success: true, data });
  };

  listIncidents = async (
    req: FastifyRequest<{ Querystring: { status?: any; limit?: string | number } }>,
    reply: FastifyReply,
  ) => {
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const data = await this.service.listIncidents(req.query.status, limit);
    return reply.send({ success: true, data });
  };

  updateIncidentStatus = async (
    req: FastifyRequest<{ Params: { id: string }; Body: { status: any } }>,
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
