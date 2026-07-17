import { FastifyInstance } from 'fastify';
import { EvidenceRepository } from './evidence.repository';
import { EvidenceType } from '@prisma/client';

export class EvidenceService {
  constructor(
    private readonly repository: EvidenceRepository,
    private readonly fastify: FastifyInstance
  ) {}

  async processUpload(
    alertId: string, 
    userId: string,
    fileBuffer: Buffer, 
    originalName: string, 
    mimeType: string
  ) {
    // 1. Verify alert exists and belongs to user (or user is authorized)
    const alert = await this.fastify.prisma.emergencyAlert.findUnique({
      where: { id: alertId }
    });

    if (!alert) {
      throw this.fastify.httpErrors.notFound('Alert not found');
    }

    if (alert.userId !== userId) {
      throw this.fastify.httpErrors.forbidden('Not authorized to upload evidence for this alert');
    }

    // 2. Determine evidence type
    let type: EvidenceType = 'document';
    if (mimeType.startsWith('image/')) type = 'photo';
    else if (mimeType.startsWith('audio/')) type = 'audio';
    else if (mimeType.startsWith('video/')) type = 'video';

    // 3. Upload via Storage Plugin
    const { fileKey, sizeBytes, checksum } = await this.fastify.storage.uploadFile(fileBuffer, originalName, mimeType);

    // 4. Save Metadata
    const evidence = await this.repository.saveEvidence({
      alertId,
      type,
      fileKey,
      originalName,
      mimeType,
      sizeBytes,
      checksum
    });

    // 5. Emit Realtime Event to Police
    this.fastify.io.emit('evidence_uploaded', {
      alertId,
      evidenceId: evidence.id,
      type: evidence.type,
    });

    return evidence;
  }

  async listEvidence(alertId: string, requestUser: { id: string, role: string }) {
    const alert = await this.fastify.prisma.emergencyAlert.findUnique({
      where: { id: alertId }
    });

    if (!alert) {
      throw this.fastify.httpErrors.notFound('Alert not found');
    }

    // Citizen can see their own, police/admin can see any
    if (requestUser.role === 'citizen' && alert.userId !== requestUser.id) {
      throw this.fastify.httpErrors.forbidden('Not authorized to view this alert');
    }

    return this.repository.getEvidenceByAlert(alertId);
  }

  async getPresignedUrl(evidenceId: string, requestUser: { id: string, role: string }, ipAddress?: string) {
    const evidence = await this.repository.getEvidenceById(evidenceId);
    if (!evidence) {
      throw this.fastify.httpErrors.notFound('Evidence not found');
    }

    // Access Control: Owner or Police/Admin
    // Note: evidence.alert is populated from repository
    const alert = (evidence as any).alert;
    if (requestUser.role === 'citizen' && alert.userId !== requestUser.id) {
      throw this.fastify.httpErrors.forbidden('Not authorized to access this evidence');
    }

    // Generate URL
    const expiresIn = 900; // 15 mins
    const url = await this.fastify.storage.getPresignedUrl(evidence.fileKey, expiresIn);

    // Audit Log
    await this.repository.logAccess(evidence.id, requestUser.id, ipAddress);

    return { url, expiresIn };
  }
}
