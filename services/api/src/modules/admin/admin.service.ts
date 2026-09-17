import { FastifyInstance } from 'fastify';
import { AdminRepository } from './admin.repository';
import { AuditLog } from '@prisma/client';
import { NotFoundError } from '@/utils/errors';
import { bumpTokenVersion } from '@/utils/token-version';

export class AdminService {
  constructor(
    private readonly repo: AdminRepository,
    private readonly fastify: FastifyInstance,
  ) {}

  async listUsers(roleKey?: string, search?: string, limit?: number, offset?: number) {
    return this.repo.listUsers(roleKey, search, limit, offset);
  }

  async createUser(data: any) {
    return this.repo.createUser(data);
  }

  /**
   * Update a user.
   *
   * Any change to role, permissions or status revokes the user's existing
   * access tokens immediately. Without this, demoting an admin or suspending
   * an account left their current token fully privileged until it expired.
   */
  async updateUser(id: string, data: any) {
    let updated;
    try {
      updated = await this.repo.updateUser(id, data);
    } catch (e) {
      throw new NotFoundError('User not found');
    }

    // Anything that changes what this user is allowed to do invalidates every
    // access token they currently hold.
    const privilegeChanged =
      data.role !== undefined || data.permissions !== undefined || data.status !== undefined;
    if (privilegeChanged) {
      await bumpTokenVersion(this.fastify, id);
    }

    return updated;
  }

  async deleteUser(id: string) {
    try {
      // Revoke first: if the delete succeeds, any token they hold is already
      // dead; if it fails, revoking a live user's token is the safe error.
      await bumpTokenVersion(this.fastify, id);
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

  async listAuditLogs(search?: string, limit?: number, cursor?: string) {
    const { data, nextCursor } = await this.repo.listAuditLogs(search, limit, cursor);
    return { items: data.map((log) => this.maskAuditLog(log)), nextCursor };
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
  /**
   * Dashboard analytics, cached for 5 minutes.
   *
   * The admin dashboard polls this, and several admins may have it open at
   * once. Analytics over a 30-day window does not need to be real-time — the
   * numbers barely move minute to minute — so serving it from Redis turns a
   * repeated multi-table aggregation into a single GET.
   */
  async getAnalyticsData(days = 30) {
    const cacheKey = `analytics:v2:${days}`;
    const TTL_SECONDS = 300;

    try {
      const cached = await this.fastify.redis.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch (err) {
      this.fastify.log.warn({ err }, 'analytics cache read failed');
    }

    const data = await this.repo.getAnalyticsData(days);

    try {
      await this.fastify.redis.set(cacheKey, JSON.stringify(data), 'EX', TTL_SECONDS);
    } catch {
      /* best-effort */
    }
    return data;
  }
}
