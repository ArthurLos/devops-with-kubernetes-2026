const fs = require('fs');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;
const FILE_PATH = process.env.FILE_PATH || '/usr/src/app/shared/status.txt';
const PINGPONG_URL = process.env.PINGPONG_URL || 'http://ping-pong-svc:3000/pings';

app.get('/status', async (req, res) => {
  let status = 'No status written yet.';
  try {
    status = fs.readFileSync(FILE_PATH, 'utf8').trim();
  } catch (err) {
    // no status file yet
  }

  let pingPongs = 0;
  try {
    const response = await fetch(PINGPONG_URL);
    pingPongs = parseInt(await response.text(), 10) || 0;
  } catch (err) {
    // ping-pong unreachable
  }

  res.type('text/plain').send(`${status}\nPing / Pongs: ${pingPongs}\n`);
});

app.listen(PORT, () => {
  console.log(`Server started in port ${PORT}`);
});
