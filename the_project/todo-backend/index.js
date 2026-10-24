require('dotenv').config();
const express = require('express');
const morgan = require('morgan');
const { Pool } = require('pg');
const { connect, JSONCodec } = require('nats');

const app = express();
const PORT = process.env.PORT || 3000;
const RETRY_DELAY_MS = 2000;
const MAX_TODO_LENGTH = 140;
const NATS_URL = process.env.NATS_URL || 'nats://my-nats.nats.svc.cluster.local:4222';
const TODO_EVENTS_SUBJECT = 'todo_events';

const pool = new Pool();

// An idle client's connection can drop unexpectedly (e.g. Postgres pod restarts);
// without this handler, 'pg' turns that into an uncaught exception that kills the process.
pool.on('error', (err) => {
  console.error('Unexpected Postgres pool error:', err.message);
});

// Exercise 4.6: publishing is best-effort — todo CRUD must keep working even if NATS
// (or ../broadcaster) is down, so a missing connection just skips the publish instead
// of failing the request.
const jc = JSONCodec();
let natsConnection = null;

(async () => {
  for (;;) {
    try {
      natsConnection = await connect({ servers: NATS_URL });
      break;
    } catch (err) {
      console.log(`NATS not reachable yet (${err.message}), retrying in ${RETRY_DELAY_MS}ms...`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
  console.log(`Connected to NATS at ${NATS_URL}`);
})();

function publishTodoEvent(type, todo) {
  if (!natsConnection) {
    console.warn(`NATS not connected, skipping ${type} event for todo ${todo.id}`);
    return;
  }
  natsConnection.publish(TODO_EVENTS_SUBJECT, jc.encode({ type, ...todo }));
}

app.use(morgan('combined'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const SEED_TODOS = [
  'Learn Kubernetes basics',
  'Deploy application to cluster',
  'Configure persistent volumes',
];

// Set once the todos table has been created/seeded — gates /healthz (exercise 4.2)
// alongside the plain connectivity check, so readiness doesn't pass before startup
// has finished.
let dbInitialized = false;

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS todos (
      id SERIAL PRIMARY KEY,
      text VARCHAR(140) NOT NULL,
      done BOOLEAN NOT NULL DEFAULT false
    )
  `);
  // Exercise 4.5: CREATE TABLE IF NOT EXISTS doesn't touch an already-existing table,
  // so this covers clusters that still have the pre-4.5 schema.
  await pool.query('ALTER TABLE todos ADD COLUMN IF NOT EXISTS done BOOLEAN NOT NULL DEFAULT false');

  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM todos');
  if (rows[0].count === 0) {
    for (const text of SEED_TODOS) {
      await pool.query('INSERT INTO todos (text) VALUES ($1)', [text]);
    }
  }
  dbInitialized = true;
}

// GKE's Ingress health check always GETs / on the backend Service, regardless of
// which path it's actually routed under (here /todos) — it must return 200.
app.get('/', (req, res) => {
  res.sendStatus(200);
});

// Exercise 4.2: ready once we have a working connection to Postgres — same pattern
// as ping-pong's /healthz (exercise 4.1). A cheap SELECT run on every probe, rather
// than re-running ensureTable() each time.
app.get('/healthz', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    if (!dbInitialized) {
      throw new Error('todos table not initialized yet');
    }
    res.status(200).json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ status: 'unhealthy', error: err.message });
  }
});

app.get('/todos', async (req, res) => {
  const { rows } = await pool.query('SELECT id, text, done FROM todos ORDER BY id');
  res.json(rows);
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
    const { rows: inserted } = await pool.query(
      'INSERT INTO todos (text) VALUES ($1) RETURNING id, text, done',
      [text]
    );
    publishTodoEvent('created', inserted[0]);
  }

  const { rows } = await pool.query('SELECT id, text, done FROM todos ORDER BY id');

  if (req.is('application/json')) {
    return res.status(201).json(rows);
  }
  res.redirect('/');
});

// Exercise 4.5: mark a todo done (or not), e.g. the "Mark done" button in todo-app.
app.put('/todos/:id', async (req, res) => {
  const id = Number(req.params.id);
  const done = typeof req.body.done === 'boolean' ? req.body.done : true;

  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'id must be an integer' });
  }

  const { rows: updated } = await pool.query(
    'UPDATE todos SET done = $1 WHERE id = $2 RETURNING id, text, done',
    [done, id]
  );
  if (updated.length === 0) {
    return res.status(404).json({ error: `No todo with id ${id}` });
  }
  publishTodoEvent('updated', updated[0]);

  const { rows } = await pool.query('SELECT id, text, done FROM todos ORDER BY id');
  res.status(200).json(rows);
});

// The server starts listening immediately — the readinessProbe (not a startup-blocking
// retry loop) is what gates traffic until Postgres is reachable (exercise 4.2, same
// reasoning as ping-pong's exercise 4.1).
(async () => {
  for (;;) {
    try {
      await ensureTable();
      break;
    } catch (err) {
      console.log(`Postgres not ready yet (${err.message}), retrying in ${RETRY_DELAY_MS}ms...`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
})();

app.listen(PORT, () => {
  console.log(`Server started in port ${PORT}`);
});
