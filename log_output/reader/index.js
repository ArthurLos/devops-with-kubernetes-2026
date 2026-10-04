const fs = require('fs');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;
const FILE_PATH = process.env.FILE_PATH || '/usr/src/app/shared/status.txt';
const COUNTER_FILE = process.env.COUNTER_FILE || '/usr/src/app/pingpong/counter.txt';

app.get('/status', (req, res) => {
  let status = 'No status written yet.';
  try {
    status = fs.readFileSync(FILE_PATH, 'utf8').trim();
  } catch (err) {
    // no status file yet
  }

  let pingPongs = 0;
  try {
    pingPongs = parseInt(fs.readFileSync(COUNTER_FILE, 'utf8'), 10) || 0;
  } catch (err) {
    // no counter file yet
  }

  res.type('text/plain').send(`${status}\nPing / Pongs: ${pingPongs}\n`);
});

app.listen(PORT, () => {
  console.log(`Server started in port ${PORT}`);
});
