import { FastifyInstance } from 'fastify';
import argon2 from 'argon2';
import { AlertStatus, AlertType, AuditLog, EmergencyAlert, Prisma } from '@prisma/client';
import { AdminRepository, AdminUserView, AdminAlertFilters } from './admin.repository';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/utils/errors';
import { bumpTokenVersion } from '@/utils/token-version';
import { env } from '@/config/env';
import { emitToAlert } from '@/utils/alert-rooms';
import { invalidateAlertMeta } from '@/modules/alerts/alert-location.buffer';
import type { AdminSettableStatus } from '@/modules/alerts/alert-status';

/** The admin performing the action. */
export interface AdminActor {
  id: string;
  permissions: string[];
}

/** Raw querystring of GET /admin/alerts (already type-coerced by the route schema). */
export interface ListAlertsQuery {
  /** One status or a comma-separated list. Omitted → every status. */
  status?: string;
  /** One type or a comma-separated list. */
  type?: string;
  /** Only soft alerts (true) or only real SOS (false). */
  soft?: boolean;
  /** ISO date/time; inclusive. A bare date for `to` covers that whole day. */
  from?: string;
  to?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

const ALERT_STATUS_VALUES = Object.values(AlertStatus) as string[];
const ALERT_TYPE_VALUES = Object.values(AlertType) as string[];
export const ALERT_LIST_MAX_LIMIT = 200;

function parseList<T extends string>(raw: string | undefined, allowed: string[], what: string): T[] | undefined {
  if (!raw) return undefined;
  const items = Array.from(new Set(raw.split(',').map((v) => v.trim()).filter(Boolean)));
  const bad = items.filter((v) => !allowed.includes(v));
  if (bad.length) throw new ValidationError(`Unknown ${what}: ${bad.join(', ')}`);
  return items.length ? (items as T[]) : undefined;
}

function parseDate(raw: string | undefined, what: string, endOfDay = false): Date | undefined {
  if (!raw) return undefined;
  const bareDate = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  const d = new Date(bareDate ? `${raw}T00:00:00.000Z` : raw);
  if (Number.isNaN(d.getTime())) throw new ValidationError(`Invalid ${what} date`);
  if (bareDate && endOfDay) d.setUTCHours(23, 59, 59, 999);
  return d;
}

export function toAlertFilters(q: ListAlertsQuery): AdminAlertFilters {
  const limit = Math.min(Math.max(Math.trunc(Number(q.limit ?? 50)) || 50, 1), ALERT_LIST_MAX_LIMIT);
  const offset = Math.max(Math.trunc(Number(q.offset ?? 0)) || 0, 0);
  return {
    statuses: parseList<AlertStatus>(q.status, ALERT_STATUS_VALUES, 'status'),
    types: parseList<AlertType>(q.type, ALERT_TYPE_VALUES, 'type'),
    isSoftAlert: q.soft,
    from: parseDate(q.from, 'from'),
    to: parseDate(q.to, 'to', true),
    search: q.search?.trim() || undefined,
    limit,
    offset,
  };
}

/** Push tokens are credentials of a sort — show only their tail. */
function maskRecipient(recipient: string): string {
  return /^\+?[\d\s-]{6,20}$/.test(recipient) || recipient.includes('@')
    ? recipient
    : `…${recipient.slice(-6)}`;
}

export interface CreateUserInput {
  phone: string;
  password: string;
  fullName: string;
  email?: string;
  nationalId?: string;
  role?: string;
  permissions?: string[];
  isVerified?: boolean;
}

export type UpdateUserInput = Partial<Omit<CreateUserInput, 'password'>> & {
  password?: string;
  status?: 'active' | 'inactive' | 'suspended' | 'pending_verification';
};

const ADMIN_PERMISSIONS = ['manage_users', 'manage_admins', 'view_audit_logs'];
/** Roles that still exist in old data but can no longer be assigned. */
const RETIRED_ROLES = ['police'];

function assertCanGrant(actor: AdminActor, permissions: string[]): void {
  const missing = permissions.filter((p) => !actor.permissions.includes(p));
  if (missing.length > 0) {
    throw new ForbiddenError(`You cannot grant permissions you do not hold: ${missing.join(', ')}`);
  }
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

function normalizeEmail(email?: string): string | null {
  const trimmed = email?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: env.ARGON2_MEMORY_COST,
    timeCost: env.ARGON2_TIME_COST,
    parallelism: env.ARGON2_PARALLELISM,
  });
}

