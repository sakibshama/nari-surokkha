/**
 * Alerts Controller — HTTP Transport Layer
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { AlertsService } from './alerts.service';

export class AlertsController {
  constructor(private readonly service: AlertsService) {}

  createSosAlert = async (
    req: FastifyRequest<{
      Body: { latitude: number; longitude: number; accuracy?: number };
    }>,
    reply: FastifyReply,
  ) => {
    const alert = await this.service.triggerManualSos(
      req.user!.id,
      req.body,
      req.ip,
    );

    return reply.status(201).send({
      success: true,
      message: 'SOS Alert triggered successfully',
      data: alert,
    });
  };

  updateLocation = async (
    req: FastifyRequest<{
      Params: { id: string };
      Body: { latitude: number; longitude: number; accuracy?: number };
    }>,
    reply: FastifyReply,
  ) => {
    await this.service.updateLocation(
      req.user!.id,
      req.params.id,
      req.body
    );

    return reply.status(200).send({
      success: true,
      message: 'Location updated successfully',
    });
  };

  generateTrackingToken = async (
    req: FastifyRequest<{
      Params: { id: string };
      Body: { trustedContactId?: string };
    }>,
    reply: FastifyReply,
  ) => {
    const { token, expiresAt } = this.service.generateTrackingToken(
      req.user!.id,
      req.params.id,
      req.body.trustedContactId
    );

    return reply.status(200).send({
      success: true,
      message: 'Tracking token generated successfully',
      data: {
        token,
        expiresAt: expiresAt.toISOString(),
      },
    });
  };

  createSoftAlert = async (
    req: FastifyRequest<{
      Body: { latitude: number; longitude: number; accuracy?: number; mlMetadata?: any };
    }>,
    reply: FastifyReply,
  ) => {
    const alert = await this.service.createSoftAlert(req.user!.id, req.body);
    return reply.status(201).send({
      success: true,
      message: 'Soft alert triggered successfully',
      data: alert,
    });
  };

  cancelSoftAlert = async (
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) => {
    await this.service.cancelSoftAlert(req.user!.id, req.params.id);
    return reply.status(200).send({
      success: true,
      message: 'Soft alert cancelled',
    });
  };

  cancelSosAlert = async (
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) => {
    await this.service.cancelSosAlert(req.user!.id, req.params.id);
    return reply.status(200).send({
      success: true,
      message: 'SOS alert cancelled',
    });
  };

  confirmSoftAlert = async (
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) => {
    const alert = await this.service.confirmSoftAlert(req.user!.id, req.params.id);
    return reply.status(200).send({
      success: true,
      message: 'Soft alert confirmed',
      data: alert,
    });
  };

  receiveSmsWebhook = async (
    req: FastifyRequest<{ Body: { From: string; Body: string } }>,
    reply: FastifyReply,
  ) => {
    // Twilio sends urlencoded form data: From, Body, To, etc.
    const { From, Body } = req.body;
    
    if (From && Body) {
      // Process async so we can quickly return 200 OK to Twilio
      this.service.processSmsWebhook(From, Body).catch(err => {
        req.log.error(err, 'Failed to process SMS webhook');
      });
    }

    // Twilio expects a 200 OK response, ideally with TwiML, but an empty response is fine
    return reply.type('text/xml').status(200).send('<Response></Response>');
  };

  getSafeRoute = async (
    req: FastifyRequest<{ Body: { origin: any; destination: any } }>,
    reply: FastifyReply
  ) => {
    const route = await this.service.getSafeRoute(req.user!.id, req.body.origin, req.body.destination);
    return reply.send({ success: true, data: route });
  };

  updateRouteLocation = async (
    req: FastifyRequest<{ Params: { id: string }; Body: { latitude: number; longitude: number } }>,
    reply: FastifyReply
  ) => {
    const result = await this.service.updateRouteLocation(req.user!.id, req.params.id, req.body.latitude, req.body.longitude);
    return reply.send({ success: true, data: result });
  };
}
