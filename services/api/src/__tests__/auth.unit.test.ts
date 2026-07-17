/**
 * Auth Module — Unit Tests
 *
 * Tests the Auth service logic (hashing, JWTs, role checks)
 * using mocked dependencies. No real database required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from '@/modules/auth/auth.service';
import { AuthRepository } from '@/modules/auth/auth.repository';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { UnauthorizedError, ConflictError, ForbiddenError } from '@/utils/errors';
import type { UserWithRole } from '@/modules/auth/auth.repository';
import { Mocked } from 'vitest';

// Mock dependencies
vi.mock('argon2');
vi.mock('jsonwebtoken');

describe('AuthService', () => {
  let service: AuthService;
  let repo: Mocked<AuthRepository>;

  const mockUser = {
    id: '123',
    phone: '01711223344',
    passwordHash: 'hash',
    roleId: 'role-citizen',
    permissions: [],
    status: 'active',
    email: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    role: {
      id: 'role-citizen',
      name: 'Citizen',
      key: 'citizen',
      description: null,
      isSystem: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  } as unknown as UserWithRole;

  beforeEach(() => {
    repo = {
      findUserByPhone: vi.fn(),
      findUserById: vi.fn(),
      createUser: vi.fn(),
      createSession: vi.fn(),
      findValidSession: vi.fn(),
      revokeSession: vi.fn(),
      revokeAllUserSessions: vi.fn(),
      upsertDeviceToken: vi.fn(),
    } as unknown as Mocked<AuthRepository>;

    service = new AuthService(repo);

    vi.clearAllMocks();
  });

  describe('register', () => {
    it('creates a user and returns tokens when phone is unique', async () => {
      repo.findUserByPhone.mockResolvedValue(null);
      vi.mocked(argon2.hash).mockResolvedValue('new-hash');
      repo.createUser.mockResolvedValue(mockUser);
      repo.createSession.mockResolvedValue({ id: 'sess-1' } as any);
      vi.mocked(jwt.sign).mockReturnValue('mock-token' as any);

      const result = await service.register({
        phone: '+8801912345678',
        password: 'Password123',
        fullName: 'Test User',
      });

      expect(repo.findUserByPhone).toHaveBeenCalledWith('+8801912345678');
      expect(argon2.hash).toHaveBeenCalled();
      expect(repo.createUser).toHaveBeenCalled();
      expect(result.user.id).toBe('123');
      expect(result.tokens.accessToken).toBe('mock-token');
      expect(result.tokens.refreshToken).toBe('mock-token');
    });

    it('throws ConflictError if phone already exists', async () => {
      repo.findUserByPhone.mockResolvedValue(mockUser);

      await expect(
        service.register({
          phone: '+8801912345678',
          password: 'Password123',
          fullName: 'Test User',
        }),
      ).rejects.toThrow(ConflictError);
    });
  });

  describe('login', () => {
    it('returns tokens for valid credentials', async () => {
      repo.findUserByPhone.mockResolvedValue(mockUser);
      vi.mocked(argon2.verify).mockResolvedValue(true);
      repo.createSession.mockResolvedValue({ id: 'sess-1' } as any);
      vi.mocked(jwt.sign).mockReturnValue('mock-token' as any);

      const result = await service.login({
        phone: '+8801912345678',
        password: 'Password123',
      });

      expect(result.user.id).toBe('123');
      expect(result.tokens.accessToken).toBe('mock-token');
    });

    it('throws UnauthorizedError for bad password', async () => {
      repo.findUserByPhone.mockResolvedValue(mockUser);
      vi.mocked(argon2.verify).mockResolvedValue(false);

      await expect(
        service.login({ phone: '+8801912345678', password: 'wrong' }),
      ).rejects.toThrow(UnauthorizedError);
    });

    it('throws ForbiddenError if account is suspended', async () => {
      repo.findUserByPhone.mockResolvedValue({
        ...mockUser,
        status: 'suspended',
      });
      vi.mocked(argon2.verify).mockResolvedValue(true);

      await expect(
        service.login({ phone: '+8801912345678', password: 'Password123' }),
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('refresh', () => {
    it('rotates tokens for a valid refresh request', async () => {
      vi.mocked(jwt.verify).mockReturnValue({
        sub: 'user-123',
        type: 'refresh',
      } as any);

      repo.findValidSession.mockResolvedValue({ id: 'sess-old' } as any);
      repo.findUserById.mockResolvedValue(mockUser);
      repo.createSession.mockResolvedValue({ id: 'sess-new' } as any);
      vi.mocked(jwt.sign).mockReturnValue('new-token' as any);

      const tokens = await service.refresh('old-refresh-token');

      expect(repo.revokeSession).toHaveBeenCalledWith('sess-old');
      expect(repo.createSession).toHaveBeenCalled();
      expect(tokens.accessToken).toBe('new-token');
    });

    it('throws UnauthorizedError if session revoked', async () => {
      vi.mocked(jwt.verify).mockReturnValue({ type: 'refresh' } as any);
      repo.findValidSession.mockResolvedValue(null);

      await expect(service.refresh('token')).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('verifyAccessToken', () => {
    it('returns payload for valid access token', () => {
      const mockPayload = { sub: 'user-1', role: 'citizen', type: 'access' };
      vi.mocked(jwt.verify).mockReturnValue(mockPayload as any);

      const payload = service.verifyAccessToken('valid-token');
      expect(payload).toEqual(mockPayload);
    });

    it('throws UnauthorizedError for expired token', () => {
      vi.mocked(jwt.verify).mockImplementation(() => {
        throw new jwt.TokenExpiredError('expired', new Date());
      });

      expect(() => service.verifyAccessToken('expired-token')).toThrow(
        UnauthorizedError,
      );
    });

    it('throws UnauthorizedError for refresh token passed as access token', () => {
      vi.mocked(jwt.verify).mockReturnValue({ type: 'refresh' } as any);

      expect(() => service.verifyAccessToken('refresh-token')).toThrow(
        UnauthorizedError,
      );
    });
  });
});
