# todo-backend

Backend microservice for the course project's todo functionality. As of exercise 2.8, todos are persisted in a **Postgres database** (`manifests/postgres.yaml` — a `StatefulSet` with one replica, `postgres-stset`, plus its headless `postgres-svc`), so they survive pod restarts — including Postgres' own restarts, since its data lives on a `PersistentVolumeClaim` dynamically provisioned via `volumeClaimTemplates` (k3d's built-in `local-path` storage class, no manual `PersistentVolume` needed). On first start the table is seeded with the same three example todos the old in-memory version shipped with.

- `GET /todos` — returns the current list as JSON.
- `POST /todos` — adds a new todo (`text` field, trimmed). As of exercise 2.10, a todo over 140 characters is **rejected** with `400` (not silently truncated) — `application/json` requests get `{"error": "..."}` back, anything else gets a plain-text body with the same message. Otherwise, content-type decides the success response: `application/json` requests get the updated list back (`201`), anything else (e.g. a plain HTML form submission) gets redirected to `/` so the browser lands back on `../todo-app`'s page with the updated list.

As of exercise 2.10, every request is logged (`morgan`'s `combined` format) and every submitted todo is logged explicitly with its length (`Received todo (<n> characters): "..."`), with a separate `Rejected todo: exceeds the 140 character limit` line when the length check fails — all picked up by the `../../monitoring` Loki/Alloy stack, so rejected submissions are visible with a query like `{namespace="project"} |= "Rejected"` in Grafana.

Configuration is entirely via environment variables (no hardcoded ports/URLs in the source, consistent with exercise 2.6's project-wide rule):
- `PORT` (defaults to `3000`).
- `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` — read automatically by the `pg` client library; in the cluster these are set in `manifests/deployment.yaml` (`PGHOST`/`PGPORT` directly, the rest via `secretKeyRef` into `manifests/postgres-secret.yaml`'s `postgres-credentials` Secret, which Postgres itself also consumes via `envFrom`).

On startup the app retries connecting to Postgres (every 2s) until it succeeds, since the database StatefulSet might not be ready yet when this Pod starts. It also registers a `pool.on('error', ...)` handler: without one, an unexpected connection drop (e.g. the Postgres pod restarting) crashes the whole Node process instead of just failing the in-flight query.

As of exercise 2.4, this app runs in its own `project` namespace (see `../../manifests/namespace-project.yaml`), together with `../todo-app` — kept separate from the `exercises` namespace used by the standalone course exercises.

## Local development

Requires a local Postgres (e.g. `docker run -e POSTGRES_USER=todobackend -e POSTGRES_PASSWORD=todobackend-local-dev -e POSTGRES_DB=tododb -p 5432:5432 postgres:16`):

```bash
cp .env.sample .env
npm install
npm start
```

## Build and deploy

```bash
# build the image (bump the tag when the code changes)
docker build -t todo-backend:2.1.0 .

# get cluster name if you don't know it
k3d cluster list

# load it into your local cluster
k3d image import todo-backend:2.1.0 -c <cluster-name>

# the project namespace, Postgres credentials/StatefulSet/Service must exist first (repo root for the namespace)
kubectl apply -f ../../manifests/namespace-project.yaml
kubectl apply -f manifests/postgres-secret.yaml
kubectl apply -f manifests/postgres.yaml
kubectl rollout status statefulset/postgres-stset -n project

# update the image tag in manifests/deployment.yaml to match, then apply
kubectl apply -f manifests/deployment.yaml
kubectl apply -f manifests/service.yaml

# confirm it's running
kubectl get pods -n project
kubectl logs -f <pod-name> -n project
```

## Access it locally

- `GET /todos` is exposed externally via `../todo-app`'s shared Ingress (`../todo-app/manifests/ingress.yaml`, path `/todos`), e.g. `http://localhost:8081/todos` — check your cluster's port mapping.
- Cluster-internal address: `http://todo-backend-svc:2345/todos`.

## Testing

```bash
# list todos
curl http://localhost:8081/todos

# add one via a plain form submission (redirects to /)
curl -i -X POST -d "text=Write the Kubernetes submission" http://localhost:8081/todos

# add one via JSON (returns the updated list)
curl -i -X POST -H "Content-Type: application/json" -d '{"text":"Test via JSON"}' http://localhost:8081/todos

# a todo over 140 characters is rejected with 400
curl -i -X POST -H "Content-Type: application/json" -d "{\"text\":\"$(printf 'x%.0s' {1..150})\"}" http://localhost:8081/todos
```

## Note on the database

`postgres-svc` is intentionally a **headless** Service (`clusterIP: None`) — the standard pattern for a `StatefulSet`, so each replica gets its own stable DNS name (e.g. `postgres-stset-0.postgres-svc`) instead of being load-balanced like a normal Service. With only one replica here it doesn't matter much yet, but it's what lets a real multi-replica setup address a specific instance.

The `postgres-credentials` Secret (`manifests/postgres-secret.yaml`) holds a local-dev-only plaintext password — fine for this local k3d cluster, but not how you'd manage a real production secret (see the Chapter 3 "configuring applications" discussion on SOPS/Sealed Secrets for that). This is a separate Postgres instance from the one in `../../ping-pong/manifests/postgres.yaml` — different namespace (`project` vs `exercises`), different data.

```bash
# inspect the data directly
kubectl exec -n project postgres-stset-0 -- psql -U todobackend -d tododb -c "SELECT * FROM todos;"

# confirm it survives Postgres' own pod restarting (not just todo-backend's)
kubectl delete pod -n project postgres-stset-0
curl http://localhost:8081/todos   # list is still there, not reset to the seed data
```
