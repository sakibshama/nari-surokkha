/**
 * Development Seed Data — Nari Surokkha
 *
 * SAFE DEV DATA ONLY — never use in production.
 *
 * Seeds:
 * - 1 test citizen user
 * - 1 test responder (verified)
 * - Trusted contacts for test user
 *
 * Run: npm run prisma:seed
 *
 * ⚠️ All passwords below are DEV-ONLY test passwords.
 *    Real argon2 hashes must be used in production.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Dev-only argon2id hash for "Test@1234"
// Generated with: argon2.hash('Test@1234', {memoryCost:65536, timeCost:3, parallelism:4})
const DEV_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$vp4Ojh1XN5LTlt3wZwui+g$TLFb1WGiIiHLCPw+pSwM+8SZfJtOu1bhpnRdSUT7xhc';

async function main(): Promise<void> {
  console.log('🌱 Starting dev seed...');

  // ─── Roles ────────────────────────────────────────
  
  await prisma.role.upsert({
    where: { key: 'citizen' },
    update: {},
    create: { name: 'Citizen', key: 'citizen', isSystem: true }
  });

  await prisma.role.upsert({
    where: { key: 'responder' },
    update: {},
    create: { name: 'Responder', key: 'responder', isSystem: true }
  });

  await prisma.role.upsert({
    where: { key: 'admin' },
    update: {},
    create: { name: 'Administrator', key: 'admin', isSystem: true }
  });

  console.log('✅ Roles seeded');

  // ─── Demo-data guard ─────────────────────────────────────────
  // Everything below (test citizen/responder/admin logins with a
  // shared dev password, sample incidents) is DEV/DEMO ONLY. In production it is
  // skipped unless ALLOW_DEV_SEED=true is explicitly set, so a real deployment
  // never ships with known test credentials. Essential roles above always seed.
  const seedDemo =
    process.env.NODE_ENV !== 'production' || process.env.ALLOW_DEV_SEED === 'true';
  if (!seedDemo) {
    console.log('⏭  Production seed: roles only. Set ALLOW_DEV_SEED=true to include demo data.');
    return;
  }

  // ─── Test Citizen User ───────────────────────────────────────

  const testUser = await prisma.user.upsert({
    where: { phone: '+8801912345678' },
    update: {},
    create: {
      phone: '+8801912345678',
      email: 'test.citizen@nari.test',
      passwordHash: DEV_PASSWORD_HASH,
      role: { connect: { key: 'citizen' } },
      status: 'active',
      profile: {
        create: {
          fullName: 'Test Citizen User',
          bloodGroup: 'B+',
          preferredLanguage: 'bn',
          emergencyNote: 'Dev test account. Not a real emergency.',
        },
      },
    },
  });

  console.log('✅ Test citizen seeded:', testUser.id);

  // ─── Trusted Contacts ────────────────────────────────────────

  await prisma.trustedContact.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      userId: testUser.id,
      name: 'Test Contact (Father)',
      phone: '+8801712345679',
      relation: 'father',
      isPrimary: true,
    },
  });

  console.log('✅ Trusted contacts seeded');

  // ─── Test Responder ──────────────────────────────────────────

  const responderUser = await prisma.user.upsert({
    where: { phone: '+8801912345699' },
    update: {},
    create: {
      phone: '+8801912345699',
      email: 'test.responder@nari.test',
      passwordHash: DEV_PASSWORD_HASH,
      role: { connect: { key: 'responder' } },
      status: 'active',
      profile: {
        create: {
          fullName: 'Test Responder User',
          preferredLanguage: 'bn',
        },
      },
    },
  });

  await prisma.responder.upsert({
    where: { userId: responderUser.id },
    update: {},
    create: {
      userId: responderUser.id,
      status: 'verified',
      availability: 'available',
      occupation: 'Medical Professional',
      latitude: 23.7461,
      longitude: 90.3742,
    },
  });

  console.log('✅ Test responder seeded:', responderUser.id);

  // ─── Test Admin User ─────────────────────────────────────────

  const adminUser = await prisma.user.upsert({
    where: { phone: '+8801912345600' },
    update: {},
    create: {
      phone: '+8801912345600',
      email: 'superadmin@nari.test',
      passwordHash: DEV_PASSWORD_HASH,
      role: { connect: { key: 'admin' } },
      permissions: ['manage_users', 'manage_admins', 'view_audit_logs'],
      status: 'active',
      profile: {
        create: {
          fullName: 'System Administrator',
          preferredLanguage: 'en',
        },
      },
    },
  });

  console.log('✅ Test admin seeded:', adminUser.id);

  // ─── Test Incidents ──────────────────────────────────────────

  await prisma.incidentReport.create({
    data: {
      type: 'harassment',
      description: 'Suspicious activity reported near park',
      latitude: 23.7461,
      longitude: 90.3742,
      status: 'pending'
    }
  });

  await prisma.incidentReport.create({
    data: {
      type: 'robbery',
      description: 'Bag snatching incident',
      latitude: 23.7500,
      longitude: 90.3800,
      status: 'verified'
    }
  });

  console.log('✅ Test incidents seeded');

  // ─── Payment Gateway (SSLCommerz SANDBOX) ────────────────────
  // Public SSLCommerz sandbox test store — no real money moves. `update: {}`
  // means a config an admin already saved is never overwritten by re-seeding.
  const apiBaseUrl = process.env.API_BASE_URL ?? 'http://localhost:3001';
  await prisma.systemSetting.upsert({
    where: { key: 'sslcommerz_config' },
    update: {},
    create: {
      key: 'sslcommerz_config',
      value: {
        store_id: 'testbox',
        store_passwd: 'qwerty',
        is_sandbox: true,
        backend_url: apiBaseUrl,
        frontend_url: 'http://localhost:8081',
      },
    },
  });

  console.log('✅ SSLCommerz sandbox config seeded');

  console.log('\n🎉 Dev seed complete!');
  console.log('');
  console.log('Test credentials (DEV ONLY):');
  console.log('  Citizen:   +8801912345678 / Test@1234');
  console.log('  Responder: +8801912345699 / Test@1234');
  console.log('  Admin:     superadmin@nari.test / Test@1234');
  console.log('  (Passwords are placeholder hashes — Phase 4 adds real argon2 hashing)');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
