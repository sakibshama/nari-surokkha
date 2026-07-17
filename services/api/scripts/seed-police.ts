import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding police data...');

  // 1. Create a dummy Police Station
  const station = await prisma.policeStation.upsert({
    where: { thanaCode: 'TH-001' },
    update: {},
    create: {
      name: 'Gulshan Model Thana',
      thanaCode: 'TH-001',
      district: 'Dhaka',
      division: 'Dhaka',
      phone: '01700000000',
      latitude: 23.7925,
      longitude: 90.4078,
    },
  });

  console.log(`Station created/exists: ${station.name}`);

  // 2. Create a dummy Police User
  const dummyHash = await argon2.hash('police123', {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });

  const officer = await prisma.policeUser.upsert({
    where: { badgeNumber: 'B-12345' },
    update: {},
    create: {
      stationId: station.id,
      badgeNumber: 'B-12345',
      fullName: 'Officer Kamal',
      phone: '01711111111',
      passwordHash: dummyHash,
      role: 'officer',
    },
  });

  console.log(`Officer created/exists: ${officer.fullName} (Badge: B-12345)`);
  console.log('Use Badge: B-12345 and Password: police123 to login.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
