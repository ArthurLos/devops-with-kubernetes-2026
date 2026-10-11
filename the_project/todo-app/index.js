require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;
const IMAGE_DIR = process.env.IMAGE_DIR || '/usr/src/app/images';
const IMAGE_PATH = path.join(IMAGE_DIR, 'image.jpg');
const META_PATH = path.join(IMAGE_DIR, 'fetched-at.txt');
const CACHE_DURATION_MS = parseInt(process.env.CACHE_DURATION_MS, 10) || 10 * 60 * 1000;
const PICSUM_URL = process.env.PICSUM_URL || 'https://picsum.photos/1200';
const TODO_BACKEND_URL = process.env.TODO_BACKEND_URL || 'http://todo-backend-svc:2345/todos';

async function fetchNewImage() {
  const response = await fetch(PICSUM_URL);
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

app.get('/', async (req, res) => {
  let todos = [];
  try {
    const response = await fetch(TODO_BACKEND_URL);
    todos = await response.json();
  } catch (err) {
    // todo-backend unreachable, render an empty list
  }

  const todoItems = todos.map((todo) => `<li>${todo}</li>`).join('\n      ');

  res.send(`<!doctype html>
<html>
  <head>
    <title>Todo app</title>
    <style>
      body { text-align: center; font-family: sans-serif; }
      img { max-width: 400px; }
      form { margin: 1.5em 0; }
      input[type="text"] {
        padding: 0.5em;
        width: 300px;
        border: 1px solid #4caf50;
        border-radius: 4px;
      }
      button {
        padding: 0.5em 1.2em;
        background: #4caf50;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
      }
      ul { list-style: none; padding: 0; max-width: 500px; margin: 0 auto; text-align: left; }
      li {
        background: #f7f7f7;
        border-left: 4px solid #4caf50;
        padding: 0.75em 1em;
        margin-bottom: 0.5em;
      }
    </style>
  </head>
  <body>
    <h1>Todo App</h1>
    <img src="/image" alt="Random picture" />
    <form method="POST" action="/todos">
      <input type="text" name="text" maxlength="140" placeholder="Enter a new todo (max 140 characters)" required />
      <button type="submit">Send</button>
    </form>
    <h2>Todos</h2>
    <ul id="todo-list">
      ${todoItems}
    </ul>
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
