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
}

// As of exercise 3.4, the app responds on / instead of /pingpong — the cluster-level
// URL structure (whoever routes /pingpong here) is handled by a Gateway API URLRewrite
// filter instead of being reflected in the app itself. This also serves as GKE's
// Ingress/Gateway health check endpoint, which always GETs / regardless of routed path.
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
