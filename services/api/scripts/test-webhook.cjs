const axios = require('axios');
const { PrismaClient } = require('@prisma/client');

async function testWebhook() {
  const prisma = new PrismaClient();
  
  try {
    // 1. Ensure user exists
    const userPhone = '+8801999999999';
    let user = await prisma.user.findUnique({ where: { phone: userPhone } });
    if (!user) {
      console.log('User not found, creating dummy user...');
      user = await prisma.user.create({
        data: {
          phone: userPhone,
          passwordHash: 'dummy',
          role: 'citizen',
          profile: {
            create: {
              fullName: 'Offline Victim Tester'
            }
          }
        }
      });
    }

    // 2. Fire webhook to our local server
    console.log('Sending mock offline SOS webhook...');
    const payload = {
      From: userPhone,
      Body: 'SOS EMERGENCY! I am in danger. My location: https://maps.google.com/?q=23.7500,90.3900'
    };

    const response = await axios.post('http://localhost:3001/api/v1/alerts/sms-webhook', payload, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log('Webhook responded with status:', response.status);
    console.log('Waiting to verify alert was created...');
    
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 3. Verify in DB
    const latestAlert = await prisma.emergencyAlert.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' }
    });

    if (latestAlert && Number(latestAlert.latitude) === 23.75) {
      console.log('SUCCESS! EmergencyAlert was created from the SMS webhook!');
      console.log('Alert ID:', latestAlert.id);
    } else {
      console.log('FAILED. EmergencyAlert was not created or mismatch in coordinates.', latestAlert);
    }

  } catch (err) {
    console.error('Error during test:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

testWebhook();
