import { FastifyRequest, FastifyReply } from 'fastify';
import { IncidentsService } from './incidents.service';
import { IncidentType, IncidentStatus } from '@prisma/client';

export class IncidentsController {
  constructor(private readonly service: IncidentsService) {}

  submitIncident = async (
    req: FastifyRequest<{
      Body: { type: IncidentType; latitude: number; longitude: number; description?: string };
    }>,
    reply: FastifyReply,
  ) => {
    // Location Fuzzing: Truncate to 3 decimal places (~111 meters) to protect reporter privacy
    // while still maintaining enough accuracy for the safety heat map.
    const fuzzedLat = Math.round(req.body.latitude * 1000) / 1000;
    const fuzzedLng = Math.round(req.body.longitude * 1000) / 1000;

    const incident = await this.service.submitIncident(
      req.body.type,
      fuzzedLat,
      fuzzedLng,
      req.body.description
    );

    return reply.status(201).send({
      success: true,
      message: 'Incident reported anonymously',
      data: incident,
    });
  };

  listIncidentsForAdmin = async (
    req: FastifyRequest<{
      Querystring: { status: IncidentStatus; limit?: number };
    }>,
    reply: FastifyReply,
  ) => {
    const limit = req.query.limit || 50;
    const incidents = await this.service.listIncidentsForAdmin(req.query.status, limit);

    return reply.status(200).send({
      success: true,
      data: incidents,
    });
  };

  updateIncidentStatus = async (
    req: FastifyRequest<{
      Params: { id: string };
      Body: { status: IncidentStatus };
    }>,
    reply: FastifyReply,
  ) => {
    await this.service.updateIncidentStatus(req.params.id, req.body.status);

    return reply.status(200).send({
      success: true,
      message: 'Incident status updated successfully',
    });
  };

  updateIncident = async (
    req: FastifyRequest<{
      Params: { id: string };
      Body: { type?: IncidentType; description?: string };
    }>,
    reply: FastifyReply,
  ) => {
    const updated = await this.service.updateIncident(req.params.id, req.body);

    return reply.status(200).send({
      success: true,
      message: 'Incident updated successfully',
      data: updated,
    });
  };

  deleteIncident = async (
    req: FastifyRequest<{
      Params: { id: string };
    }>,
    reply: FastifyReply,
  ) => {
    await this.service.deleteIncident(req.params.id);

    return reply.status(200).send({
      success: true,
      message: 'Incident deleted successfully',
    });
  };

  getSafetyScore = async (
    req: FastifyRequest<{
      Querystring: { latitude: number; longitude: number };
    }>,
    reply: FastifyReply,
  ) => {
    const result = await this.service.calculateSafetyScore(req.query.latitude, req.query.longitude);

    return reply.status(200).send({
      success: true,
      data: result,
    });
  };
}
