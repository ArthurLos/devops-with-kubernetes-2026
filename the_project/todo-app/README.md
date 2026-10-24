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

**As of exercise 4.10**, this section's old `kubectl apply -f manifests/...` steps no longer apply — this app's manifests moved to [ArthurLos/the-project-config](https://github.com/ArthurLos/the-project-config) (see `../README.md`'s "Exercise 4.10"). Deployment is now via ArgoCD; this section only still covers building and locally importing the image:

```bash
# build the image (bump the tag when the code changes)
docker build -t todo-app:1.7.0 .

# get cluster name if you don't know it
k3d cluster list

# load it into your local cluster
k3d image import todo-app:1.7.0 -c <cluster-name>

# bump the image tag in the-project-config's todo-app/manifests/deployment.yaml
# to match, commit and push - ArgoCD picks it up automatically (staging on push to
# main, production on a v* tag - see the-project-config's README)

# confirm it's running
kubectl get pods -n staging    # or -n production
kubectl logs -f <pod-name> -n staging
```

## Access it locally

As of chapter 5, exposed via the shared `Gateway`/`HTTPRoute` (Envoy Gateway — the cluster's Traefik ingress controller is disabled as of this chapter, so the old `manifests/ingress.yaml` is no longer used locally; as of exercise 4.10 that `HTTPRoute` is `production-route` in [the-project-config](https://github.com/ArthurLos/the-project-config)'s `overlays/production/gateway.yaml`). Service is still plain `ClusterIP`. Reachable on whichever host port your cluster maps to the load balancer's port 80 (e.g. a k3d cluster created with `-p "8081:80@loadbalancer"` maps it to `http://localhost:8081`) — check your cluster's port mapping.

## Troubleshooting: PVC stuck Pending

If the cluster (or just the PVC) was deleted and recreated, the local `PersistentVolume` may stay `Pending` forever — once a `hostPath` PV is released, Kubernetes won't automatically rebind it to a new claim. Fix: delete and reapply the PV itself (not just the PVC):

```bash
kubectl delete pv todo-app-pv
kubectl apply -f ../../manifests/todo-app-persistentvolume.yaml
kubectl apply -f ../../manifests/todo-app-persistentvolumeclaim.yaml
```

(The PV itself has no namespace — it's a cluster-scoped resource — only the PVC does.)

## Exercise 4.2: probes, and a button to break the app

Two separate endpoints, two separate concerns:
- **`GET /ready`** (readiness) — checks this app can actually reach `../todo-backend`. Cascades naturally from `todo-backend`'s own readiness (which checks its Postgres connection, same pattern as `../../ping-pong`'s exercise 4.1): while `todo-backend` is `0/1`, `todo-backend-svc` has no endpoints, so `/ready` fails here too — no explicit dependency wiring needed.
- **`GET /healthz`** (liveness) — a plain `isHealthy` boolean, toggled by the **"break the app" button** on the page (`POST /break`). Deliberately *not* the same check as `/ready`: a livenessProbe that depends on another service is an anti-pattern (restarting this pod can't fix `todo-backend` being down), so it only reflects this app's own, self-contained state.

Pressing the button sets `isHealthy = false`; `GET /` then renders a "System Failure" page (`503`) instead of the normal one, and `/healthz` starts failing. The `livenessProbe` in `manifests/deployment.yaml` picks that up after a few failed checks and restarts the container — since `isHealthy` is just in-memory state, the fresh process starts back at `true`, so the app is healthy again with no manual intervention.

Tested: broke the app (`curl -X POST .../break`), confirmed `GET /` returned `503` with the failure page, watched `kubectl get pods -n project -l app=todo-app` until `RESTARTS` incremented (the events showed `Liveness probe failed ... will be restarted`), then confirmed `GET /` was back to `200` with the normal page straight after.

Separately tested the readiness/database requirement the same way as `../../ping-pong`'s exercise 4.1: scaled `postgres-stset` to 0 replicas, deleted and re-applied both `todo-backend` and `todo-app`'s Deployments, confirmed both came up `0/1`, then scaled Postgres back to 1 replica and watched both flip to `1/1` automatically within seconds.

The failure page also sets `<meta http-equiv="refresh" content="5">`, so a visitor who's left the page open sees it recover on its own, without manually reloading, once the pod is healthy again.

**Known, expected glitch:** with only one replica and no connection draining around a liveness-triggered restart (unlike a rolling update, Kubernetes just kills the container), a request that happens to land in the exact instant the old container is killed can get Envoy's own `upstream connect error or disconnect/reset before headers` page for that one request, instead of this app's `503` page. This only affects whichever single request (or auto-refresh) hits that split-second window — traffic is back to normal (either the failure page or the recovered app) immediately after. Not something exercise 4.2 asks to eliminate, and not worth adding complexity for on a single-replica app.

## Exercise 4.5: mark a todo done

Each todo from `../todo-backend` is now `{id, text, done}` instead of a bare string (see that README's exercise 4.5 section). A not-done todo renders with a **"Mark done"** button; a done one renders with its text struck through and a green "Done" label instead.

The button can't be a plain HTML form, since forms only support `GET`/`POST` and the exercise specifically asks for a `PUT` request — so clicking it runs a small inline script (`markDone(id)`) that does `fetch('/todos/<id>', { method: 'PUT', body: '{"done":true}' })` and reloads the page. That `fetch` goes straight to `../todo-backend`, same as the existing "add a todo" form's `POST /todos` already does — the Gateway (`../manifests/gateway.yaml`) routes the `/todos` path prefix directly to `todo-backend-svc`, bypassing this app entirely, so no new backend-proxying code was needed here.

```bash
# confirm it end-to-end without a browser
curl -s http://localhost:8081/todos                                    # pick an id, still "done":false
curl -s -X PUT -H "Content-Type: application/json" -d '{"done":true}' http://localhost:8081/todos/<id>
curl -s http://localhost:8081/ | grep -A1 'done-label'                 # that todo now renders struck-through with "Done"
```

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
