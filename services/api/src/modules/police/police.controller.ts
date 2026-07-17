/**
 * Police Controller
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { AuthenticatedUser } from '../../types';
import { PoliceService } from './police.service';

export class PoliceController {
  constructor(private readonly service: PoliceService) {}

  login = async (
    req: FastifyRequest<{ Body: { identifier: string; password: string } }>,
    reply: FastifyReply,
  ) => {
    const result = await this.service.login(req.body.identifier, req.body.password);
    return reply.status(200).send({
      success: true,
      message: 'Login successful',
      data: result,
    });
  };

  getStations = async (
    _req: FastifyRequest,
    reply: FastifyReply,
  ) => {
    const stations = await this.service.getStations();
    return reply.status(200).send({
      success: true,
      data: stations,
    });
  };

  getResponders = async (
    _req: FastifyRequest,
    reply: FastifyReply,
  ) => {
    const responders = await this.service.getResponders();
    return reply.status(200).send({
      success: true,
      data: responders,
    });
  };

  getActiveAlerts = async (
    req: FastifyRequest,
    reply: FastifyReply,
  ) => {
    const user = req.user as AuthenticatedUser;
    const alerts = await this.service.getActiveAlerts(user.stationId!);
    return reply.status(200).send({
      success: true,
      data: alerts,
    });
  };

  getAlertById = async (
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) => {
    const user = req.user as AuthenticatedUser;
    const alert = await this.service.getAlertById(req.params.id, user.stationId!);
    return reply.status(200).send({
      success: true,
      data: alert,
    });
  };

  updateAlertStatus = async (
    req: FastifyRequest<{ Params: { id: string }; Body: { status: string } }>,
    reply: FastifyReply,
  ) => {
    const user = req.user as AuthenticatedUser;
    const alert = await this.service.updateAlertStatus(
      req.params.id,
      req.body.status,
      user.stationId!,
      user.id
    );

    return reply.status(200).send({
      success: true,
      message: 'Alert status updated',
      data: alert,
    });
  };

  getProfile = async (
    req: FastifyRequest,
    reply: FastifyReply,
  ) => {
    const user = req.user as AuthenticatedUser;
    const profile = await this.service.getProfile(user.id);
    return reply.status(200).send({
      success: true,
      data: profile,
    });
  };

  updateProfile = async (
    req: FastifyRequest<{ Body: { phone?: string; email?: string } }>,
    reply: FastifyReply,
  ) => {
    const user = req.user as AuthenticatedUser;
    const profile = await this.service.updateProfile(user.id, req.body);
    return reply.status(200).send({
      success: true,
      message: 'Profile updated successfully',
      data: profile,
    });
  };

  changePassword = async (
    req: FastifyRequest<{ Body: { currentPassword: string; newPassword: string } }>,
    reply: FastifyReply,
  ) => {
    const user = req.user as AuthenticatedUser;
    await this.service.changePassword(user.id, req.body.currentPassword, req.body.newPassword);
    return reply.status(200).send({
      success: true,
      message: 'Password changed successfully',
    });
  };
}
