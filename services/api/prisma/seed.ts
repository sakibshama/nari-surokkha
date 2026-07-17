/**
 * Development Seed Data — Nari Surokkha
 *
 * SAFE DEV DATA ONLY — never use in production.
 *
 * Seeds:
 * - 2 police stations (Dhaka, Chittagong)
 * - 1 police admin user per station
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

  // ─── Police Stations ────────────────────────────────────────

  const dhakaStation = await prisma.policeStation.upsert({
    where: { thanaCode: 'DHK-001' },
    update: {},
    create: {
      name: 'Dhanmondi Police Station',
      thanaCode: 'DHK-001',
      district: 'Dhaka',
      division: 'Dhaka',
      address: 'Dhanmondi, Dhaka-1209',
      phone: '+8801711000001',
      latitude: 23.7461,
      longitude: 90.3742,
    },
  });

  const ctgStation = await prisma.policeStation.upsert({
    where: { thanaCode: 'CTG-001' },
    update: {},
    create: {
      name: 'Kotwali Police Station',
      thanaCode: 'CTG-001',
      district: 'Chattogram',
      division: 'Chattogram',
      address: 'Kotwali, Chattogram-4000',
      phone: '+8801711000002',
      latitude: 22.3475,
      longitude: 91.8123,
    },
  });

  console.log('✅ Police stations seeded:', dhakaStation.id, ctgStation.id);

  // ─── Police Users ────────────────────────────────────────────

  const dhakaOfficer = await prisma.policeUser.upsert({
    where: { badgeNumber: 'DHK-OFF-001' },
    update: {},
    create: {
      stationId: dhakaStation.id,
      badgeNumber: 'DHK-OFF-001',
      fullName: 'Inspector Rahim',
      phone: '+8801811000001',
      email: 'rahim.dhaka@police.test',
      passwordHash: DEV_PASSWORD_HASH,
      role: 'supervisor',
    },
  });

  // Portal pre-filled credentials officer (badge B-12345)
  await prisma.policeUser.upsert({
    where: { badgeNumber: 'B-12345' },
    update: {},
    create: {
      stationId: dhakaStation.id,
      badgeNumber: 'B-12345',
      fullName: 'Test Officer',
      phone: '+8801811000003',
      email: 'test.officer@police.test',
      passwordHash: DEV_PASSWORD_HASH,
      role: 'officer',
    },
  });

  console.log('✅ Police officer seeded:', dhakaOfficer.id);

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
      permissions: ['manage_users', 'manage_admins', 'manage_stations', 'view_audit_logs'],
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

  console.log('\n🎉 Dev seed complete!');
  console.log('');
  console.log('Test credentials (DEV ONLY):');
  console.log('  Citizen:   +8801912345678 / Test@1234');
  console.log('  Responder: +8801912345699 / Test@1234');
  console.log('  Police:    rahim.dhaka@police.test / Test@1234');
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
