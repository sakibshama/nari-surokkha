/**
 * Auth Service — Business Logic Layer
 *
 * All auth business logic lives here.
 * Never access the DB directly from controllers.
 *
 * Architecture: Route → Controller → Service → Repository → DB
 */

import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { AuthRepository, UserWithRole } from './auth.repository';
import { env } from '@/config/env';
import {
  UnauthorizedError,
  ConflictError,
  ForbiddenError,
} from '@/utils/errors';
import { ERROR_CODES, MAX_LOGIN_ATTEMPTS } from '@nari-surokkha/shared';
import type { JwtAccessPayload, JwtRefreshPayload } from '@/types/index';

// ─── Token generation helpers ─────────────────────────────────

function generateAccessToken(user: UserWithRole): string {
  const payload: Omit<JwtAccessPayload, 'iat' | 'exp'> = {
    sub: user.id,
    role: user.role?.key ?? 'citizen',
    phone: user.phone,
    permissions: user.permissions ?? [],
    type: 'access',
  };
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRY as jwt.SignOptions['expiresIn'],
  });
}

function generateRefreshToken(
  userId: string,
  sessionId: string,
): string {
  const payload: Omit<JwtRefreshPayload, 'iat' | 'exp'> = {
    sub: userId,
    type: 'refresh',
    sessionId,
  };
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRY as jwt.SignOptions['expiresIn'],
  });
}

// ─── Response shapes ──────────────────────────────────────────

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;    // seconds
}

export interface RegisterResult {
  user: {
    id: string;
    phone: string;
    role: string;
    permissions: string[];
  };
  tokens: AuthTokens;
}

export interface LoginResult {
  user: {
    id: string;
    phone: string;
    role: string;
    permissions: string[];
  };
  tokens: AuthTokens;
}

// ─── Auth Service ─────────────────────────────────────────────

export class AuthService {
  // Access token expiry in seconds (parsed from "15m" → 900)
  private readonly accessTokenExpirySeconds: number;

  constructor(private readonly repo: AuthRepository) {
    this.accessTokenExpirySeconds = parseExpiryToSeconds(env.JWT_ACCESS_EXPIRY);
  }

  // ─── Register ──────────────────────────────────────────────

  async register(data: {
    phone: string;
    password: string;
    fullName: string;
    preferredLanguage?: string;
    ipAddress?: string;
    deviceInfo?: string;
  }): Promise<RegisterResult> {
    // Check phone not already registered
    const existing = await this.repo.findUserByPhone(data.phone);
    if (existing) {
      throw new ConflictError(
        'A user with this phone number already exists.',
        ERROR_CODES.USER_ALREADY_EXISTS,
      );
    }

    // Hash password with argon2id
    const passwordHash = await argon2.hash(data.password, {
      type: argon2.argon2id,
      memoryCost: env.ARGON2_MEMORY_COST,
      timeCost: env.ARGON2_TIME_COST,
      parallelism: env.ARGON2_PARALLELISM,
    });

    // Create user + profile in a single transaction via nested create
    const user = await this.repo.createUser({
      phone: data.phone,
      passwordHash,
      fullName: data.fullName,
      preferredLanguage: data.preferredLanguage,
    });

    // Create session and tokens
    const tokens = await this.createSessionAndTokens(user, {
      ipAddress: data.ipAddress,
      deviceInfo: data.deviceInfo,
    });

    return {
      user: { id: user.id, phone: user.phone, role: user.role?.key ?? 'citizen', permissions: user.permissions ?? [] },
      tokens,
    };
  }

  // ─── Login ─────────────────────────────────────────────────

  async login(data: {
    phone: string;
    password: string;
    ipAddress?: string;
    deviceInfo?: string;
  }): Promise<LoginResult> {
    const user = await this.repo.findUserByPhone(data.phone);

    // Use constant-time comparison to prevent timing attacks
    // Even if user not found, still run argon2 verify (dummy) to prevent timing leak
    const dummyHash =
      '$argon2id$v=19$m=65536,t=3,p=4$dummysalt00000000$dummyhash000000000000000000000000000';

    const passwordValid = await argon2.verify(
      user?.passwordHash ?? dummyHash,
      data.password,
    );

    if (!user || !passwordValid) {
      throw new UnauthorizedError('Invalid phone number or password.');
    }

    // Check account status
    if (user.status === 'suspended') {
      throw new ForbiddenError(
        'Your account has been suspended. Please contact support.',
      );
    }

    if (user.status === 'inactive') {
      throw new ForbiddenError('Your account is inactive.');
    }

    // Create session and tokens
    const tokens = await this.createSessionAndTokens(user, {
      ipAddress: data.ipAddress,
      deviceInfo: data.deviceInfo,
    });

    return {
      user: { id: user.id, phone: user.phone, role: user.role?.key ?? 'citizen', permissions: user.permissions ?? [] },
      tokens,
    };
  }

  // ─── Refresh Token ─────────────────────────────────────────

