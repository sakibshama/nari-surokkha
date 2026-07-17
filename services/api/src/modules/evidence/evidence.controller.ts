import { FastifyRequest, FastifyReply } from 'fastify';
import { EvidenceService } from './evidence.service';

export class EvidenceController {
  constructor(private readonly service: EvidenceService) {}

  uploadEvidence = async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const alertId = req.params.id;
    const userId = req.user?.id as string;

    const data = await req.file();
    if (!data) {
      throw req.server.httpErrors.badRequest('No file uploaded');
    }

    const fileBuffer = await data.toBuffer();
    const mimeType = data.mimetype;
    const originalName = data.filename;

    const evidence = await this.service.processUpload(alertId, userId, fileBuffer, originalName, mimeType);

    return reply.code(201).send({
      message: 'Evidence uploaded successfully',
      data: {
        ...evidence,
        sizeBytes: Number(evidence.sizeBytes), // convert bigint
      }
    });
  };

  listEvidence = async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const alertId = req.params.id;
    const requestUser = { id: req.user?.id as string, role: req.user?.role as string };

    const evidenceList = await this.service.listEvidence(alertId, requestUser);

    return reply.send({
      data: evidenceList.map(e => ({
        ...e,
        sizeBytes: Number(e.sizeBytes),
      }))
    });
  };

  getEvidenceUrl = async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const evidenceId = req.params.id;
    const requestUser = { id: req.user?.id as string, role: req.user?.role as string };
    const ipAddress = req.ip;

    const result = await this.service.getPresignedUrl(evidenceId, requestUser, ipAddress);

    return reply.send(result);
  };
}
