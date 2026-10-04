const fs = require('fs');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;
const FILE_PATH = process.env.FILE_PATH || '/usr/src/app/shared/status.txt';

app.get('/status', (req, res) => {
  fs.readFile(FILE_PATH, 'utf8', (err, data) => {
    if (err) {
      return res.type('text/plain').send('No status written yet.\n');
    }
    res.type('text/plain').send(data);
  });
});

app.listen(PORT, () => {
  console.log(`Server started in port ${PORT}`);
});
