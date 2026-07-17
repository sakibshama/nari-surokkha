import { PrismaClient, CaseStatus } from '@prisma/client';

export class CasesRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createCase(alertId: string, stationId: string, caseNumber: string) {
    return this.prisma.case.create({
      data: {
        alertId,
        stationId,
        caseNumber,
        status: 'open',
      },
    });
  }

  async findCaseById(caseId: string) {
    return this.prisma.case.findUnique({
      where: { id: caseId },
      include: {
        alert: true,
        assignedOfficer: true,
      },
    });
  }

  async findCasesByStation(stationId: string, status?: CaseStatus) {
    const where: any = { stationId };
    if (status) {
      where.status = status;
    }
    return this.prisma.case.findMany({
      where,
      include: {
        alert: true,
        assignedOfficer: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateCaseStatus(caseId: string, newStatus: CaseStatus, officerId: string, note?: string, closedReason?: string) {
    return this.prisma.$transaction(async (tx) => {
      const existingCase = await tx.case.findUnique({ where: { id: caseId } });
      if (!existingCase) throw new Error('Case not found');

      const updatedCase = await tx.case.update({
        where: { id: caseId },
        data: {
          status: newStatus,
          closedAt: (newStatus === 'closed' || newStatus === 'false_alarm') ? new Date() : null,
          closedReason: closedReason || null,
        },
      });

      await tx.caseUpdate.create({
        data: {
          caseId,
          officerId,
          previousStatus: existingCase.status,
          newStatus,
          note: note || `Status changed to ${newStatus}`,
        },
      });

      return updatedCase;
    });
  }

  async assignOfficer(caseId: string, officerId: string, assignerId: string, note?: string) {
    return this.prisma.$transaction(async (tx) => {
      // First get current status
      const currentCase = await tx.case.findUnique({ where: { id: caseId } });
      const previousStatus = currentCase?.status || 'open';
      
      const updatedCase = await tx.case.update({
        where: { id: caseId },
        data: {
          assignedOfficerId: officerId,
          status: 'assigned',
        },
      });

      await tx.caseUpdate.create({
        data: {
          caseId,
          officerId: assignerId,
          previousStatus: previousStatus,
          newStatus: 'assigned',
          note: note || `Officer ${officerId} assigned to case`,
        },
      });

      return updatedCase;
    });
  }

  async addNote(caseId: string, officerId: string, note: string) {
    return this.prisma.caseUpdate.create({
      data: {
        caseId,
        officerId,
        note,
      },
      include: {
        officer: true,
      },
    });
  }

  async getCaseUpdates(caseId: string) {
    return this.prisma.caseUpdate.findMany({
      where: { caseId },
      include: {
        officer: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getAlertLocations(alertId: string) {
    return this.prisma.alertLocation.findMany({
      where: { alertId },
      orderBy: { timestamp: 'desc' },
    });
  }

  async getAlertEvidence(alertId: string) {
    return this.prisma.alertEvidence.findMany({
      where: { alertId },
      orderBy: { uploadedAt: 'desc' },
    });
  }
}
