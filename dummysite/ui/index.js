require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const k8s = require('@kubernetes/client-node');

const PORT = process.env.PORT || 3000;
const NAMESPACE = process.env.NAMESPACE || 'exercises';
// The Gateway (../manifests/gateway.yaml) rewrites /dummysite/* to /* before it
// reaches this app, so incoming *request* paths never need this - but a redirect's
// Location header and the form's action go straight to the browser unrewritten, so
// anything this app itself emits has to be prefixed with it explicitly.
const BASE_PATH = process.env.BASE_PATH || '';
const GROUP = 'stable.dwk';
const VERSION = 'v1';
const PLURAL = 'dummysites';

const kc = new k8s.KubeConfig();
if (process.env.KUBERNETES_SERVICE_HOST) {
  kc.loadFromCluster();
} else {
  kc.loadFromDefault();
}
const customApi = kc.makeApiClient(k8s.CustomObjectsApi);

const app = express();
app.use(express.urlencoded({ extended: true }));

app.get('/healthz', (req, res) => res.status(200).json({ status: 'ok' }));

app.get('/', (req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>DummySite</title>
</head>
<body>
  <h1>Create a DummySite</h1>
  <p>Creates a <code>DummySite</code> custom resource and, once the controller has
  reconciled it, opens the served copy in a new tab.</p>
  <form method="POST" action="${BASE_PATH}/create" target="_blank">
    <input name="url" type="url" placeholder="https://example.com/" size="50" required>
    <button type="submit">Create &amp; open</button>
  </form>
</body>
</html>`);
});

// A short, DNS-label-safe, collision-resistant name - also used as-is for the
// ../controller's ConfigMap/Deployment/Service names, see its README.
function randomSiteName() {
  return `site-${crypto.randomBytes(4).toString('hex')}`;
}

app.post('/create', async (req, res) => {
  const websiteUrl = req.body.url;
  if (!websiteUrl) {
    return res.status(400).send('Missing "url"');
  }

  const name = randomSiteName();

  try {
    await customApi.createNamespacedCustomObject({
      group: GROUP,
      version: VERSION,
      namespace: NAMESPACE,
      plural: PLURAL,
      body: {
        apiVersion: `${GROUP}/${VERSION}`,
        kind: 'DummySite',
        metadata: { name },
        spec: { website_url: websiteUrl },
      },
    });
  } catch (err) {
    console.error(`Failed to create DummySite ${name}:`, err.message);
    return res.status(502).send(`Failed to create DummySite: ${err.message}`);
  }

  console.log(`Created DummySite ${NAMESPACE}/${name} -> ${websiteUrl}`);
  // Trailing slash matters: the copied page's own relative links (e.g. "style.css")
  // resolve against this path, so they need to land back under .../sites/<name>/.
  res.redirect(`${BASE_PATH}/sites/${name}/`);
});

function waitingPageHtml(name) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="2">
  <title>Creating ${name}...</title>
</head>
<body>
  <p>Still fetching the page and standing up "${name}" — this reloads automatically every 2s.</p>
</body>
</html>`;
}

// Reverse proxy to <name>-svc, the Service the ../controller creates for this
// DummySite. The controller's own reconcile (fetch + ConfigMap + Deployment +
// Service) takes a moment, so the Service may not exist/resolve yet when the new
// tab first opens. One attempt per request, not a server-side retry loop: a retry
// loop blocks a single browser request behind the scenes, so the wait page would
// only ever be seen after it gives up entirely. Failing once here instead shows the
// wait page immediately, and its own <meta refresh> is what makes the *browser*
// retry (as a real, visible page load) every 2s until the Service answers.
app.use('/sites/:name', async (req, res) => {
  const { name } = req.params;
  const target = `http://${name}-svc.${NAMESPACE}.svc.cluster.local`;
  const subPath = req.url === '/' ? '' : req.url;

  let upstream;
  try {
    upstream = await fetch(`${target}${subPath}`);
  } catch (err) {
    return res.status(503).type('html').send(waitingPageHtml(name));
  }

  const contentType = upstream.headers.get('content-type');
  if (contentType) res.set('content-type', contentType);
  res.status(upstream.status).send(Buffer.from(await upstream.arrayBuffer()));
});

app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
