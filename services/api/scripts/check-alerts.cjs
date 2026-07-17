const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const alerts = await prisma.emergencyAlert.findMany({ orderBy: { createdAt: 'desc' }, take: 2 });
  console.log('Latest Alerts:');
  alerts.forEach(a => {
    console.log(`- ID: ${a.id}, Lat: ${a.latitude}, Lng: ${a.longitude}, Status: ${a.status}`);
  });
}
main();
