import { FastifyRequest, FastifyReply } from 'fastify';
import { IncidentsService } from './incidents.service';
import { IncidentType, IncidentStatus } from '@prisma/client';
import { createUploadToken, MAX_MEDIA_PER_INCIDENT, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES } from './incident-media';

export class IncidentsController {
  constructor(private readonly service: IncidentsService) {}

  submitIncident = async (
    req: FastifyRequest<{
      Body: { type: IncidentType; latitude: number; longitude: number; description?: string };
    }>,
    reply: FastifyReply,
  ) => {
    // The service fuzzes the location (once).
    const incident = await this.service.submitIncident(
      req.body.type,
      req.body.latitude,
      req.body.longitude,
      req.body.description
    );

    // Photos/videos are attached in follow-up requests authorised by this
    // short-lived token — the report itself stays account-less.
    const upload = createUploadToken(incident.id);
    return reply.status(201).send({
      success: true,
      message: 'Incident reported anonymously',
      data: {
        ...incident,
        uploadToken: upload.token,
        uploadTokenExpiresAt: upload.expiresAt,
        maxMedia: MAX_MEDIA_PER_INCIDENT,
        maxImageBytes: MAX_IMAGE_BYTES,
        maxVideoBytes: MAX_VIDEO_BYTES,
      },
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
