import { AdminRepository } from './admin.repository';
import { AuditLog } from '@prisma/client';
import { NotFoundError } from '@/utils/errors';

export class AdminService {
  constructor(private readonly repo: AdminRepository) {}

  async listUsers(roleKey?: string, search?: string, limit?: number, offset?: number) {
    return this.repo.listUsers(roleKey, search, limit, offset);
  }

  async createUser(data: any) {
    return this.repo.createUser(data);
  }

  async updateUser(id: string, data: any) {
    try {
      return await this.repo.updateUser(id, data);
    } catch (e) {
      throw new NotFoundError('User not found');
    }
  }

  async deleteUser(id: string) {
    try {
      return await this.repo.deleteUser(id);
    } catch (e) {
      throw new NotFoundError('User not found');
    }
  }

  async updateUserVerification(id: string, isVerified: boolean) {
    try {
      return await this.repo.updateUserVerification(id, isVerified);
    } catch (e) {
      throw new NotFoundError('User not found');
    }
  }

  async listResponders(isVerified?: boolean, search?: string, limit?: number) {
    return this.repo.listResponders(isVerified, search, limit);
  }

  async verifyResponder(id: string, isVerified: boolean) {
    try {
      return await this.repo.updateResponderVerification(id, isVerified);
    } catch (e) {
      throw new NotFoundError('Responder not found');
    }
  }

  async deleteResponder(id: string) {
    try {
      return await this.repo.deleteResponder(id);
    } catch (e) {
      throw new NotFoundError('Responder not found');
    }
  }

  async listStations(search?: string, limit?: number) {
    return this.repo.listStations(search, limit);
  }

  async createStation(data: any) {
    return this.repo.createStation(data);
  }

  async updateStation(id: string, data: any) {
    try {
      return await this.repo.updateStation(id, data);
    } catch (e) {
      throw new NotFoundError('Station not found');
    }
  }

  async deleteStation(id: string) {
    try {
      return await this.repo.deleteStation(id);
    } catch (e) {
      throw new NotFoundError('Station not found');
    }
  }

  async listAuditLogs(search?: string, limit?: number) {
    const logs = await this.repo.listAuditLogs(search, limit);
    return logs.map(log => this.maskAuditLog(log));
  }

  async getHealth() {
    return this.repo.getSystemHealth();
  }

  /**
   * Masks sensitive data in the audit log before sending to the frontend.
   */
  public maskAuditLog(log: AuditLog): Partial<AuditLog> {
    const maskedLog = { ...log };

    if (maskedLog.ipAddress) {
      const parts = maskedLog.ipAddress.split('.');
      if (parts.length === 4) {
        parts[3] = '***';
        maskedLog.ipAddress = parts.join('.');
      } else if (maskedLog.ipAddress.includes(':')) {
        const v6Parts = maskedLog.ipAddress.split(':');
        if (v6Parts.length > 4) {
          maskedLog.ipAddress = v6Parts.slice(0, 4).join(':') + ':***:***';
        }
      }
    }

    if (maskedLog.metadata && typeof maskedLog.metadata === 'object') {
      const meta = { ...(maskedLog.metadata as any) };
      if (meta.phone && typeof meta.phone === 'string') {
        meta.phone = meta.phone.replace(/(\+\d{1,3})\d+(?=\d{4})/, '$1***');
      }
      maskedLog.metadata = meta;
    }

    return maskedLog;
  }

  // --- ALERTS ---
  async listAlerts(status?: any, limit?: number) {
    return this.repo.listAlerts(status, limit);
  }

  async getAlertById(id: string) {
    const alert = await this.repo.getAlertById(id);
    if (!alert) throw new NotFoundError('Alert not found');
    return alert;
  }

  // --- INCIDENTS ---
  async listIncidents(status?: any, limit?: number) {
    return this.repo.listIncidents(status, limit);
  }

  async updateIncidentStatus(id: string, status: any) {
    try {
      return await this.repo.updateIncidentStatus(id, status);
    } catch (e) {
      throw new NotFoundError('Incident not found');
    }
  }

  // --- ANALYTICS ---
  async getAnalyticsData() {
    return this.repo.getAnalyticsData();
  }
}
