# ping-pong

Responds to `GET /pingpong` with `pong <n>`. The counter lives in memory for speed, and as of exercise 2.7 is persisted to a **Postgres database** (`manifests/postgres.yaml` — a `StatefulSet` with one replica, `postgres-stset`, plus its headless `postgres-svc`), so it survives pod restarts — including Postgres' own restarts, since its data lives on a `PersistentVolumeClaim` dynamically provisioned per-replica via `volumeClaimTemplates` (k3d's built-in `local-path` storage class, no manual `PersistentVolume` needed). This replaced the old file-based `PersistentVolume` from exercise 2.1. As of exercise 2.1 the counter is no longer shared with `log_output` via a volume either — that app now reads the count over HTTP instead (`GET /pings`, plain text, same value as the last `pong` shown).

Shares an Ingress with the `log_output` application (see `../manifests/ingress.yaml` at the repo root, since it spans both apps): `/pingpong` routes here, `/status` goes to `log_output`.

Configuration is entirely via environment variables (no hardcoded ports/URLs in the source, consistent with exercise 2.6's project-wide rule):
- `PORT` (defaults to `3000`).
- `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` — read automatically by the `pg` client library; in the cluster these are set in `manifests/deployment.yaml` (`PGHOST`/`PGPORT` directly, the rest via `secretKeyRef` into `manifests/postgres-secret.yaml`'s `postgres-credentials` Secret, which Postgres itself also consumes via `envFrom`).

On startup the app retries connecting to Postgres (every 2s) until it succeeds, since the database StatefulSet might not be ready yet when this Pod starts — see the hint in exercise 2.7. It also registers a `pool.on('error', ...)` handler: without one, an unexpected connection drop (e.g. the Postgres pod restarting) crashes the whole Node process instead of just failing the in-flight query.

As of exercise 3.2, the app also responds `200` on `GET /` — GKE's Ingress health-checks a backend Service at `/` regardless of which path it's actually routed under (`/pingpong` here), so without this the Ingress would never mark the backend healthy.

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
docker build -t ping-pong:2.1.0 .

# get cluster name if you don't know it
k3d cluster list

# load it into your local cluster
k3d image import ping-pong:2.1.0 -c <cluster-name>

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

## Exercise 3.1: deploying to GKE

`manifests/gke/` holds a GKE-specific variant of the Postgres StatefulSet, the Deployment, and the Service — the plain `manifests/*.yaml` files stay as-is for the local k3d cluster. Differences from the local manifests:
- `gke/postgres.yaml` — no `storageClassName` on the `PersistentVolumeClaim`: GKE automatically provisions a (default) Persistent Disk for an unset storage class, there's no `local-path`-equivalent to point to.
- `gke/deployment.yaml` — image comes from Google Artifact Registry (`europe-west4-docker.pkg.dev/<project>/dwk-repo/ping-pong:<tag>`) instead of a locally-imported image, since GKE nodes can't pull from k3d's local image store.
- `gke/service.yaml` — originally `type: LoadBalancer` on port 80 for this exercise (exercise 3.1 asks for one explicitly); changed to `NodePort` in exercise 3.2 below, since the app moved from a standalone LoadBalancer to being routed through an Ingress instead. The `3.1` git tag still has the original `LoadBalancer` version if you need to see exactly what that exercise looked like.

`manifests/postgres-secret.yaml` and the root `manifests/namespace-exercises.yaml` are reused as-is — nothing cluster-specific in either.

```bash
# one-time: create a GCP project, enable billing, then:
gcloud services enable container.googleapis.com artifactregistry.googleapis.com
gcloud artifacts repositories create dwk-repo --repository-format=docker --location=europe-west4

# create the cluster (costs credits/money while it exists — delete when done, see below)
gcloud container clusters create dwk-cluster --zone=europe-west4-a --cluster-version=1.36 --disk-size=32 --num-nodes=4 --machine-type=e2-small
gcloud container clusters get-credentials dwk-cluster --zone=europe-west4-a   # if kubectl isn't already pointed at it

# build and push the image (bump the tag/project/repo as needed)
docker build -t ping-pong:2.1.0 .
gcloud auth configure-docker europe-west4-docker.pkg.dev
docker tag ping-pong:2.1.0 europe-west4-docker.pkg.dev/<project-id>/dwk-repo/ping-pong:2.1.0
docker push europe-west4-docker.pkg.dev/<project-id>/dwk-repo/ping-pong:2.1.0

# deploy (namespace and Secret are the same files used locally)
kubectl apply -f ../manifests/namespace-exercises.yaml
kubectl apply -f manifests/postgres-secret.yaml
kubectl apply -f manifests/gke/postgres.yaml
kubectl rollout status statefulset/postgres-stset -n exercises
kubectl apply -f manifests/gke/deployment.yaml
kubectl apply -f manifests/gke/service.yaml

# delete the cluster when done to stop billing (declarative setup, so resuming later is just re-running the steps above)
gcloud container clusters delete dwk-cluster --zone=europe-west4-a
```

## Exercise 3.2: Ingress instead of a standalone LoadBalancer

`gke/service.yaml` is now `type: NodePort` instead of `LoadBalancer` — GKE's Ingress controller requires a NodePort backend Service (it doesn't expose the NodePort externally itself, the Ingress's load balancer does that). The shared root `../manifests/ingress.yaml` now routes `/pingpong` here, same as it does locally — see `../log_output/README.md`'s "Exercise 3.2" section for the full combined deploy flow (it's identical for both apps, just applied once for the shared Ingress).

```bash
kubectl apply -f manifests/gke/service.yaml   # after updating gke/deployment.yaml's image tag and re-applying it
kubectl apply -f ../manifests/ingress.yaml

# wait for the Ingress to get an address (can take a few minutes; 404/502 is normal while it provisions)
kubectl get ingress -n exercises --watch
curl http://<ingress-address>/pingpong
```
