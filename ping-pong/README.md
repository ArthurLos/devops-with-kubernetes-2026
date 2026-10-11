# ping-pong

Responds to `GET /pingpong` with `pong <n>`. The counter lives in memory for speed, and as of exercise 2.7 is persisted to a **Postgres database** (`manifests/postgres.yaml` — a `StatefulSet` with one replica, `postgres-stset`, plus its headless `postgres-svc`), so it survives pod restarts — including Postgres' own restarts, since its data lives on a `PersistentVolumeClaim` dynamically provisioned per-replica via `volumeClaimTemplates` (k3d's built-in `local-path` storage class, no manual `PersistentVolume` needed). This replaced the old file-based `PersistentVolume` from exercise 2.1. As of exercise 2.1 the counter is no longer shared with `log_output` via a volume either — that app now reads the count over HTTP instead (`GET /pings`, plain text, same value as the last `pong` shown).

Shares an Ingress with the `log_output` application (see `../manifests/ingress.yaml` at the repo root, since it spans both apps): `/pingpong` routes here, `/status` goes to `log_output`.

Configuration is entirely via environment variables (no hardcoded ports/URLs in the source, consistent with exercise 2.6's project-wide rule):
- `PORT` (defaults to `3000`).
- `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` — read automatically by the `pg` client library; in the cluster these are set in `manifests/deployment.yaml` (`PGHOST`/`PGPORT` directly, the rest via `secretKeyRef` into `manifests/postgres-secret.yaml`'s `postgres-credentials` Secret, which Postgres itself also consumes via `envFrom`).

On startup the app retries connecting to Postgres (every 2s) until it succeeds, since the database StatefulSet might not be ready yet when this Pod starts — see the hint in exercise 2.7. It also registers a `pool.on('error', ...)` handler: without one, an unexpected connection drop (e.g. the Postgres pod restarting) crashes the whole Node process instead of just failing the in-flight query.

As of exercise 2.3, this app runs in the `exercises` namespace (see `../manifests/namespace-exercises.yaml`), together with `../log_output` — every exercise outside `the_project` lives there from now on.

## Local development

Requires a local Postgres (e.g. `docker run -e POSTGRES_USER=pingpong -e POSTGRES_PASSWORD=pingpong-local-dev -e POSTGRES_DB=pingpong -p 5432:5432 postgres:16`):

```bash
cp .env.sample .env
npm install
npm start
```

## Build and deploy

```bash
# build the image (bump the tag when the code changes)
docker build -t ping-pong:2.0.1 .

# get cluster name if you don't know it
k3d cluster list

# load it into your local cluster
k3d image import ping-pong:2.0.1 -c <cluster-name>

# the exercises namespace, Postgres credentials/StatefulSet/Service and shared Ingress must exist first (repo root for the namespace/Ingress)
kubectl apply -f ../manifests/namespace-exercises.yaml
kubectl apply -f manifests/postgres-secret.yaml
kubectl apply -f manifests/postgres.yaml
kubectl rollout status statefulset/postgres-stset -n exercises
kubectl apply -f ../manifests/ingress.yaml

# update the image tag in manifests/deployment.yaml to match, then apply
kubectl apply -f manifests/deployment.yaml
kubectl apply -f manifests/service.yaml

# confirm it's running
kubectl get pods -n exercises
kubectl logs -f <pod-name> -n exercises
```

## Access it locally

Exposed via `log_output`'s Ingress on path `/pingpong`. Reachable on whichever host port your cluster maps to the ingress controller's port 80 (e.g. `http://localhost:8081/pingpong`) — check your cluster's port mapping.

`/pings` is cluster-internal only (no Ingress route) — it's consumed by `log_output`'s reader via `http://ping-pong-svc:3000/pings`.

## Note on the database

`postgres-svc` is intentionally a **headless** Service (`clusterIP: None`) — the standard pattern for a `StatefulSet`, so each replica gets its own stable DNS name (e.g. `postgres-stset-0.postgres-svc`) instead of being load-balanced like a normal Service. With only one replica here it doesn't matter much yet, but it's what lets a real multi-replica setup (e.g. Postgres streaming replication) address a specific instance.

The `postgres-credentials` Secret (`manifests/postgres-secret.yaml`) holds a local-dev-only plaintext password — fine for this local k3d cluster, but not how you'd manage a real production secret (see the Chapter 3 "configuring applications" discussion on SOPS/Sealed Secrets for that).

```bash
# inspect the data directly
kubectl exec -n exercises postgres-stset-0 -- psql -U pingpong -d pingpong -c "SELECT * FROM counter;"

# confirm it survives Postgres' own pod restarting (not just ping-pong's)
kubectl delete pod -n exercises postgres-stset-0
curl http://localhost:8081/pingpong   # resumes from the last persisted value, doesn't reset to 0
```