export class AdminService {
  constructor(
    private readonly repo: AdminRepository,
    private readonly fastify: FastifyInstance,
  ) {}

  async listUsers(roleKey?: string, search?: string, limit?: number, offset?: number) {
    return this.repo.listUsers(roleKey, search, limit, offset);
  }

  /**
   * B1/B2: a password is mandatory (no shared default), the role must exist,
   * and an admin can only hand out permissions they hold themselves.
   */
  async createUser(actor: AdminActor, data: CreateUserInput): Promise<AdminUserView> {
    const roleKey = data.role ?? 'citizen';
    await this.assertRoleAssignable(actor, roleKey);

    // An admin created without an explicit list gets the admin permissions the
    // creator can vouch for — never more.
    const permissions =
      data.permissions ?? (roleKey === 'admin' ? ADMIN_PERMISSIONS.filter((p) => actor.permissions.includes(p)) : []);
    assertCanGrant(actor, permissions);

    const email = normalizeEmail(data.email);
    if (await this.repo.isPhoneTaken(data.phone)) throw new ConflictError('A user with this phone number already exists');
    if (email && (await this.repo.isEmailTaken(email))) throw new ConflictError('A user with this email already exists');

    return this.repo.createUser({
      phone: data.phone,
      email,
      passwordHash: await hashPassword(data.password),
      fullName: data.fullName,
      nationalId: data.nationalId || undefined,
      roleKey,
      permissions,
      isVerified: data.isVerified ?? false,
    });
  }

  /**
   * Only the fields present are changed. Tokens are revoked only when what
   * the user may do actually changed (role, permissions, status, password) —
   * the portal sends the whole form on every save, and logging a user out
   * because their name was edited was a bug.
   */
  async updateUser(actor: AdminActor, id: string, data: UpdateUserInput): Promise<AdminUserView> {
    const existing = await this.repo.findUser(id);
    if (!existing) throw new NotFoundError('User');

    const currentRole = existing.role?.key ?? 'citizen';
    const roleChanged = data.role !== undefined && data.role !== currentRole;
    const permissionsChanged =
      data.permissions !== undefined && !sameSet(data.permissions, existing.permissions);
    const statusChanged = data.status !== undefined && data.status !== existing.status;

    if (id === actor.id && (roleChanged || permissionsChanged)) {
      throw new ForbiddenError('You cannot change your own role or permissions');
    }
    if ((currentRole === 'admin' || data.role === 'admin') && !actor.permissions.includes('manage_admins')) {
      throw new ForbiddenError('You do not have permission to edit admin users');
    }
    if (roleChanged) await this.assertRoleAssignable(actor, data.role!);
    if (permissionsChanged) {
      assertCanGrant(actor, data.permissions!.filter((p) => !existing.permissions.includes(p)));
    }

    const update: Prisma.UserUpdateInput = {};
    if (data.phone !== undefined && data.phone !== existing.phone) {
      if (await this.repo.isPhoneTaken(data.phone, id)) throw new ConflictError('A user with this phone number already exists');
      update.phone = data.phone;
    }
    if (data.email !== undefined) {
      const email = normalizeEmail(data.email);
      if (email && (await this.repo.isEmailTaken(email, id))) throw new ConflictError('A user with this email already exists');
      update.email = email;
    }
    if (roleChanged) update.role = { connect: { key: data.role! } };
    if (permissionsChanged) update.permissions = data.permissions;
    if (statusChanged) update.status = data.status;
    if (data.password !== undefined) update.passwordHash = await hashPassword(data.password);

    const profile: Prisma.UserProfileUpdateWithoutUserInput = {};
    if (data.fullName !== undefined) profile.fullName = data.fullName;
    if (data.nationalId !== undefined) profile.nationalId = data.nationalId || null;
    if (data.isVerified !== undefined) {
      profile.isVerified = data.isVerified;
      profile.verifiedAt = data.isVerified ? new Date() : null;
    }
    if (Object.keys(profile).length > 0 && existing.profile) update.profile = { update: profile };

    const updated = await this.repo.updateUser(id, update);

    if (data.password !== undefined) await this.repo.revokeSessions(id);
    if (roleChanged || permissionsChanged || statusChanged || data.password !== undefined) {
      await bumpTokenVersion(this.fastify, id);
    }
    return updated;
  }

