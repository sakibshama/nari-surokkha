import { describe, it, expect, vi } from 'vitest';
import { createOrPromoteAdmin, validateAdminInput, ADMIN_PERMISSIONS } from '@/scripts/admin-bootstrap';

function mockPrisma(existing: { id: string } | null) {
  return {
    role: { upsert: vi.fn(async () => ({ id: 'role-admin' })) },
    user: {
      findUnique: vi.fn(async () => existing),
      create: vi.fn(async (_args: { data: Record<string, unknown> }) => ({ id: 'new-user' })),
      update: vi.fn(async (_args: { data: Record<string, unknown> }) => ({})),
    },
    userSession: { deleteMany: vi.fn(async () => ({ count: 2 })) },
  };
}
const hash = async (p: string) => `hashed:${p}`;
const input = { phone: '+8801712345678', fullName: 'Rina Admin', password: 'correct-horse-battery' };

describe('admin bootstrap', () => {
  it('rejects weak or malformed input', () => {
    expect(validateAdminInput({ ...input, password: 'short' })).toMatch(/12 characters/);
    expect(validateAdminInput({ ...input, phone: '01712-abc' })).toMatch(/Phone/);
    expect(validateAdminInput({ ...input, email: 'nope' })).toMatch(/Email/);
    expect(validateAdminInput(input)).toBeNull();
  });

  it('creates a new admin with a hashed password and full permissions', async () => {
    const prisma = mockPrisma(null);
    const r = await createOrPromoteAdmin(prisma as never, input, hash);
    expect(r).toEqual({ userId: 'new-user', action: 'created' });
    const data = prisma.user.create.mock.calls[0]![0].data;
    expect(data.passwordHash).toBe('hashed:correct-horse-battery');
    expect(data.roleId).toBe('role-admin');
    expect(data.permissions).toEqual(ADMIN_PERMISSIONS);
  });

  it('promotes an existing account, resets its password and signs out its sessions', async () => {
    const prisma = mockPrisma({ id: 'u1' });
    const r = await createOrPromoteAdmin(prisma as never, input, hash);
    expect(r.action).toBe('promoted');
    expect(prisma.user.update.mock.calls[0]![0].data).toMatchObject({ roleId: 'role-admin', status: 'active', passwordHash: 'hashed:correct-horse-battery' });
    expect(prisma.userSession.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
  });
});
