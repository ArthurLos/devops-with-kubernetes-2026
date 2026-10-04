const { randomUUID } = require('crypto');
const fs = require('fs');

const randomString = randomUUID();
const FILE_PATH = process.env.FILE_PATH || '/usr/src/app/shared/status.txt';

setInterval(() => {
  const line = `${new Date().toISOString()}: ${randomString}.\n`;
  fs.writeFileSync(FILE_PATH, line);
}, 5000);
