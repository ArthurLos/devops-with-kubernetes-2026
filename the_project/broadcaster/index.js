require('dotenv').config();
const express = require('express');
const { connect, JSONCodec } = require('nats');

const app = express();
const PORT = process.env.PORT || 3000;
const NATS_URL = process.env.NATS_URL || 'nats://my-nats.nats.svc.cluster.local:4222';
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const SUBJECT = 'todo_events';
// All replicas subscribe under the same queue group name, so NATS hands each
// published message to exactly one of them — this is what lets the broadcaster be
// scaled to many replicas without the same event being forwarded more than once
// (exercise 4.6's "a duplicate is an issue, a randomly missing message isn't").
const QUEUE_GROUP = 'broadcaster';

const jc = JSONCodec();
let natsConnection = null;

app.get('/healthz', (req, res) => {
  if (natsConnection && !natsConnection.isClosed()) {
    return res.status(200).json({ status: 'ok' });
  }
  res.status(500).json({ status: 'unhealthy' });
});

function describe(event) {
  if (event.type === 'created') {
    return `A todo was created: "${event.text}"`;
  }
  return `A todo was updated: "${event.text}" (done: ${event.done})`;
}

async function forwardToWebhook(event) {
  if (!WEBHOOK_URL) {
    console.warn('WEBHOOK_URL not set, dropping event:', event);
    return;
  }

  const message = describe(event);
  try {
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: 'bot', message }),
    });
    console.log(`Forwarded to webhook (status ${response.status}): ${message}`);
  } catch (err) {
    console.error('Failed to forward to webhook:', err.message);
  }
}

const RETRY_DELAY_MS = 2000;

// Same reasoning as todo-backend/todo-app: the HTTP server (healthz) starts
// immediately, NATS connects in the background with its own retry loop, so a
// readinessProbe (not a startup-blocking wait) gates traffic.
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

  const sub = natsConnection.subscribe(SUBJECT, { queue: QUEUE_GROUP });
  console.log(`Subscribed to "${SUBJECT}" in queue group "${QUEUE_GROUP}"`);

  for await (const msg of sub) {
    try {
      const event = jc.decode(msg.data);
      console.log('Received todo event:', event);
      await forwardToWebhook(event);
    } catch (err) {
      console.error('Failed to process message:', err.message);
    }
  }
})();

app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