  /**
   * Hard-delete only a user with no history. Anyone with alerts, payments or
   * an audit trail is deactivated instead: those records must survive, and
   * the foreign keys (rightly) refuse to cascade.
   */
  async deleteUser(actor: AdminActor, id: string): Promise<{ result: 'deleted' | 'deactivated' }> {
    if (id === actor.id) throw new ForbiddenError('You cannot delete your own account');
    const existing = await this.repo.findUser(id);
    if (!existing) throw new NotFoundError('User');
    if (existing.role?.key === 'admin' && !actor.permissions.includes('manage_admins')) {
      throw new ForbiddenError('You do not have permission to delete admin users');
    }

    // Revoke first: whichever way this goes, their current tokens are dead.
    await bumpTokenVersion(this.fastify, id);
    if (await this.repo.hasHistory(id)) {
      await this.repo.deactivateUser(id);
      return { result: 'deactivated' };
    }
    await this.repo.deleteUser(id);
    return { result: 'deleted' };
  }

  private async assertRoleAssignable(actor: AdminActor, roleKey: string): Promise<void> {
    if (RETIRED_ROLES.includes(roleKey) || !(await this.repo.roleExists(roleKey))) {
      throw new ValidationError(`Unknown role: ${roleKey}`);
    }
    if (roleKey === 'admin' && !actor.permissions.includes('manage_admins')) {
      throw new ForbiddenError('You do not have permission to assign the admin role');
    }
  }

  async updateUserVerification(id: string, isVerified: boolean) {
    try {
      return await this.repo.updateUserVerification(id, isVerified);
    } catch {
      throw new NotFoundError('User not found');
    }
  }

  async listResponders(isVerified?: boolean, search?: string, limit?: number) {
    return this.repo.listResponders(isVerified, search, limit);
  }

  async verifyResponder(id: string, isVerified: boolean) {
    try {
      return await this.repo.updateResponderVerification(id, isVerified);
    } catch {
      throw new NotFoundError('Responder not found');
    }
  }

  async deleteResponder(id: string) {
    try {
      return await this.repo.deleteResponder(id);
    } catch {
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
  /** Every SOS ever raised (all statuses unless filtered), paginated. */
  async listAlerts(query: ListAlertsQuery = {}) {
    const filters = toAlertFilters(query);
    const { data, total } = await this.repo.listAlerts(filters);
    return { data, total, limit: filters.limit, offset: filters.offset };
  }

  /** Alert detail: victim, location, recipients, notifications, counts and the status timeline. */
  async getAlertById(id: string) {
    const alert = await this.repo.getAlertById(id);
    if (!alert) throw new NotFoundError('Alert not found');
    const { _count, notificationLogs, ...rest } = alert;
    return {
      ...rest,
      notificationLogs: notificationLogs.map((n) => ({ ...n, recipient: maskRecipient(n.recipient) })),
      counts: {
        evidence: _count.evidence,
        locationUpdates: _count.locationUpdates,
        recipients: _count.recipients,
        responderDispatches: _count.responderDispatches,
        notifications: _count.notificationLogs,
        cases: _count.cases,
      },
    };
  }

  /** Admin closes the loop on an alert (in progress / resolved / closed / false alarm). */
  async setAlertStatus(
    actor: AdminActor,
    id: string,
    status: AdminSettableStatus,
    note?: string,
  ): Promise<EmergencyAlert> {
    const alert = await this.repo.getAlertById(id);
    if (!alert) throw new NotFoundError('Alert');

    const now = new Date();
    const updated = await this.repo.updateAlertStatus(
      id,
      {
        status,
        ...(status === 'resolved' ? { resolvedAt: now } : {}),
        ...(status !== 'in_progress' ? { closedAt: now } : {}),
      },
      {
        fromStatus: alert.status,
        actorKind: 'admin',
        actorId: actor.id,
        reason: note || null,
        metadata: { event: 'admin_status_update' },
      },
    );
    // The cached authorisation record carries status (location pings).
    await invalidateAlertMeta(this.fastify, id);
    await this.repo.createAuditLog({
      userId: actor.id,
      action: status === 'closed' ? 'case_closed' : 'updated',
      entityType: 'alert',
      entityId: id,
      metadata: { from: alert.status, to: status, ...(note ? { note } : {}) },
    });
    emitToAlert(this.fastify, id, 'alert_status_update', { alertId: id, status });
    return updated;
  }

  // --- INCIDENTS ---
  async listIncidents(status?: any, limit?: number) {
    return this.repo.listIncidents(status, limit);
  }

  async updateIncidentStatus(id: string, status: any) {
    try {
      return await this.repo.updateIncidentStatus(id, status);
    } catch {
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
