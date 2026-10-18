const fs = require('fs');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;
const FILE_PATH = process.env.FILE_PATH || '/usr/src/app/shared/status.txt';
const PINGPONG_URL = process.env.PINGPONG_URL || 'http://ping-pong-svc:3000/pings';
const INFO_FILE_PATH = process.env.INFO_FILE_PATH || '/usr/src/app/config/information.txt';
const MESSAGE = process.env.MESSAGE || '';

// GKE's Ingress health check always GETs / on the backend Service, regardless of
// which path it's actually routed under (here /status) — it must return 200.
app.get('/', (req, res) => {
  res.sendStatus(200);
});

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

  let fileContent = '';
  try {
    fileContent = fs.readFileSync(INFO_FILE_PATH, 'utf8').trim();
  } catch (err) {
    // ConfigMap volume not mounted
  }

  res.type('text/plain').send(
    `file content: ${fileContent}\n` +
    `env variable: MESSAGE=${MESSAGE}\n` +
    `${status}\nPing / Pongs: ${pingPongs}\n`
  );
});

app.listen(PORT, () => {
  console.log(`Server started in port ${PORT}`);
});
