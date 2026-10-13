/**
 * Admin user management: B1 (privilege escalation), B2 (no default password),
 * the password-hash leak, edit-password and delete-user.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { AdminService, AdminActor } from '../modules/admin/admin.service';
import { AdminRepository, ADMIN_USER_SELECT } from '../modules/admin/admin.repository';
import {
  adminCreateUserSchema,
  adminListUsersSchema,
  adminUpdateUserSchema,
} from '../modules/admin/admin.schemas';
import { ForbiddenError, ValidationError } from '@/utils/errors';

const FULL: AdminActor = { id: 'admin-1', permissions: ['manage_users', 'manage_admins', 'view_audit_logs'] };
const LIMITED: AdminActor = { id: 'admin-2', permissions: ['manage_users'] };

const citizen = {
  id: 'u1',
  phone: '+8801711111111',
  email: null,
  status: 'active',
  permissions: [] as string[],
  roleId: 'r-citizen',
  role: { id: 'r-citizen', key: 'citizen', name: 'Citizen' },
  profile: { fullName: 'Rina', nationalId: null, bloodGroup: null, preferredLanguage: 'bn', isVerified: false, verifiedAt: null },
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('AdminService — users', () => {
  let repo: Record<string, ReturnType<typeof vi.fn>>;
  let redis: { incr: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };
  let service: AdminService;

  beforeEach(() => {
    repo = {
      findUser: vi.fn().mockResolvedValue(citizen),
      roleExists: vi.fn(async (key: string) => ['citizen', 'responder', 'admin', 'police'].includes(key)),
      isPhoneTaken: vi.fn().mockResolvedValue(false),
      isEmailTaken: vi.fn().mockResolvedValue(false),
      createUser: vi.fn(async (d) => ({ ...citizen, ...d })),
      updateUser: vi.fn(async () => citizen),
      revokeSessions: vi.fn(),
      hasHistory: vi.fn().mockResolvedValue(false),
      deleteUser: vi.fn(),
      deactivateUser: vi.fn(),
    };
    redis = { incr: vi.fn().mockResolvedValue(1), get: vi.fn() };
    const fastify = {
      redis,
      log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
    } as unknown as FastifyInstance;
    service = new AdminService(repo as unknown as AdminRepository, fastify);
  });

  describe('createUser', () => {
    it('hashes the given password (never a default) and returns no hash', async () => {
      const user = await service.createUser(FULL, { phone: '+8801722222222', password: 'S3cure-pass', fullName: 'Mitu' });
      const args = repo.createUser.mock.calls[0][0];
      expect(args.passwordHash).toMatch(/^\$argon2id\$/);
      expect(args.passwordHash).not.toContain('S3cure-pass');
      expect(args.roleKey).toBe('citizen');
      expect(user).not.toHaveProperty('password');
    });

    it('cannot grant permissions the creator does not hold', async () => {
      await expect(
        service.createUser(LIMITED, { phone: '+8801722222222', password: 'S3cure-pass', fullName: 'X', permissions: ['view_audit_logs'] }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(repo.createUser).not.toHaveBeenCalled();
    });

    it('a default admin only receives permissions the creator holds', async () => {
      const actor: AdminActor = { id: 'a', permissions: ['manage_users', 'manage_admins'] };
      await service.createUser(actor, { phone: '+8801722222222', password: 'S3cure-pass', fullName: 'X', role: 'admin' });
      expect(repo.createUser.mock.calls[0][0].permissions).toEqual(['manage_users', 'manage_admins']);
    });

    it('only manage_admins holders may create admins', async () => {
      await expect(
        service.createUser(LIMITED, { phone: '+8801722222222', password: 'S3cure-pass', fullName: 'X', role: 'admin' }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it.each(['police', 'nonexistent'])('role %s is a 400, not a 500', async (role) => {
      await expect(
        service.createUser(FULL, { phone: '+8801722222222', password: 'S3cure-pass', fullName: 'X', role }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('updateUser', () => {
    it('an admin cannot change their own role or permissions', async () => {
      repo.findUser.mockResolvedValue({ ...citizen, id: FULL.id, role: { id: 'r', key: 'admin', name: 'Admin' }, permissions: FULL.permissions });
      await expect(service.updateUser(FULL, FULL.id, { role: 'citizen' })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(service.updateUser(FULL, FULL.id, { permissions: ['manage_users'] })).rejects.toBeInstanceOf(ForbiddenError);
      expect(repo.updateUser).not.toHaveBeenCalled();
    });

    it('re-saving their own unchanged role/permissions (full form) is fine', async () => {
      repo.findUser.mockResolvedValue({ ...citizen, id: FULL.id, role: { id: 'r', key: 'admin', name: 'Admin' }, permissions: FULL.permissions });
      await service.updateUser(FULL, FULL.id, { role: 'admin', permissions: [...FULL.permissions].reverse(), fullName: 'New name' });
      expect(repo.updateUser).toHaveBeenCalled();
      expect(redis.incr).not.toHaveBeenCalled();
    });

    it('cannot grant a permission the editor does not hold', async () => {
      await expect(service.updateUser(LIMITED, 'u1', { permissions: ['manage_admins'] })).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('a profile-only edit does not log the user out', async () => {
      await service.updateUser(FULL, 'u1', { fullName: 'Rina B', role: 'citizen', permissions: [] });
      const data = repo.updateUser.mock.calls[0][1];
      expect(data).toEqual({ profile: { update: { fullName: 'Rina B' } } });
      expect(redis.incr).not.toHaveBeenCalled();
    });

    it('a new password is hashed, revokes sessions and bumps the token version', async () => {
      await service.updateUser(FULL, 'u1', { password: 'brand-new-pass' });
      expect(repo.updateUser.mock.calls[0][1].passwordHash).toMatch(/^\$argon2id\$/);
      expect(repo.revokeSessions).toHaveBeenCalledWith('u1');
      expect(redis.incr).toHaveBeenCalledTimes(1);
    });

    it('a role change bumps the token version', async () => {
      await service.updateUser(FULL, 'u1', { role: 'responder' });
      expect(repo.updateUser.mock.calls[0][1].role).toEqual({ connect: { key: 'responder' } });
      expect(redis.incr).toHaveBeenCalledTimes(1);
    });
  });

  describe('deleteUser', () => {
    it('hard-deletes a user with no history', async () => {
      await expect(service.deleteUser(FULL, 'u1')).resolves.toEqual({ result: 'deleted' });
      expect(repo.deleteUser).toHaveBeenCalledWith('u1');
    });

    it('deactivates a user with history instead of failing', async () => {
      repo.hasHistory.mockResolvedValue(true);
      await expect(service.deleteUser(FULL, 'u1')).resolves.toEqual({ result: 'deactivated' });
      expect(repo.deactivateUser).toHaveBeenCalledWith('u1');
      expect(repo.deleteUser).not.toHaveBeenCalled();
      expect(redis.incr).toHaveBeenCalled();
    });

    it('cannot delete yourself', async () => {
      await expect(service.deleteUser(FULL, FULL.id)).rejects.toBeInstanceOf(ForbiddenError);
    });
  });
});

describe('Admin user responses never contain passwordHash', () => {
  it('the repository selects explicit columns, without passwordHash', async () => {
    expect(ADMIN_USER_SELECT).not.toHaveProperty('passwordHash');

    const prisma = {
      user: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockResolvedValue({}),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    const repo = new AdminRepository(prisma as never);
    await repo.listUsers();
    await repo.createUser({ phone: 'p', email: null, passwordHash: 'h', fullName: 'f', roleKey: 'citizen', permissions: [], isVerified: false });
    await repo.updateUser('u1', {});
    for (const call of [prisma.user.findMany, prisma.user.create, prisma.user.update]) {
      expect(call.mock.calls[0][0].select).toBe(ADMIN_USER_SELECT);
      expect(call.mock.calls[0][0]).not.toHaveProperty('include');
    }
  });

  it('the response schemas strip it even if a row carries it', async () => {
    const app = Fastify();
    const leaky = { ...citizen, passwordHash: '$argon2id$secret' };
    app.get('/users', { schema: adminListUsersSchema }, async () => ({ success: true, data: [leaky], total: 1 }));
    app.post('/users', { schema: adminCreateUserSchema }, async () => ({ success: true, data: leaky }));
    app.put('/users/:id', { schema: adminUpdateUserSchema }, async () => ({ success: true, data: leaky }));

    const list = await app.inject({ method: 'GET', url: '/users' });
    const created = await app.inject({
      method: 'POST', url: '/users', payload: { phone: '+8801722222222', fullName: 'X', password: 'S3cure-pass' },
    });
    const updated = await app.inject({
      method: 'PUT', url: '/users/7f1e8a1c-1a2b-4c3d-8e9f-0a1b2c3d4e5f', payload: { fullName: 'Y' },
    });

    for (const res of [list, created, updated]) {
      expect(res.statusCode).toBe(200);
      expect(res.body).not.toContain('passwordHash');
      expect(res.body).not.toContain('argon2');
    }
    expect(list.json().data[0].profile.fullName).toBe('Rina');
    await app.close();
  });

  it('create without a password is a 400 (no default password, B2)', async () => {
    const app = Fastify();
    app.post('/users', { schema: adminCreateUserSchema }, async () => ({ success: true }));
    const res = await app.inject({ method: 'POST', url: '/users', payload: { phone: '+8801722222222', fullName: 'X' } });
    expect(res.statusCode).toBe(400);
    const short = await app.inject({ method: 'POST', url: '/users', payload: { phone: '+8801722222222', fullName: 'X', password: 'short' } });
    expect(short.statusCode).toBe(400);
    await app.close();
  });
});
