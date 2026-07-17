import { PrismaClient, User, Responder, AuditLog, PoliceStation } from '@prisma/client';
import argon2 from 'argon2';

export class AdminRepository {
  constructor(private readonly prisma: PrismaClient) {}

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

  async listAuditLogs(search?: string, limit: number = 50): Promise<AuditLog[]> {
    const where: any = {};
    if (search) {
      where.OR = [
        { entityType: { contains: search, mode: 'insensitive' } }
      ];
    }
    return this.prisma.auditLog.findMany({
      where,
      take: limit,
      orderBy: { createdAt: 'desc' }
    });
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
  async getAnalyticsData(): Promise<any> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [incidentsByType, alertsByDate, incidentsByDate] = await Promise.all([
      this.prisma.incidentReport.groupBy({
        by: ['type'],
        _count: {
          id: true
        }
      }),
      // We do a raw query or simple fetch and group in memory if needed, 
      // but Prisma makes group by date tricky without raw query in some DBs.
      // Let's just fetch the last 30 days and group in memory for simplicity here.
      this.prisma.emergencyAlert.findMany({
        where: { createdAt: { gte: thirtyDaysAgo } },
        select: { createdAt: true }
      }),
      this.prisma.incidentReport.findMany({
        where: { createdAt: { gte: thirtyDaysAgo } },
        select: { createdAt: true, latitude: true, longitude: true, type: true }
      })
    ]);

    // Format incidents by type
    const incidentTypes = incidentsByType.map(i => ({
      name: i.type,
      value: i._count.id
    }));

    // Group alerts by date
    const trendsMap: Record<string, { date: string, alerts: number, incidents: number }> = {};
    
    // Initialize last 30 days
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      trendsMap[dateStr] = { date: dateStr, alerts: 0, incidents: 0 };
    }

    alertsByDate.forEach(a => {
      const dateStr = a.createdAt.toISOString().split('T')[0];
      if (trendsMap[dateStr]) trendsMap[dateStr].alerts++;
    });

    incidentsByDate.forEach(i => {
      const dateStr = i.createdAt.toISOString().split('T')[0];
      if (trendsMap[dateStr]) trendsMap[dateStr].incidents++;
    });

    const trends = Object.values(trendsMap);

    return {
      incidentTypes,
      trends,
      recentIncidents: incidentsByDate // useful for heatmap
    };
  }
}
