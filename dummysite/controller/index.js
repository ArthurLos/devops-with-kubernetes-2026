require('dotenv').config();
const express = require('express');
const k8s = require('@kubernetes/client-node');

const PORT = process.env.PORT || 3000;
const GROUP = 'stable.dwk';
const VERSION = 'v1';
const PLURAL = 'dummysites';
const WATCH_PATH = `/apis/${GROUP}/${VERSION}/${PLURAL}`;

const kc = new k8s.KubeConfig();
if (process.env.KUBERNETES_SERVICE_HOST) {
  kc.loadFromCluster();
} else {
  kc.loadFromDefault();
}

const coreApi = kc.makeApiClient(k8s.CoreV1Api);
const appsApi = kc.makeApiClient(k8s.AppsV1Api);
const customApi = kc.makeApiClient(k8s.CustomObjectsApi);

let ready = false;

// Resources are named after the DummySite itself, and every one of them carries an
// ownerReference back to it — deleting the DummySite then lets Kubernetes' own
// garbage collector clean up the ConfigMap/Deployment/Service for us, no explicit
// DELETE-event handling needed in this controller at all.
function ownerReferenceFor(dummySite) {
  return {
    apiVersion: `${GROUP}/${VERSION}`,
    kind: 'DummySite',
    name: dummySite.metadata.name,
    uid: dummySite.metadata.uid,
    controller: true,
    blockOwnerDeletion: true,
  };
}

// Any of these throw an ApiException with .code === 409 if the resource (from a
// previous reconcile, e.g. after a controller restart) already exists — safe to
// ignore, the controller doesn't need to update an existing copy for this exercise.
async function ignoreConflict(promise) {
  try {
    await promise;
  } catch (err) {
    if (err.code !== 409) throw err;
  }
}

async function fetchSiteHtml(websiteUrl) {
  const res = await fetch(websiteUrl);
  if (!res.ok) {
    throw new Error(`${websiteUrl} responded ${res.status}`);
  }
  return res.text();
}

async function reconcile(dummySite) {
  const { name, namespace } = dummySite.metadata;
  const websiteUrl = dummySite.spec && dummySite.spec.website_url;

  if (!websiteUrl) {
    console.warn(`DummySite ${namespace}/${name} has no spec.website_url, skipping`);
    return;
  }

  console.log(`Reconciling DummySite ${namespace}/${name} -> ${websiteUrl}`);

  let html;
  try {
    html = await fetchSiteHtml(websiteUrl);
  } catch (err) {
    console.error(`Failed to fetch ${websiteUrl} for ${namespace}/${name}: ${err.message}`);
    return;
  }

  const ownerReferences = [ownerReferenceFor(dummySite)];
  const labels = { 'dummysite.stable.dwk/owner': name };

  await ignoreConflict(
    coreApi.createNamespacedConfigMap({
      namespace,
      body: {
        metadata: { name: `${name}-html`, namespace, ownerReferences, labels },
        data: { 'index.html': html },
      },
    })
  );

  await ignoreConflict(
    appsApi.createNamespacedDeployment({
      namespace,
      body: {
        metadata: { name: `${name}-dep`, namespace, ownerReferences, labels },
        spec: {
          replicas: 1,
          selector: { matchLabels: { app: `dummysite-${name}` } },
          template: {
            metadata: { labels: { app: `dummysite-${name}` } },
            spec: {
              containers: [
                {
                  name: 'site',
                  image: 'nginx:alpine',
                  ports: [{ containerPort: 80 }],
                  volumeMounts: [{ name: 'html', mountPath: '/usr/share/nginx/html' }],
                },
              ],
              volumes: [{ name: 'html', configMap: { name: `${name}-html` } }],
            },
          },
        },
      },
    })
  );

  await ignoreConflict(
    coreApi.createNamespacedService({
      namespace,
      body: {
        metadata: { name: `${name}-svc`, namespace, ownerReferences, labels },
        spec: {
          selector: { app: `dummysite-${name}` },
          ports: [{ port: 80, targetPort: 80 }],
        },
      },
    })
  );

  console.log(`DummySite ${namespace}/${name} ready: Service ${name}-svc serves the copy`);
}

const RETRY_DELAY_MS = 2000;

async function watchDummySites() {
  const watch = new k8s.Watch(kc);
  try {
    await watch.watch(
      WATCH_PATH,
      {},
      (phase, obj) => {
        if (phase === 'ADDED') {
          reconcile(obj).catch((err) => console.error('Reconcile failed:', err.message));
        }
      },
      (err) => {
        if (err) console.error('Watch ended with error:', err.message);
        console.log(`Restarting watch in ${RETRY_DELAY_MS}ms...`);
        setTimeout(watchDummySites, RETRY_DELAY_MS);
      }
    );
    console.log(`Watching ${WATCH_PATH} for new DummySite objects`);
    ready = true;
  } catch (err) {
    console.error(`Failed to start watch (${err.message}), retrying in ${RETRY_DELAY_MS}ms...`);
    setTimeout(watchDummySites, RETRY_DELAY_MS);
  }
}

// Reconcile whatever DummySites already existed before this controller (re)started -
// the watch alone only reports ADDED for objects created *after* it connects.
async function reconcileExisting() {
  try {
    const list = await customApi.listClusterCustomObject({ group: GROUP, version: VERSION, plural: PLURAL });
    for (const item of list.items || []) {
      await reconcile(item);
    }
  } catch (err) {
    console.error('Failed to list existing DummySites:', err.message);
  }
}

(async () => {
  await reconcileExisting();
  await watchDummySites();
})();

const app = express();
app.get('/healthz', (req, res) => {
  res.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'starting' });
});
app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
