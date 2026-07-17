import { FastifyInstance } from 'fastify';
import { IncidentsRepository } from './incidents.repository';
import { IncidentType, IncidentStatus, IncidentReport } from '@prisma/client';
import { NotFoundError } from '@/utils/errors';

export class IncidentsService {
  constructor(
    private readonly repo: IncidentsRepository,
    private readonly fastify: FastifyInstance
  ) {}

  async submitIncident(type: IncidentType, latitude: number, longitude: number, description?: string): Promise<IncidentReport> {
    // Fuzz coordinates to 2 decimal places (approx 1km accuracy) for anonymity
    const fuzzedLat = Math.round(latitude * 100) / 100;
    const fuzzedLng = Math.round(longitude * 100) / 100;
    const incident = await this.repo.createIncident(type, fuzzedLat, fuzzedLng, description);
    
    // Broadcast the new incident to the general police dispatch
    if (this.fastify.io) {
      this.fastify.io.to('station:dispatch').emit('incident:created', incident);
    }
    
    return incident;
  }

  async listIncidentsForAdmin(status: IncidentStatus, limit: number): Promise<IncidentReport[]> {
    return this.repo.getIncidentsByStatus(status, limit);
  }

  async updateIncidentStatus(id: string, status: IncidentStatus): Promise<IncidentReport> {
    try {
      return await this.repo.updateIncidentStatus(id, status);
    } catch (err) {
      throw new NotFoundError('Incident not found');
    }
  }

  async updateIncident(id: string, data: { type?: IncidentType; description?: string }): Promise<IncidentReport> {
    try {
      return await this.repo.updateIncident(id, data);
    } catch (err) {
      throw new NotFoundError('Incident not found');
    }
  }

  async deleteIncident(id: string): Promise<IncidentReport> {
    try {
      return await this.repo.deleteIncident(id);
    } catch (err) {
      throw new NotFoundError('Incident not found');
    }
  }

  async calculateSafetyScore(latitude: number, longitude: number): Promise<{ score: number, factors: any }> {
    const radiusMeters = 2000; // 2km radius
    const daysAgo30 = new Date();
    daysAgo30.setDate(daysAgo30.getDate() - 30);

    const incidents = await this.repo.getVerifiedIncidentsInRadius(latitude, longitude, radiusMeters, daysAgo30);

    let baseScore = 100;
    const factors = {
      harassment: 0,
      robbery: 0,
      suspicious_activity: 0,
      poor_lighting: 0,
      other: 0,
      total_deductions: 0
    };

    for (const incident of incidents) {
      switch (incident.type) {
        case 'harassment':
          baseScore -= 15;
          factors.harassment++;
          factors.total_deductions += 15;
          break;
        case 'robbery':
          baseScore -= 20;
          factors.robbery++;
          factors.total_deductions += 20;
          break;
        case 'suspicious_activity':
          baseScore -= 10;
          factors.suspicious_activity++;
          factors.total_deductions += 10;
          break;
        case 'poor_lighting':
          baseScore -= 5;
          factors.poor_lighting++;
          factors.total_deductions += 5;
          break;
        case 'other':
          baseScore -= 2;
          factors.other++;
          factors.total_deductions += 2;
          break;
      }
    }

    if (baseScore < 0) {
      baseScore = 0;
    }

    return {
      score: baseScore,
      factors
    };
  }
}
