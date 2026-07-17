import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding dummy station and responder near Uttara (23.8458, 90.4210)');
  
  // Create dummy station
  await prisma.policeStation.upsert({
    where: { thanaCode: 'DUMMY-01' },
    update: {
      latitude: 23.8465,
      longitude: 90.4220
    },
    create: {
      name: 'Uttara Model Thana',
      thanaCode: 'DUMMY-01',
      district: 'Dhaka',
      division: 'Dhaka',
      address: 'Uttara, Dhaka',
      phone: '01700000001',
      latitude: 23.8465,
      longitude: 90.4220,
      isActive: true
    }
  });

  // Ensure a citizen user exists to attach responder to
  const user = await prisma.user.upsert({
    where: { phone: '+8801999999999' },
    update: {},
    create: {
      phone: '+8801999999999',
      passwordHash: 'dummy',
      role: 'responder',
      profile: {
        create: {
          fullName: 'Rahim Volunteer',
          preferredLanguage: 'en',
          isVerified: true
        }
      }
    }
  });

  // Create dummy responder
  await prisma.responder.upsert({
    where: { userId: user.id },
    update: {
      latitude: 23.8450,
      longitude: 90.4200,
      status: 'verified'
    },
    create: {
      userId: user.id,
      status: 'verified',
      availability: 'available',
      latitude: 23.8450,
      longitude: 90.4200
    }
  });

  console.log('Successfully seeded nearby station and responder!');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
