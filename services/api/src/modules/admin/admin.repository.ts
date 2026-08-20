import { PrismaClient, User, Responder, AuditLog, PoliceStation } from '@prisma/client';
import argon2 from 'argon2';

export class AdminRepository {
  constructor(
    private readonly prisma: PrismaClient,
    /**
     * Read-only client for reporting queries. Falls back to the primary when
     * no replica is configured, so this is safe either way.
     */
    private readonly prismaRead: PrismaClient = prisma,
  ) {}

  async listUsers(roleKey?: string, search?: string, limit: number = 50, offset: number = 0): Promise<{ data: User[], total: number }> {
    const where: any = {};
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
        include: { profile: true, role: true }
      }),
      this.prisma.user.count({ where })
    ]);

    return { data, total };
  }

  async createUser(data: any): Promise<User> {
    const passwordHash = await argon2.hash(data.password || 'default123!');
    const email = data.email && data.email.trim() !== '' ? data.email : null;

    // Auto-assign full permissions to admin users if none explicitly provided
    const ALL_ADMIN_PERMISSIONS = ['manage_users', 'manage_admins', 'manage_stations', 'view_audit_logs'];
    const permissions = data.role === 'admin' && (!data.permissions || data.permissions.length === 0)
      ? ALL_ADMIN_PERMISSIONS
      : (data.permissions || []);
    
    if (data.role === 'police') {
      if (!data.badgeNumber || !data.stationId) {
        throw new Error('Badge number and Station ID are required for police users');
      }
      return this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            phone: data.phone,
            email,
            passwordHash,
            role: { connect: { key: 'police' } },
            permissions,
            profile: {
              create: {
                fullName: data.fullName,
                nationalId: data.nationalId,
                isVerified: data.isVerified || false
              }
            }
          },
          include: { profile: true, role: true }
        });

        await tx.policeUser.create({
          data: {
            stationId: data.stationId,
            badgeNumber: data.badgeNumber,
            fullName: data.fullName,
            phone: data.phone,
            email: email,
            passwordHash,
          }
        });

        return user;
      });
    }

    return this.prisma.user.create({
      data: {
        phone: data.phone,
        email,
        passwordHash,
        role: { connect: { key: data.role || 'citizen' } },
        permissions,
        profile: {
          create: {
            fullName: data.fullName,
            nationalId: data.nationalId,
            isVerified: data.isVerified || false
          }
        }
      },
      include: { profile: true, role: true }
    });
  }

  async updateUser(id: string, data: any): Promise<User> {
    const existingUser = await this.prisma.user.findUnique({ where: { id }, include: { role: true, profile: true } });
    if (!existingUser) throw new Error('User not found');

    const updateData: any = {};
    if (data.phone) updateData.phone = data.phone;
    if (data.email !== undefined) updateData.email = data.email && data.email.trim() !== '' ? data.email : null;
    if (data.role) updateData.role = { connect: { key: data.role } };
    if (data.status) updateData.status = data.status;
    if (data.permissions && Array.isArray(data.permissions)) {
      updateData.permissions = data.permissions;
    }

    if (data.fullName || data.nationalId || typeof data.isVerified === 'boolean') {
      updateData.profile = {
        update: {}
      };
      if (data.fullName) updateData.profile.update.fullName = data.fullName;
      if (data.nationalId) updateData.profile.update.nationalId = data.nationalId;
      if (typeof data.isVerified === 'boolean') {
        updateData.profile.update.isVerified = data.isVerified;
        updateData.profile.update.verifiedAt = data.isVerified ? new Date() : null;
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { id },
        data: updateData,
        include: { profile: true, role: true }
      });

      // Handle PoliceUser sync
      const targetRole = data.role || existingUser.role?.key;
      if (targetRole === 'police') {
        const phoneToUse = data.phone || existingUser.phone;
        const emailToUse = data.email !== undefined ? data.email : existingUser.email;
        const fullNameToUse = data.fullName || existingUser.profile?.fullName || '';

        // Upsert police user
        const existingPolice = await tx.policeUser.findFirst({
          where: { phone: existingUser.phone }
        });

        if (existingPolice) {
          await tx.policeUser.update({
            where: { id: existingPolice.id },
            data: {
              phone: phoneToUse,
              email: emailToUse,
              fullName: fullNameToUse,
              ...(data.badgeNumber && { badgeNumber: data.badgeNumber }),
              ...(data.stationId && { stationId: data.stationId }),
              isActive: data.status === 'inactive' || data.status === 'suspended' ? false : true,
            }
          });
        } else {
          if (!data.badgeNumber || !data.stationId) {
            throw new Error('Badge number and Station ID are required when assigning Police role');
          }
          await tx.policeUser.create({
            data: {
              stationId: data.stationId,
              badgeNumber: data.badgeNumber,
              fullName: fullNameToUse,
              phone: phoneToUse,
              email: emailToUse,
              passwordHash: existingUser.passwordHash,
            }
          });
        }
      } else if (existingUser.role?.key === 'police' && data.role && data.role !== 'police') {
        // Soft deactivate police profile if role is changed away from police
        const existingPolice = await tx.policeUser.findFirst({
          where: { phone: existingUser.phone }
        });
        if (existingPolice) {
          await tx.policeUser.update({
            where: { id: existingPolice.id },
            data: { isActive: false }
          });
        }
      }

      return updatedUser;
    });
  }

  async deleteUser(id: string): Promise<User> {
    return this.prisma.user.delete({
      where: { id }
    });
  }

  async updateUserVerification(id: string, isVerified: boolean): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id }, include: { profile: true } });
    if (user?.profile) {
      await this.prisma.userProfile.update({
        where: { userId: id },
        data: { isVerified, verifiedAt: isVerified ? new Date() : null }
      });
    }
    return this.prisma.user.findUnique({ where: { id } }) as Promise<User>;
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

  async listStations(search?: string, limit: number = 50): Promise<PoliceStation[]> {
    const where: any = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { thanaCode: { contains: search, mode: 'insensitive' } },
        { district: { contains: search, mode: 'insensitive' } }
      ];
    }
    return this.prisma.policeStation.findMany({
      where,
      take: limit,
      orderBy: { name: 'asc' }
    });
  }

  async createStation(data: any): Promise<PoliceStation> {
    return this.prisma.policeStation.create({
      data: {
        name: data.name,
        thanaCode: data.thanaCode,
        district: data.district,
        division: data.division,
        address: data.address,
        phone: data.phone,
        latitude: data.latitude,
        longitude: data.longitude
      }
    });
  }

  async updateStation(id: string, data: any): Promise<PoliceStation> {
    return this.prisma.policeStation.update({
      where: { id },
      data: {
        name: data.name,
        thanaCode: data.thanaCode,
        district: data.district,
        division: data.division,
        address: data.address,
        phone: data.phone,
        latitude: data.latitude,
        longitude: data.longitude
      }
    });
  }

  async deleteStation(id: string): Promise<PoliceStation> {
    return this.prisma.policeStation.update({
      where: { id },
      data: { isActive: false }
    });
  }

  /**
   * Audit log listing.
   *
   * Previously `take: 50` with no offset or cursor, which meant anything older
   * than the 50 most recent entries was simply unreachable through the UI —
   * for the accountability record of a system that dispatches police, that is
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
      this.prisma.emergencyAlert.count({ where: { status: 'in_progress' } }),
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

  // --- INCIDENTS ---
  async listIncidents(status?: any, limit: number = 50): Promise<any[]> {
    const where: any = {};
    if (status) where.status = status;
    return this.prisma.incidentReport.findMany({
      where,
      take: limit,
      orderBy: { createdAt: 'desc' }
    });
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
