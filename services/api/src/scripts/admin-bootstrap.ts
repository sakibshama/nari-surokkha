/**
 * Create the first administrator, or promote/reset an existing account.
 *
 * Production has no demo users and no default password, and registering
 * through the app needs an SMS code, while the SMS provider itself is set up
 * in the admin portal. This breaks that loop: run it once on the server.
 */
import argon2 from 'argon2';
import type { PrismaClient } from '@prisma/client';

export const ADMIN_PERMISSIONS = ['manage_users', 'manage_admins', 'view_audit_logs'];

export interface AdminInput {
  phone: string;
  fullName: string;
  password: string;
  email?: string;
}

export interface AdminResult {
  userId: string;
  action: 'created' | 'promoted';
}

export function validateAdminInput(input: AdminInput): string | null {
  if (!/^\+?[0-9]{8,15}$/.test(input.phone)) return 'Phone must be digits with an optional leading + (e.g. +8801712345678).';
  if (input.fullName.trim().length < 2) return 'Full name is required.';
  if (input.password.length < 12) return 'Use a password of at least 12 characters for an administrator.';
  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) return 'Email address is not valid.';
  return null;
}

export async function createOrPromoteAdmin(
  prisma: PrismaClient,
  input: AdminInput,
  hash: (password: string) => Promise<string> = (p) => argon2.hash(p, { type: argon2.argon2id }),
): Promise<AdminResult> {
  const problem = validateAdminInput(input);
  if (problem) throw new Error(problem);

  // System roles come from the seed; create the admin role if the seed was skipped.
  const role = await prisma.role.upsert({
    where: { key: 'admin' },
    update: {},
    create: { name: 'Administrator', key: 'admin', isSystem: true },
  });
  const passwordHash = await hash(input.password);
  const email = input.email?.trim() || undefined;

  const existing = await prisma.user.findUnique({ where: { phone: input.phone } });
  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        roleId: role.id,
        permissions: ADMIN_PERMISSIONS,
        status: 'active',
        passwordHash,
        ...(email ? { email } : {}),
        profile: {
          upsert: { create: { fullName: input.fullName.trim() }, update: { fullName: input.fullName.trim() } },
        },
      },
    });
    // Sign out any session that still carries the old role or password.
    await prisma.userSession.deleteMany({ where: { userId: existing.id } });
    return { userId: existing.id, action: 'promoted' };
  }

  const user = await prisma.user.create({
    data: {
      phone: input.phone,
      email,
      passwordHash,
      roleId: role.id,
      permissions: ADMIN_PERMISSIONS,
      status: 'active',
      profile: { create: { fullName: input.fullName.trim() } },
    },
  });
  return { userId: user.id, action: 'created' };
}
