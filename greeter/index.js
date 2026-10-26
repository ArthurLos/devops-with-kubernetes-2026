const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;
const GREETING = process.env.GREETING || 'Hello';

app.get('/', (req, res) => {
  res.type('text/plain').send(GREETING);
});

app.listen(PORT, () => {
  console.log(`Server started in port ${PORT}`);
});
