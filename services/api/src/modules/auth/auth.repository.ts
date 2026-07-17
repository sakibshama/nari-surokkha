/**
 * Auth Repository — Database Access Layer
 *
 * Only raw DB queries here. Zero business logic.
 * Called exclusively by AuthService.
 *
 * Architecture: Route → Controller → Service → Repository → DB
 */

import { PrismaClient, Prisma, User, UserSession, DeviceToken } from '@prisma/client';

/**
 * A User row with its `role` relation eagerly loaded.
 * All auth lookups return this shape so `user.role.key` is fully typed
 * (no `as any` casts anywhere in the auth layer).
 */
export type UserWithRole = Prisma.UserGetPayload<{ include: { role: true } }>;

export class AuthRepository {
  constructor(private readonly db: PrismaClient) {}

  // ─── User ────────────────────────────────────────────────────

  async findUserByPhone(phone: string): Promise<UserWithRole | null> {
    return this.db.user.findUnique({
      where: { phone },
      include: { profile: true, role: true },
    });
  }

  async findUserByEmail(email: string): Promise<UserWithRole | null> {
    return this.db.user.findUnique({
      where: { email },
      include: { role: true },
    });
  }

  async findUserById(id: string): Promise<UserWithRole | null> {
    return this.db.user.findUnique({
      where: { id },
      include: { role: true },
    });
  }

  async createUser(data: {
    phone: string;
    passwordHash: string;
    fullName: string;
    preferredLanguage?: string;
  }): Promise<UserWithRole> {
    return this.db.user.create({
      data: {
        phone: data.phone,
        passwordHash: data.passwordHash,
        role: { connect: { key: 'citizen' } },
        status: 'active',
        profile: {
          create: {
            fullName: data.fullName,
            preferredLanguage: data.preferredLanguage ?? 'bn',
          },
        },
      },
      include: { role: true },
    });
  }

  async updateUserStatus(
    userId: string,
    status: User['status'],
  ): Promise<void> {
    await this.db.user.update({
      where: { id: userId },
      data: { status },
    });
  }

  async updateUserPassword(
    userId: string,
    passwordHash: string,
  ): Promise<void> {
    await this.db.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
  }

  // ─── Sessions (Refresh Tokens) ────────────────────────────────

  async createSession(data: {
    id?: string;
    userId: string;
    refreshToken: string;
    expiresAt: Date;
    deviceInfo?: string;
    ipAddress?: string;
  }): Promise<UserSession> {
    return this.db.userSession.create({
      data: {
        ...(data.id ? { id: data.id } : {}),
        userId: data.userId,
        refreshToken: data.refreshToken,
        expiresAt: data.expiresAt,
        deviceInfo: data.deviceInfo,
        ipAddress: data.ipAddress,
      },
    });
  }

  async findValidSession(refreshToken: string): Promise<UserSession | null> {
    return this.db.userSession.findFirst({
      where: {
        refreshToken,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.db.userSession.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllUserSessions(userId: string): Promise<void> {
    await this.db.userSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async deleteExpiredSessions(): Promise<number> {
    const result = await this.db.userSession.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return result.count;
  }

  // ─── Device Tokens ────────────────────────────────────────────

  async upsertDeviceToken(data: {
    userId: string;
    token: string;
    platform: 'android' | 'ios';
  }): Promise<DeviceToken> {
    return this.db.deviceToken.upsert({
      where: {
        userId_token: {
          userId: data.userId,
          token: data.token,
        },
      },
      update: { isActive: true },
      create: {
        userId: data.userId,
        token: data.token,
        platform: data.platform,
        isActive: true,
      },
    });
  }

  async deactivateDeviceTokens(userId: string): Promise<void> {
    await this.db.deviceToken.updateMany({
      where: { userId },
      data: { isActive: false },
    });
  }
}