  async refresh(refreshToken: string): Promise<AuthTokens> {
    // 1. Verify JWT signature and expiry
    let payload: JwtRefreshPayload;
    try {
      payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as JwtRefreshPayload;
    } catch {
      throw new UnauthorizedError('Invalid or expired refresh token.');
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedError('Invalid token type.');
    }

    // 2. Verify session is still valid in DB (not revoked)
    const session = await this.repo.findValidSession(refreshToken);
    if (!session) {
      throw new UnauthorizedError('Session has been revoked or expired.');
    }

    // 3. Fetch fresh user data
    const user = await this.repo.findUserById(payload.sub);
    if (!user || user.status !== 'active') {
      throw new UnauthorizedError('User account is no longer active.');
    }

    // 4. Rotate: revoke old session, create new one
    await this.repo.revokeSession(session.id);
    const tokens = await this.createSessionAndTokens(user, {
      ipAddress: session.ipAddress ?? undefined,
      deviceInfo: session.deviceInfo ?? undefined,
    });

    return tokens;
  }

  // ─── Logout ────────────────────────────────────────────────

  async logout(refreshToken: string): Promise<void> {
    let payload: JwtRefreshPayload;
    try {
      payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as JwtRefreshPayload;
    } catch {
      // Token already invalid — silently succeed (idempotent logout)
      return;
    }

    const session = await this.repo.findValidSession(refreshToken);
    if (session) {
      await this.repo.revokeSession(session.id);
    }

    // Ignore payload.sub lint warning — used for sessionId lookup
    void payload;
  }

  // ─── Logout All Devices ────────────────────────────────────

  async logoutAll(userId: string): Promise<void> {
    await this.repo.revokeAllUserSessions(userId);
    await this.repo.deactivateDeviceTokens(userId);
  }

  // ─── Change Password ───────────────────────────────────────

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.repo.findUserById(userId);
    if (!user) {
      throw new UnauthorizedError('User not found.');
    }

    const passwordValid = await argon2.verify(user.passwordHash, currentPassword);
    if (!passwordValid) {
      throw new UnauthorizedError('Incorrect current password.');
    }

    const passwordHash = await argon2.hash(newPassword, {
      type: argon2.argon2id,
      memoryCost: env.ARGON2_MEMORY_COST,
      timeCost: env.ARGON2_TIME_COST,
      parallelism: env.ARGON2_PARALLELISM,
    });

    await this.repo.updateUserPassword(userId, passwordHash);

    // Revoke all sessions so they have to log in again with new password
    await this.repo.revokeAllUserSessions(userId);
    await this.repo.deactivateDeviceTokens(userId);
  }

  // ─── Verify Access Token ───────────────────────────────────

  verifyAccessToken(token: string): JwtAccessPayload {
    try {
      const payload = jwt.verify(token, env.JWT_SECRET) as JwtAccessPayload;
      if (payload.type !== 'access') {
        throw new UnauthorizedError('Invalid token type.');
      }
      return payload;
    } catch (err) {
      if (err instanceof UnauthorizedError) throw err;
      if (err instanceof jwt.TokenExpiredError) {
        throw new UnauthorizedError('Access token has expired.');
      }
      throw new UnauthorizedError('Invalid access token.');
    }
  }

  // ─── Register Device Token ─────────────────────────────────

  async registerDeviceToken(
    userId: string,
    token: string,
    platform: 'android' | 'ios',
  ): Promise<void> {
    await this.repo.upsertDeviceToken({ userId, token, platform });
  }

  // ─── Private Helpers ───────────────────────────────────────

  private async createSessionAndTokens(
    user: UserWithRole,
    opts: { ipAddress?: string; deviceInfo?: string },
  ): Promise<AuthTokens> {
    // Refresh token expiry — 30 days default
    const refreshExpiresAt = new Date();
    refreshExpiresAt.setDate(
      refreshExpiresAt.getDate() +
      parseExpiryToDays(env.JWT_REFRESH_EXPIRY),
    );

    // Generate the session id up front so it can be embedded in the refresh
    // JWT. This lets us persist the session in a SINGLE write (atomic) instead
    // of the previous create → revoke → create dance.
    const sessionId = crypto.randomUUID();

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user.id, sessionId);

    await this.repo.createSession({
      id: sessionId,
      userId: user.id,
      refreshToken,
      expiresAt: refreshExpiresAt,
      ipAddress: opts.ipAddress,
      deviceInfo: opts.deviceInfo,
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: this.accessTokenExpirySeconds,
    };
  }
}

// ─── Utility ─────────────────────────────────────────────────

function parseExpiryToSeconds(expiry: string): number {
  const match = expiry.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 900;
  const value = parseInt(match[1] ?? '15');
  const unit = match[2];
  switch (unit) {
    case 's': return value;
    case 'm': return value * 60;
    case 'h': return value * 3600;
    case 'd': return value * 86400;
    default: return 900;
  }
}

function parseExpiryToDays(expiry: string): number {
  const match = expiry.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 30;
  const value = parseInt(match[1] ?? '30');
  const unit = match[2];
  switch (unit) {
    case 'd': return value;
    case 'h': return Math.ceil(value / 24);
    default: return 30;
  }
}

// Export for use in login rate-limit key
export { MAX_LOGIN_ATTEMPTS };
