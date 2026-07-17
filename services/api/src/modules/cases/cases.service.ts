import { FastifyInstance } from 'fastify';
import { CasesRepository } from './cases.repository';
import { CaseStatus } from '@prisma/client';
import { NotFoundError, ForbiddenError } from '@/utils/errors';
import { randomBytes } from 'crypto';

export class CasesService {
  constructor(
    private readonly repo: CasesRepository,
    private readonly fastify: FastifyInstance,
  ) {}

  async createCaseFromAlert(alertId: string, stationId: string) {
    // Generate unique case number e.g. CASE-2026-ABCD
    const year = new Date().getFullYear();
    const randomChars = randomBytes(2).toString('hex').toUpperCase();
    const caseNumber = `CASE-${year}-${randomChars}`;
    
    const newCase = await this.repo.createCase(alertId, stationId, caseNumber);
    this.fastify.log.info(`Created case ${caseNumber} for alert ${alertId}`);
    return newCase;
  }

  async getStationCases(stationId: string, status?: string) {
    return this.repo.findCasesByStation(stationId, status as CaseStatus);
  }

  async getCaseDetails(caseId: string, policeStationId: string) {
    const c = await this.repo.findCaseById(caseId);
    if (!c) throw new NotFoundError('Case not found');
    if (c.stationId !== policeStationId) throw new ForbiddenError('Case belongs to another station');
    return c;
  }

  async assignOfficer(caseId: string, officerId: string, assignerId: string, assignerStationId: string, note?: string) {
    const c = await this.getCaseDetails(caseId, assignerStationId);
    if (c.status === 'closed' || c.status === 'false_alarm') {
      throw new ForbiddenError('Cannot modify closed case');
    }
    return this.repo.assignOfficer(caseId, officerId, assignerId, note);
  }

  async updateStatus(caseId: string, newStatus: string, officerId: string, stationId: string, note?: string, closedReason?: string) {
    const c = await this.getCaseDetails(caseId, stationId);
    if (c.status === 'closed' || c.status === 'false_alarm') {
      throw new ForbiddenError('Cannot modify closed case');
    }
    return this.repo.updateCaseStatus(caseId, newStatus as CaseStatus, officerId, note, closedReason);
  }

  async addNote(caseId: string, officerId: string, stationId: string, note: string) {
    const c = await this.getCaseDetails(caseId, stationId);
    if (c.status === 'closed' || c.status === 'false_alarm') {
      throw new ForbiddenError('Cannot modify closed case');
    }
    return this.repo.addNote(caseId, officerId, note);
  }

  async getCaseTimeline(caseId: string, stationId: string) {
    const c = await this.getCaseDetails(caseId, stationId);
    
    // Aggregate timelines
    const updates = await this.repo.getCaseUpdates(caseId);
    const locations = await this.repo.getAlertLocations(c.alertId);
    const evidence = await this.repo.getAlertEvidence(c.alertId);

    // Combine into a single sorted timeline array for easy rendering
    const timeline = [
      ...updates.map(u => ({ type: 'update', timestamp: u.createdAt, data: u })),
      ...locations.map(l => ({ type: 'location', timestamp: l.timestamp, data: l })),
      ...evidence.map(e => ({ type: 'evidence', timestamp: (e as any).uploadedAt, data: e }))
    ].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return { case: c, timeline };
  }

  async generateCaseReport(caseId: string, stationId: string) {
    const timelineData = await this.getCaseTimeline(caseId, stationId);
    const { case: c, timeline } = timelineData;
    
    let report = `CASE REPORT: ${c.caseNumber}\n`;
    report += `Status: ${c.status.toUpperCase()}\n`;
    report += `Created At: ${c.createdAt.toISOString()}\n`;
    report += `Victim: ${(c.alert as any)?.user?.profile?.fullName || 'Unknown'} (${(c.alert as any)?.user?.phone || 'Unknown'})\n`;
    if (c.assignedOfficer) {
      report += `Assigned Officer: ${(c.assignedOfficer as any).profile?.fullName || c.assignedOfficer.badgeNumber}\n`;
    }
    report += `\n--- TIMELINE ---\n`;
    
    for (const item of timeline) {
      const timeStr = item.timestamp.toISOString();
      if (item.type === 'update') {
        const u = item.data as any;
        report += `[${timeStr}] Officer Note: ${u.note}\n`;
      } else if (item.type === 'location') {
        const l = item.data as any;
        report += `[${timeStr}] Location Update: Lat ${l.latitude}, Lng ${l.longitude}\n`;
      } else if (item.type === 'evidence') {
        const e = item.data as any;
        report += `[${timeStr}] Evidence Added: ${e.type} (${e.fileKey})\n`;
      }
    }
    return report;
  }
}
