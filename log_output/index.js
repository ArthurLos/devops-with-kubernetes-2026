const { randomUUID } = require('crypto');

const randomString = randomUUID();

setInterval(() => {
  console.log(`${new Date().toISOString()}: ${randomString}`);
}, 5000);
