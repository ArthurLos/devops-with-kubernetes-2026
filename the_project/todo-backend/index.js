require('dotenv').config();
const express = require('express');
const morgan = require('morgan');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const RETRY_DELAY_MS = 2000;
const MAX_TODO_LENGTH = 140;

const pool = new Pool();

// An idle client's connection can drop unexpectedly (e.g. Postgres pod restarts);
// without this handler, 'pg' turns that into an uncaught exception that kills the process.
pool.on('error', (err) => {
  console.error('Unexpected Postgres pool error:', err.message);
});

app.use(morgan('combined'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const SEED_TODOS = [
  'Learn Kubernetes basics',
  'Deploy application to cluster',
  'Configure persistent volumes',
];

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS todos (
      id SERIAL PRIMARY KEY,
      text VARCHAR(140) NOT NULL
    )
  `);

  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM todos');
  if (rows[0].count === 0) {
    for (const text of SEED_TODOS) {
      await pool.query('INSERT INTO todos (text) VALUES ($1)', [text]);
    }
  }
}

// GKE's Ingress health check always GETs / on the backend Service, regardless of
// which path it's actually routed under (here /todos) — it must return 200.
app.get('/', (req, res) => {
  res.sendStatus(200);
});

app.get('/todos', async (req, res) => {
  const { rows } = await pool.query('SELECT text FROM todos ORDER BY id');
  res.json(rows.map((row) => row.text));
});

app.post('/todos', async (req, res) => {
  const text = (req.body.text || '').trim();
  console.log(`Received todo (${text.length} characters): "${text}"`);

  if (text.length > MAX_TODO_LENGTH) {
    console.warn(`Rejected todo: exceeds the ${MAX_TODO_LENGTH} character limit`);
    const message = `Todo must be at most ${MAX_TODO_LENGTH} characters`;
    if (req.is('application/json')) {
      return res.status(400).json({ error: message });
    }
    return res.status(400).send(message);
  }

  if (text) {
    await pool.query('INSERT INTO todos (text) VALUES ($1)', [text]);
  }

  const { rows } = await pool.query('SELECT text FROM todos ORDER BY id');
  const todos = rows.map((row) => row.text);

  if (req.is('application/json')) {
    return res.status(201).json(todos);
  }
  res.redirect('/');
});

async function start() {
  // Postgres (the StatefulSet) might not be ready yet when this app starts, keep retrying.
  for (;;) {
    try {
      await ensureTable();
      break;
    } catch (err) {
      console.log(`Postgres not ready yet (${err.message}), retrying in ${RETRY_DELAY_MS}ms...`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }

  app.listen(PORT, () => {
    console.log(`Server started in port ${PORT}`);
  });
}

start();
