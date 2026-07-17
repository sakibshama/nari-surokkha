import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Migrating admin permissions...');
  
  const admins = await prisma.user.findMany({
    where: { role: { key: 'admin' } }
  });

  console.log(`Found ${admins.length} admins.`);

  for (const admin of admins) {
    await prisma.user.update({
      where: { id: admin.id },
      data: {
        permissions: ['manage_users', 'manage_admins', 'manage_stations', 'view_audit_logs']
      }
    });
    console.log(`Updated admin ${admin.phone}`);
  }

  console.log('Migration complete!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
