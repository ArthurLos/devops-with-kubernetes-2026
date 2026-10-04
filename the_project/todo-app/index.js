require('dotenv').config();
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('<!doctype html><html><head><title>Todo app</title></head><body><h1>Todo app</h1><p>Coming soon.</p></body></html>');
});

app.listen(PORT, () => {
  console.log(`Server started in port ${PORT}`);
});
