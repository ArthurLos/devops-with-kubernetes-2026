require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const RETRY_DELAY_MS = 2000;

const pool = new Pool();

// An idle client's connection can drop unexpectedly (e.g. Postgres pod restarts);
// without this handler, 'pg' turns that into an uncaught exception that kills the process.
pool.on('error', (err) => {
  console.error('Unexpected Postgres pool error:', err.message);
});

let lastShown = 0;
let nextValue = 0;

// Set once the counter table has been created and its last value loaded — gates
// /healthz (exercise 4.1) alongside the plain connectivity check, so the readiness
// probe doesn't pass before startup has finished loading state from Postgres.
let dbInitialized = false;

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS counter (
      id INTEGER PRIMARY KEY,
      value INTEGER NOT NULL
    )
  `);

  const { rows } = await pool.query('SELECT value FROM counter WHERE id = 1');
  if (rows.length > 0) {
    lastShown = rows[0].value;
    nextValue = lastShown + 1;
  }
  dbInitialized = true;
}

// As of exercise 3.4, the app responds on / instead of /pingpong — the cluster-level
// URL structure (whoever routes /pingpong here) is handled by a Gateway API URLRewrite
// filter instead of being reflected in the app itself.
app.get('/', async (req, res) => {
  const value = nextValue;
  lastShown = value;
  nextValue++;

  res.send(`pong ${value}`);

  try {
    await pool.query(
      'INSERT INTO counter (id, value) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET value = $1',
      [value]
    );
  } catch (err) {
    console.error('Failed to persist counter to Postgres:', err.message);
  }
});

app.get('/pings', (req, res) => {
  res.send(String(lastShown));
});

// Exercise 4.1: ready once we have a working connection to Postgres. A cheap SELECT
// (not ensureTable(), which would be unsafe to call repeatedly — it reloads
// lastShown/nextValue from the DB, clobbering in-memory state between requests)
// run on every probe, so it also catches Postgres going away after startup.
app.get('/healthz', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    if (!dbInitialized) {
      throw new Error('counter table not initialized yet');
    }
    res.status(200).json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ status: 'unhealthy', error: err.message });
  }
});

// The server starts listening immediately — the readinessProbe (not a startup-blocking
// retry loop) is what gates traffic until Postgres is reachable, so the pod can be
// observed as Running-but-not-Ready instead of not starting at all.
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
