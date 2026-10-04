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

const HARDCODED_TODOS = [
  'Learn Kubernetes basics',
  'Deploy application to cluster',
  'Configure persistent volumes',
];

app.get('/', (req, res) => {
  const todoItems = HARDCODED_TODOS.map((todo) => `<li>${todo}</li>`).join('\n      ');

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
    <form id="todo-form">
      <input type="text" id="todo-input" maxlength="140" placeholder="Enter a new todo (max 140 characters)" />
      <button type="submit">Send</button>
    </form>
    <h2>Todos</h2>
    <ul id="todo-list">
      ${todoItems}
    </ul>
    <script>
      document.getElementById('todo-form').addEventListener('submit', (event) => {
        event.preventDefault();
        const input = document.getElementById('todo-input');
        const text = input.value.trim();
        if (!text) return;

        const li = document.createElement('li');
        li.textContent = text;
        document.getElementById('todo-list').appendChild(li);

        input.value = '';
      });
    </script>
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
