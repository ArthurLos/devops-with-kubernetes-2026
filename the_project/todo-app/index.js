require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;
const IMAGE_DIR = process.env.IMAGE_DIR || '/usr/src/app/images';
const IMAGE_PATH = path.join(IMAGE_DIR, 'image.jpg');
const META_PATH = path.join(IMAGE_DIR, 'fetched-at.txt');
const CACHE_DURATION_MS = 10 * 60 * 1000;

async function fetchNewImage() {
  const response = await fetch('https://picsum.photos/1200');
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.mkdirSync(IMAGE_DIR, { recursive: true });
  fs.writeFileSync(IMAGE_PATH, buffer);
  fs.writeFileSync(META_PATH, String(Date.now()));
}

async function ensureFreshImage() {
  let fetchedAt = 0;
  try {
    fetchedAt = parseInt(fs.readFileSync(META_PATH, 'utf8'), 10) || 0;
  } catch (err) {
    // no metadata yet
  }

  const isStale = Date.now() - fetchedAt > CACHE_DURATION_MS;
  const imageMissing = !fs.existsSync(IMAGE_PATH);

  if (isStale || imageMissing) {
    await fetchNewImage();
  }
}

app.get('/', (req, res) => {
  res.send(`<!doctype html>
<html>
  <head>
    <title>Todo app</title>
    <style>
      body { text-align: center; font-family: sans-serif; }
      img { max-width: 400px; }
    </style>
  </head>
  <body>
    <h1>Todo App</h1>
    <img src="/image" alt="Random picture" />
    <p>DevOps with Kubernetes 2026</p>
  </body>
</html>`);
});

app.get('/image', async (req, res) => {
  try {
    await ensureFreshImage();
    res.sendFile(IMAGE_PATH);
  } catch (err) {
    res.status(502).send('Could not fetch image.');
  }
});

app.listen(PORT, () => {
  console.log(`Server started in port ${PORT}`);
});
