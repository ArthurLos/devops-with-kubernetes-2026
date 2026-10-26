const fs = require('fs');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;
const FILE_PATH = process.env.FILE_PATH || '/usr/src/app/shared/status.txt';
const PINGPONG_URL = process.env.PINGPONG_URL || 'http://ping-pong-svc:3000/pings';
const INFO_FILE_PATH = process.env.INFO_FILE_PATH || '/usr/src/app/config/information.txt';
const MESSAGE = process.env.MESSAGE || '';
const GREETER_URL = process.env.GREETER_URL || 'http://greeter-svc:3000/';

// GKE's Ingress health check always GETs / on the backend Service, regardless of
// which path it's actually routed under (here /status) — it must return 200.
app.get('/', (req, res) => {
  res.sendStatus(200);
});

// Exercise 4.1: ready once this reader can actually receive data from Ping-pong
// (not just once the process is up) — distinct from the GKE health-check stub above.
app.get('/healthz', async (req, res) => {
  try {
    const response = await fetch(PINGPONG_URL);
    if (!response.ok) {
      throw new Error(`ping-pong responded with ${response.status}`);
    }
    res.status(200).json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ status: 'unhealthy', error: err.message });
  }
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

  let greeting = '';
  try {
    const response = await fetch(GREETER_URL);
    greeting = (await response.text()).trim();
  } catch (err) {
    // greeter unreachable
  }

  res.type('text/plain').send(
    `file content: ${fileContent}\n` +
    `env variable: MESSAGE=${MESSAGE}\n` +
    `${status}\nPing / Pongs: ${pingPongs}\n` +
    `greetings: ${greeting}\n`
  );
});

app.listen(PORT, () => {
  console.log(`Server started in port ${PORT}`);
});
