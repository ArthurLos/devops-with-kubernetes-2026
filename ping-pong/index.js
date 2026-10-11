const fs = require('fs');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;
const COUNTER_FILE = process.env.COUNTER_FILE || '/usr/src/app/data/counter.txt';

function loadState() {
  try {
    const persisted = parseInt(fs.readFileSync(COUNTER_FILE, 'utf8'), 10) || 0;
    return { lastShown: persisted, nextValue: persisted + 1 };
  } catch (err) {
    return { lastShown: 0, nextValue: 0 }; // no file yet, truly fresh start
  }
}

let { lastShown, nextValue } = loadState();

app.get('/pingpong', (req, res) => {
  lastShown = nextValue;
  res.send(`pong ${lastShown}`);
  fs.writeFileSync(COUNTER_FILE, String(lastShown));
  nextValue++;
});

app.get('/pings', (req, res) => {
  res.send(String(lastShown));
});

app.listen(PORT, () => {
  console.log(`Server started in port ${PORT}`);
});
