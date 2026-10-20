# todo-app

Web server for the course project — a server-side rendered (SSR) app, not a SPA. `GET /` renders a page showing a random picture from [Lorem Picsum](https://picsum.photos), the current todos (fetched server-side from `../todo-backend`), and a form for adding new ones (max 140 characters). The form POSTs directly to `/todos`, which the shared `Gateway`/`HTTPRoute` (`../manifests/gateway.yaml`) routes to `todo-backend`, not to this app — `todo-backend` redirects back to `/` afterwards so the browser sees the updated list.

The picture is cached on a `PersistentVolume` (`../../manifests/todo-app-persistentvolume.yaml` + `todo-app-persistentvolumeclaim.yaml`) for 10 minutes — `GET /image` serves the cached file and only fetches a new one from Picsum once it's older than that (or missing). This means the picture survives pod restarts without hitting the external API again, and only refreshes lazily on the next request after the cache expires, not on a background timer.

As of exercise 2.6, every piece of configuration is an environment variable (no hardcoded ports, URLs, or durations in the source) — the fallback values below only kick in for local development (via `.env`/`dotenv`); in the cluster they're all set explicitly by `manifests/configmap.yaml` (`todo-app-config`) and `manifests/deployment.yaml`:

- `PORT` (defaults to `3000`) — set directly in the Deployment, since it's container wiring rather than app config.
- `IMAGE_DIR` (defaults to `/usr/src/app/images`) — where the cached picture + its fetch timestamp live.
- `TODO_BACKEND_URL` (defaults to `http://todo-backend-svc:2345/todos`) — where todos are fetched from.
- `PICSUM_URL` (defaults to `https://picsum.photos/1200`) — the external image source.
- `CACHE_DURATION_MS` (defaults to `600000`, i.e. 10 minutes) — how long the cached picture stays valid.

As of exercise 2.4, this app runs in its own `project` namespace (see `../../manifests/namespace-project.yaml`), together with `../todo-backend` — kept separate from the `exercises` namespace used by the standalone course exercises.

## Local development

```bash
cp .env.sample .env
npm install
npm start
```

## Build and deploy

```bash
# build the image (bump the tag when the code changes)
docker build -t todo-app:1.5.0 .

# get cluster name if you don't know it
k3d cluster list

# load it into your local cluster
k3d image import todo-app:1.5.0 -c <cluster-name>

# the project namespace, ConfigMap and PersistentVolume/Claim must exist first (repo root, admin-managed resources),
# and ../todo-backend must be deployed too (this app fetches/posts todos from it)
kubectl apply -f ../../manifests/namespace-project.yaml
kubectl apply -f manifests/configmap.yaml
kubectl apply -f ../../manifests/todo-app-persistentvolume.yaml
kubectl apply -f ../../manifests/todo-app-persistentvolumeclaim.yaml

# update the image tag in manifests/deployment.yaml to match, then apply
kubectl apply -f manifests/deployment.yaml
kubectl apply -f manifests/service.yaml
kubectl apply -f ../manifests/gateway.yaml
kubectl rollout status deployment/todo-app -n project

# confirm it's running
kubectl get pods -n project
kubectl logs -f <pod-name> -n project
```

## Access it locally

As of chapter 5, exposed via the shared `Gateway`/`HTTPRoute` (`../manifests/gateway.yaml`, Envoy Gateway — the cluster's Traefik ingress controller is disabled as of this chapter, so the old `manifests/ingress.yaml` is no longer used locally). Service is still plain `ClusterIP`. Reachable on whichever host port your cluster maps to the load balancer's port 80 (e.g. a k3d cluster created with `-p "8081:80@loadbalancer"` maps it to `http://localhost:8081`) — check your cluster's port mapping.

## Troubleshooting: PVC stuck Pending

If the cluster (or just the PVC) was deleted and recreated, the local `PersistentVolume` may stay `Pending` forever — once a `hostPath` PV is released, Kubernetes won't automatically rebind it to a new claim. Fix: delete and reapply the PV itself (not just the PVC):

```bash
kubectl delete pv todo-app-pv
kubectl apply -f ../../manifests/todo-app-persistentvolume.yaml
kubectl apply -f ../../manifests/todo-app-persistentvolumeclaim.yaml
```

(The PV itself has no namespace — it's a cluster-scoped resource — only the PVC does.)

## Testing the image cache

```bash
# same picture on repeated requests
curl -s -o a.jpg http://localhost:8081/image
curl -s -o b.jpg http://localhost:8081/image
cmp a.jpg b.jpg   # identical -> cache works

# simulate a crash/restart and confirm the picture survives
kubectl delete pod -n project -l app=todo-app
curl -s -o c.jpg http://localhost:8081/image
cmp a.jpg c.jpg   # still identical -> cached on the PersistentVolume, not refetched
```
