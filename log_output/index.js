const { randomUUID } = require('crypto');
const express = require('express');

const randomString = randomUUID();
const PORT = process.env.PORT || 3000;

setInterval(() => {
  console.log(`${new Date().toISOString()}: ${randomString}`);
}, 5000);

const app = express();

app.get('/', (req, res) => {
  res.send(`${new Date().toISOString()}: ${randomString}`);
});

app.listen(PORT, () => {
  console.log(`Server started in port ${PORT}`);
});
