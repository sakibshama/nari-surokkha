import { PrismaClient, Prisma, Responder, AuditLog, AlertStatus } from '@prisma/client';
import { ACTIVE_ALERT_STATUSES } from '@/modules/alerts/alert-status';

/** Every column the portal needs — and, deliberately, not passwordHash. */
export const ADMIN_USER_SELECT = {
  id: true,
  phone: true,
  email: true,
  status: true,
  permissions: true,
  roleId: true,
  createdAt: true,
  updatedAt: true,
  role: { select: { id: true, key: true, name: true } },
  profile: {
    select: {
      fullName: true,
      nationalId: true,
      bloodGroup: true,
      preferredLanguage: true,
      isVerified: true,
      verifiedAt: true,
    },
  },
} satisfies Prisma.UserSelect;

export type AdminUserView = Prisma.UserGetPayload<{ select: typeof ADMIN_USER_SELECT }>;

export class AdminRepository {
  constructor(
    private readonly prisma: PrismaClient,
    /**
     * Read-only client for reporting queries. Falls back to the primary when
     * no replica is configured, so this is safe either way.
     */
    private readonly prismaRead: PrismaClient = prisma,
  ) {}

  async listUsers(roleKey?: string, search?: string, limit: number = 50, offset: number = 0): Promise<{ data: AdminUserView[], total: number }> {
    const where: Prisma.UserWhereInput = {};
    if (roleKey) where.role = { key: roleKey };
    if (search) {
      where.OR = [
        { phone: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { profile: { fullName: { contains: search, mode: 'insensitive' } } }
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
        select: ADMIN_USER_SELECT,
      }),
      this.prisma.user.count({ where })
    ]);

