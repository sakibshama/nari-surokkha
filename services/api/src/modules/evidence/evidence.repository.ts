import { PrismaClient, EvidenceType, AlertEvidence } from '@prisma/client';

export class EvidenceRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async saveEvidence(data: {
    alertId: string;
    type: EvidenceType;
    fileKey: string;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    checksum: string;
  }): Promise<AlertEvidence> {
    return this.prisma.alertEvidence.create({
      data: {
        alertId: data.alertId,
        type: data.type,
        fileKey: data.fileKey,
        originalName: data.originalName,
        mimeType: data.mimeType,
        sizeBytes: data.sizeBytes,
        checksum: data.checksum,
      },
    });
  }

  async getEvidenceByAlert(alertId: string): Promise<AlertEvidence[]> {
    return this.prisma.alertEvidence.findMany({
      where: { alertId },
      orderBy: { uploadedAt: 'desc' },
    });
  }

  async getEvidenceById(id: string): Promise<AlertEvidence | null> {
    return this.prisma.alertEvidence.findUnique({
      where: { id },
      include: {
        alert: true,
      }
    });
  }

  /**
   * All evidence belonging to a given user (across every one of their alerts),
   * newest first — powers the in-app personal Evidence Library.
   */
  async getEvidenceByUser(userId: string, limit = 300) {
    return this.prisma.alertEvidence.findMany({
      where: { alert: { userId } },
      orderBy: { uploadedAt: 'desc' },
      take: limit,
      include: {
        alert: { select: { id: true, type: true, status: true, createdAt: true } },
      },
    });
  }

  /** Remove an evidence row. The stored object is deleted separately. */
  async deleteEvidence(id: string): Promise<void> {
    // Access logs reference this row; clear them first so the delete cannot
    // fail on a foreign key. The audit_log entry is what preserves the record
    // that a deletion happened.
    await this.prisma.evidenceAccessLog.deleteMany({ where: { evidenceId: id } });
    await this.prisma.alertEvidence.delete({ where: { id } });
  }

  /**
   * Evidence eligible for retention purge: attached to an alert that was
   * CLOSED longer ago than the cutoff, and with no case still open against it.
   *
   * Evidence for an open alert or a live case is never returned here, however
   * old it is. Deleting the record of an assault while someone is still being
   * prosecuted for it would be considerably worse than keeping it too long.
   */
  async findExpiredEvidence(olderThan: Date, limit = 500) {
    return this.prisma.alertEvidence.findMany({
      where: {
        alert: {
          closedAt: { not: null, lt: olderThan },
          cases: { none: { status: { notIn: ['closed', 'false_alarm'] } } },
        },
      },
      select: { id: true, fileKey: true, alertId: true },
      take: limit,
    });
  }

  async logAccess(evidenceId: string, accessedBy: string, ipAddress?: string): Promise<void> {
    await this.prisma.evidenceAccessLog.create({
      data: {
        evidenceId,
        accessedBy,
        ipAddress,
      },
    });
  }
}
