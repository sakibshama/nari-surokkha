import { FastifyRequest, FastifyReply } from 'fastify';
import { EvidenceService } from './evidence.service';

/** Public base URL the client used to reach us, honouring the nginx proxy. */
function publicBaseFromRequest(req: FastifyRequest): string | undefined {
  const host = req.headers.host;
  if (!host) return undefined;
  const xfProto = req.headers['x-forwarded-proto'];
  const proto = (Array.isArray(xfProto) ? xfProto[0] : xfProto)?.split(',')[0].trim()
    || req.protocol
    || 'https';
  return `${proto}://${host}`;
}

export class EvidenceController {
  constructor(private readonly service: EvidenceService) {}

  uploadEvidence = async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const alertId = req.params.id;
    const userId = req.user?.id as string;

    const data = await req.file();
    if (!data) {
      throw req.server.httpErrors.badRequest('No file uploaded');
    }

    // data.file is the multipart READ STREAM. Calling data.toBuffer() here —
    // as this did — pulled the whole upload into heap before a single byte
    // reached storage: 10MB per upload, and twenty concurrent uploads is
    // 200MB in a container capped at 1GB. Passing the stream through means
    // memory stays flat regardless of file size or concurrency.
    const evidence = await this.service.processUpload(
      alertId,
      userId,
      data.file,
      data.filename,
      data.mimetype,
    );

    // @fastify/multipart sets this when the file exceeded the configured limit.
    // The stream is truncated at that point, so the stored object would be a
    // silently incomplete piece of evidence — reject it instead.
    if ((data.file as unknown as { truncated?: boolean }).truncated) {
      await this.service.discardUpload(evidence.id, evidence.fileKey);
      throw req.server.httpErrors.badRequest('File exceeds the 10MB limit');
    }

    return reply.code(201).send({
      message: 'Evidence uploaded successfully',
      data: {
        ...evidence,
        sizeBytes: Number(evidence.sizeBytes), // convert bigint
      }
    });
  };

  /**
   * DELETE /evidence/:id — the uploader erasing their own evidence.
   *
   * A user should be able to remove a recording of the worst moment of their
   * life once it is no longer needed. The service refuses while a police case
   * is still open against the alert, and records the deletion in the audit log.
   */
  deleteEvidence = async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const requestUser = { id: req.user?.id as string, role: req.user?.role as string };
    await this.service.deleteOwnEvidence(req.params.id, requestUser);
    return reply.send({ success: true, message: 'Evidence permanently deleted' });
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

  listMyEvidence = async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = req.user?.id as string;
    const data = await this.service.listMyEvidence(userId, publicBaseFromRequest(req));
    return reply.send({ success: true, data });
  };

  // Streams the raw file bytes (access-controlled). The mobile app uses this
  // over the authenticated API client so images always load regardless of
  // public-URL reachability.
  getRaw = async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const requestUser = { id: req.user?.id as string, role: req.user?.role as string };
    const { buffer, mimeType, originalName } = await this.service.getFileContent(req.params.id, requestUser, req.ip);
    return reply
      .header('Content-Type', mimeType || 'application/octet-stream')
      .header('Content-Disposition', `inline; filename="${encodeURIComponent(originalName || 'evidence')}"`)
      .header('Cache-Control', 'private, max-age=3600')
      .header('Cross-Origin-Resource-Policy', 'cross-origin')
      .send(buffer);
  };

  getEvidenceUrl = async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const evidenceId = req.params.id;
    const requestUser = { id: req.user?.id as string, role: req.user?.role as string };
    const ipAddress = req.ip;

    const result = await this.service.getPresignedUrl(evidenceId, requestUser, ipAddress, publicBaseFromRequest(req));

    return reply.send(result);
  };
}