    return { data, total };
  }

  async findUser(id: string): Promise<AdminUserView | null> {
    return this.prisma.user.findUnique({ where: { id }, select: ADMIN_USER_SELECT });
  }

  async roleExists(key: string): Promise<boolean> {
    return (await this.prisma.role.count({ where: { key } })) > 0;
  }

  async isEmailTaken(email: string, exceptUserId?: string): Promise<boolean> {
    const owner = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    return !!owner && owner.id !== exceptUserId;
  }

  async isPhoneTaken(phone: string, exceptUserId?: string): Promise<boolean> {
    const owner = await this.prisma.user.findUnique({ where: { phone }, select: { id: true } });
    return !!owner && owner.id !== exceptUserId;
  }

  async createUser(data: {
    phone: string;
    email: string | null;
    passwordHash: string;
    fullName: string;
    nationalId?: string;
    roleKey: string;
    permissions: string[];
    isVerified: boolean;
  }): Promise<AdminUserView> {
    return this.prisma.user.create({
      data: {
        phone: data.phone,
        email: data.email,
        passwordHash: data.passwordHash,
        role: { connect: { key: data.roleKey } },
        permissions: data.permissions,
        profile: {
          create: {
            fullName: data.fullName,
            nationalId: data.nationalId,
            isVerified: data.isVerified,
            verifiedAt: data.isVerified ? new Date() : null,
          },
        },
      },
      select: ADMIN_USER_SELECT,
    });
  }

  async updateUser(id: string, data: Prisma.UserUpdateInput): Promise<AdminUserView> {
    return this.prisma.user.update({ where: { id }, data, select: ADMIN_USER_SELECT });
  }

  /** Revoke every refresh session (the access-token side is the token version). */
  async revokeSessions(userId: string): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Does anything reference this user that must outlive them (alerts,
   * payments, the audit trail) or that has no ON DELETE CASCADE?
   */
  async hasHistory(userId: string): Promise<boolean> {
    const counts = await Promise.all([
      this.prisma.emergencyAlert.count({ where: { userId } }),
      this.prisma.payment.count({ where: { userId } }),
      this.prisma.auditLog.count({ where: { userId } }),
      this.prisma.mlDetectionEvent.count({ where: { userId } }),
      this.prisma.activeRoute.count({ where: { userId } }),
      this.prisma.responderDispatch.count({ where: { responder: { userId } } }),
    ]);
    return counts.some((n) => n > 0);
  }

  async deleteUser(id: string): Promise<void> {
    await this.prisma.user.delete({ where: { id } });
  }

  /** Soft delete: keep the row (and its history), end every way in. */
  async deactivateUser(id: string): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id }, data: { status: 'inactive' } }),
      this.prisma.userSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: now } }),
      this.prisma.deviceToken.updateMany({ where: { userId: id }, data: { isActive: false } }),
    ]);
  }

  async updateUserVerification(id: string, isVerified: boolean): Promise<void> {
    // update (not updateMany) so a missing profile surfaces as P2025 / 404.
    await this.prisma.userProfile.update({
      where: { userId: id },
      data: { isVerified, verifiedAt: isVerified ? new Date() : null },
    });
  }

  async listResponders(isVerified?: boolean, search?: string, limit: number = 50): Promise<any[]> {
    const status = isVerified === true ? 'verified' : isVerified === false ? 'pending' : undefined;
    const where: any = status ? { status } : {};
    
    if (search) {
      where.OR = [
        { organizationName: { contains: search, mode: 'insensitive' } },
        { user: { phone: { contains: search, mode: 'insensitive' } } },
        { user: { profile: { fullName: { contains: search, mode: 'insensitive' } } } }
      ];
    }

    const responders = await this.prisma.responder.findMany({
      where,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: { phone: true, profile: { select: { fullName: true, isVerified: true } } }
        }
      }
    });

    return responders.map(r => ({
      ...r,
      isVerified: r.status === 'verified',
    }));
  }

  async updateResponderVerification(id: string, isVerified: boolean): Promise<Responder> {
    return this.prisma.responder.update({
      where: { id },
      data: { status: isVerified ? 'verified' : 'rejected', approvedAt: isVerified ? new Date() : null }
    });
  }

  async deleteResponder(id: string): Promise<Responder> {
    return this.prisma.responder.update({
      where: { id },
      data: { status: 'suspended' }
    });
  }

  /**
   * Audit log listing.
   *
   * Previously `take: 50` with no offset or cursor, which meant anything older
   * than the 50 most recent entries was simply unreachable through the UI —
   * for the accountability record of a system that dispatches responders, that is
   * a real gap, not just an ergonomic one.
   */
  async listAuditLogs(
    search?: string,
    limit: number = 50,
    cursor?: string,
  ): Promise<{ data: AuditLog[]; nextCursor: string | null }> {
    const where: any = {};
    if (search) {
      where.OR = [
        { entityType: { contains: search, mode: 'insensitive' } },
        { action: { equals: search } },
      ];
    }

    const take = Math.min(limit, 200);
    const rows = await this.prismaRead.auditLog.findMany({
      where,
      // Fetch one extra to know whether another page exists, without a count.
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
    });

    const hasMore = rows.length > take;
    const data = hasMore ? rows.slice(0, take) : rows;
    return { data, nextCursor: hasMore ? data[data.length - 1].id : null };
  }

  async getSystemHealth(): Promise<{ totalUsers: number, activeAlerts: number, verifiedResponders: number, pendingResponders: number }> {
    const [totalUsers, activeAlerts, verifiedResponders, pendingResponders] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.emergencyAlert.count({ where: { status: { in: ACTIVE_ALERT_STATUSES } } }),
      this.prisma.responder.count({ where: { status: 'verified' } }),
      this.prisma.responder.count({ where: { status: 'pending' } }),
    ]);

    return {
      totalUsers,
      activeAlerts,
      verifiedResponders,
      pendingResponders
    };
  }

  // --- ALERTS ---
  async listAlerts(status?: any, limit: number = 50): Promise<any[]> {
    const where: any = {};
    if (status) where.status = status;
    return this.prisma.emergencyAlert.findMany({
      where,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: { phone: true, profile: { select: { fullName: true } } }
        }
      }
    });
  }

  async getAlertById(id: string): Promise<any> {
    return this.prisma.emergencyAlert.findUnique({
      where: { id },
      include: {
        user: {
          select: { phone: true, profile: { select: { fullName: true, bloodGroup: true } } }
        }
      }
    });
  }

  async updateAlertStatus(
    id: string,
    data: { status: AlertStatus; resolvedAt?: Date; closedAt?: Date },
  ) {
    return this.prisma.emergencyAlert.update({ where: { id }, data });
  }

  async createAuditLog(data: Prisma.AuditLogUncheckedCreateInput): Promise<void> {
    await this.prisma.auditLog.create({ data });
  }

  // --- INCIDENTS ---
  async listIncidents(status?: any, limit: number = 50): Promise<any[]> {
    const where: any = {};
    if (status) where.status = status;
    try {
      const rows = await this.prisma.incidentReport.findMany({
        where,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { media: true } } },
      });
      return rows.map(({ _count, ...r }) => ({ ...r, mediaCount: _count.media }));
    } catch {
      // Media migration not applied yet (or an old Prisma client): still list the reports.
      const rows = await this.prisma.incidentReport.findMany({ where, take: limit, orderBy: { createdAt: 'desc' } });
      return rows.map((r) => ({ ...r, mediaCount: 0 }));
    }
  }

  async updateIncidentStatus(id: string, status: any): Promise<any> {
    return this.prisma.incidentReport.update({
      where: { id },
      data: { status }
    });
  }

  // --- ANALYTICS ---
  /**
   * Dashboard analytics.
   *
   * This used to fetch every alert and every incident from the last 30 days
   * into Node and count them with a JavaScript loop -- the code said as much:
   * "Let's just fetch the last 30 days and group in memory for simplicity".
   * At 1,000 alerts/day that is 30,000 rows transferred and parsed on every
   * dashboard load, and it grows with usage.
   *
   * Postgres can do this with three GROUP BYs over BRIN-indexed ranges,
   * returning ~30 rows instead of 30,000. generate_series fills the gaps so
   * quiet days still appear on the chart.
   *
   * The heatmap no longer ships raw incident coordinates either: points are
   * snapped to a ~250m grid server-side, which is both far less data and
   * better for the privacy of whoever filed the report.
   */
  async getAnalyticsData(days = 30): Promise<any> {
    const [incidentTypes, trends, heatmap, totals] = await Promise.all([
      // ── Incidents by type ────────────────────────────────────────────
      this.prismaRead.$queryRaw<Array<{ name: string; value: bigint }>>`
        SELECT type::text AS name, COUNT(*)::bigint AS value
        FROM incident_reports
        GROUP BY type
        ORDER BY value DESC;
      `,

      // ── Daily alert/incident counts, with empty days filled ──────────
      this.prismaRead.$queryRaw<Array<{ date: string; alerts: bigint; incidents: bigint }>>`
        WITH days AS (
          SELECT generate_series(
            (CURRENT_DATE - (${days - 1} || ' days')::INTERVAL)::date,
            CURRENT_DATE,
            '1 day'
          )::date AS day
        ),
        a AS (
          SELECT created_at::date AS day, COUNT(*)::bigint AS n
          FROM emergency_alerts
          WHERE created_at >= CURRENT_DATE - (${days - 1} || ' days')::INTERVAL
          GROUP BY 1
        ),
        i AS (
          SELECT created_at::date AS day, COUNT(*)::bigint AS n
          FROM incident_reports
          WHERE created_at >= CURRENT_DATE - (${days - 1} || ' days')::INTERVAL
          GROUP BY 1
        )
        SELECT to_char(d.day, 'YYYY-MM-DD') AS date,
               COALESCE(a.n, 0)::bigint AS alerts,
               COALESCE(i.n, 0)::bigint AS incidents
        FROM days d
        LEFT JOIN a ON a.day = d.day
        LEFT JOIN i ON i.day = d.day
        ORDER BY d.day;
      `,

      // ── Heatmap, aggregated to a grid ────────────────────────────────
      // ~0.0025 degrees is roughly 250m at this latitude. Returning a weighted
      // grid instead of every raw point keeps the payload small and avoids
      // handing the browser the exact location of every reported incident.
      this.prismaRead.$queryRaw<Array<{ lat: number; lng: number; weight: bigint; type: string }>>`
        SELECT ROUND(latitude::numeric  / 0.0025) * 0.0025 AS lat,
               ROUND(longitude::numeric / 0.0025) * 0.0025 AS lng,
               COUNT(*)::bigint AS weight,
               MODE() WITHIN GROUP (ORDER BY type::text) AS type
        FROM incident_reports
        WHERE created_at >= CURRENT_DATE - (${days - 1} || ' days')::INTERVAL
        GROUP BY 1, 2
        ORDER BY weight DESC
        LIMIT 2000;
      `,

      this.prismaRead.$queryRaw<Array<{ alerts: bigint; incidents: bigint }>>`
        SELECT
          (SELECT COUNT(*) FROM emergency_alerts
             WHERE created_at >= CURRENT_DATE - (${days - 1} || ' days')::INTERVAL)::bigint AS alerts,
          (SELECT COUNT(*) FROM incident_reports
             WHERE created_at >= CURRENT_DATE - (${days - 1} || ' days')::INTERVAL)::bigint AS incidents;
      `,
    ]);

    return {
      incidentTypes: incidentTypes.map((r) => ({ name: r.name, value: Number(r.value) })),
      trends: trends.map((r) => ({
        date: r.date,
        alerts: Number(r.alerts),
        incidents: Number(r.incidents),
      })),
      // Kept under the old key so the existing dashboard keeps rendering.
      recentIncidents: heatmap.map((r) => ({
        latitude: Number(r.lat),
        longitude: Number(r.lng),
        weight: Number(r.weight),
        type: r.type,
      })),
      totals: {
        alerts: Number(totals[0]?.alerts ?? 0),
        incidents: Number(totals[0]?.incidents ?? 0),
        periodDays: days,
      },
    };
  }
}
