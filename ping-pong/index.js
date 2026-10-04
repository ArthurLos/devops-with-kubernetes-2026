const fs = require('fs');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;
const COUNTER_FILE = process.env.COUNTER_FILE || '/usr/src/app/shared/counter.txt';

function loadCounter() {
  try {
    const lastShown = parseInt(fs.readFileSync(COUNTER_FILE, 'utf8'), 10) || 0;
    return lastShown + 1; // file holds the last value we showed, resume one past it
  } catch (err) {
    return 0; // no file yet, truly fresh start
  }
}

let counter = loadCounter();

app.get('/pingpong', (req, res) => {
  res.send(`pong ${counter}`);
  fs.writeFileSync(COUNTER_FILE, String(counter));
  counter++;
});

app.listen(PORT, () => {
  console.log(`Server started in port ${PORT}`);
});
