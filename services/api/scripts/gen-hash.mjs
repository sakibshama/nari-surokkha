import argon2 from 'argon2';
argon2.hash('Test@1234', {
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4
}).then(h => {
  console.log('HASH:' + h);
}).catch(e => {
  console.error(e);
  process.exit(1);
});
