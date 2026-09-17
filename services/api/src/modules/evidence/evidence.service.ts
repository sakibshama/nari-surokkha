import { FastifyInstance } from 'fastify';
import { EvidenceRepository } from './evidence.repository';
import { EvidenceType } from '@prisma/client';
import type { Readable } from 'stream';
import { emitToAlert } from '@/utils/alert-rooms';

/** Roles allowed to view any user's evidence. */
function isAdminRole(role: string): boolean {
  return role === 'admin' || role === 'superadmin';
}

export class EvidenceService {
  constructor(
    private readonly repository: EvidenceRepository,
    private readonly fastify: FastifyInstance
  ) {}

  async processUpload(
    alertId: string,
    userId: string,
    fileStream: Readable,
    originalName: string,
    mimeType: string,
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

    // 3. Stream straight to storage — nothing is buffered whole in memory.
    const { fileKey, sizeBytes, checksum } = await this.fastify.storage.uploadStream(
      fileStream,
      originalName,
      mimeType,
    );

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

    // 5. Emit realtime event.
    //    Scoped to the alert room and the admin view.
    //    This used to be a bare io.emit(), which broadcast the alert id to
    //    every connected client on the platform — including every citizen.
    emitToAlert(this.fastify, alertId, 'evidence_uploaded', {
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

    // Owners see their own; admins can see any.
    if (!isAdminRole(requestUser.role) && alert.userId !== requestUser.id) {
      throw this.fastify.httpErrors.forbidden('Not authorized to view this alert');
    }

    return this.repository.getEvidenceByAlert(alertId);
  }

  /**
   * The requesting user's personal evidence library — every piece of evidence
   * across all of their alerts, each with a fresh pre-signed download URL so the
   * app can list + download without an extra round-trip per item.
   */
  async listMyEvidence(userId: string, publicBaseUrl?: string) {
    const rows = await this.repository.getEvidenceByUser(userId);
    // 1-hour URLs so the user has time to view/download from the library.
    const expiresIn = 3600;
    return Promise.all(
      rows.map(async (e) => ({
        id: e.id,
        alertId: e.alertId,
        type: e.type,
        originalName: e.originalName,
        mimeType: e.mimeType,
        sizeBytes: Number(e.sizeBytes),
        uploadedAt: e.uploadedAt,
        alertType: e.alert?.type ?? null,
        alertStatus: e.alert?.status ?? null,
        alertDate: e.alert?.createdAt ?? null,
        url: await this.fastify.storage.getPresignedUrl(e.fileKey, expiresIn, publicBaseUrl),
      })),
    );
  }

  /**
   * Return the raw bytes of an evidence file (access-controlled). Used by the
   * mobile app, which fetches through the authenticated API client — the most
   * reliable path (no dependency on a public URL being reachable from the device).
   */
  async getFileContent(evidenceId: string, requestUser: { id: string; role: string }, ipAddress?: string) {
    const evidence = await this.repository.getEvidenceById(evidenceId);
    if (!evidence) {
      throw this.fastify.httpErrors.notFound('Evidence not found');
    }
    const alert = (evidence as unknown as { alert: { userId: string } }).alert;
    if (requestUser.role === 'citizen' && alert.userId !== requestUser.id) {
      throw this.fastify.httpErrors.forbidden('Not authorized to access this evidence');
    }

    let buffer: Buffer;
    try {
      buffer = await this.fastify.storage.getFileBuffer(evidence.fileKey);
    } catch (err) {
      this.fastify.log.error({ err, fileKey: evidence.fileKey }, 'Evidence file missing on storage');
      throw this.fastify.httpErrors.notFound('Evidence file is no longer available');
    }

    await this.repository.logAccess(evidence.id, requestUser.id, ipAddress);
    return { buffer, mimeType: evidence.mimeType, originalName: evidence.originalName };
  }

  async getPresignedUrl(evidenceId: string, requestUser: { id: string, role: string }, ipAddress?: string, publicBaseUrl?: string) {
    const evidence = await this.repository.getEvidenceById(evidenceId);
    if (!evidence) {
      throw this.fastify.httpErrors.notFound('Evidence not found');
    }

    // Access Control: Owner or Admin
    // Note: evidence.alert is populated from repository
    const alert = (evidence as any).alert;
    if (!isAdminRole(requestUser.role) && alert.userId !== requestUser.id) {
      throw this.fastify.httpErrors.forbidden('Not authorized to access this evidence');
    }

    // Generate URL
    const expiresIn = 900; // 15 mins
    const url = await this.fastify.storage.getPresignedUrl(evidence.fileKey, expiresIn, publicBaseUrl);

    // Audit Log
    await this.repository.logAccess(evidence.id, requestUser.id, ipAddress);

    return { url, expiresIn };
  }
  /**
   * Roll back an upload that turned out to be invalid (e.g. truncated).
   * Removes both the database row and the stored object, so a partial file
   * never lingers as evidence anyone might later rely on.
   */
  async discardUpload(evidenceId: string, fileKey: string): Promise<void> {
    await Promise.allSettled([
      this.repository.deleteEvidence(evidenceId),
      this.fastify.storage.deleteFile(fileKey),
    ]);
    this.fastify.log.warn({ evidenceId, fileKey }, 'Discarded invalid evidence upload');
  }

  /**
   * Permanently erase a piece of evidence at the owner's request.
   *
   * Only the owner may do this. The deletion itself is recorded in the audit log.
   */
  async deleteOwnEvidence(evidenceId: string, requestUser: { id: string; role: string }): Promise<void> {
    const evidence = await this.repository.getEvidenceById(evidenceId);
    if (!evidence) {
      throw this.fastify.httpErrors.notFound('Evidence not found');
    }

    const alert = (evidence as unknown as { alert: { id: string; userId: string } }).alert;
    if (alert.userId !== requestUser.id) {
      throw this.fastify.httpErrors.forbidden('You can only delete your own evidence');
    }

    await this.fastify.storage.deleteFile(evidence.fileKey);
    await this.repository.deleteEvidence(evidenceId);

    await this.fastify.prisma.auditLog.create({
      data: {
        userId: requestUser.id,
        action: 'deleted',
        entityType: 'evidence',
        entityId: evidenceId,
        metadata: { reason: 'subject_erasure_request', alertId: alert.id },
      },
    });

    this.fastify.log.info({ evidenceId, userId: requestUser.id }, 'Evidence erased at owner request');
  }

}
