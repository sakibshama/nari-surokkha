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
