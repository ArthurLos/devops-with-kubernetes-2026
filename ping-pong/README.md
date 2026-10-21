# ping-pong

Responds to `GET /` with `pong <n>` (moved from `/pingpong` in exercise 3.4, see below). The counter lives in memory for speed, and as of exercise 2.7 is persisted to a **Postgres database** (`manifests/postgres.yaml` — a `StatefulSet` with one replica, `postgres-stset`, plus its headless `postgres-svc`), so it survives pod restarts — including Postgres' own restarts, since its data lives on a `PersistentVolumeClaim` dynamically provisioned per-replica via `volumeClaimTemplates` (k3d's built-in `local-path` storage class, no manual `PersistentVolume` needed). This replaced the old file-based `PersistentVolume` from exercise 2.1. As of exercise 2.1 the counter is no longer shared with `log_output` via a volume either — that app now reads the count over HTTP instead (`GET /pings`, plain text, same value as the last `pong` shown).

As of chapter 5 ("Continuing the course with k3d"), the local k3d cluster runs with Traefik disabled and [Envoy Gateway](https://gateway.envoyproxy.io/) installed instead, so this app is reachable the same way it is on GKE: via a shared `Gateway`/`HTTPRoute` (`../manifests/gateway.yaml`, `gatewayClassName: eg`) with `log_output`, including the same `URLRewrite` filter that rewrites `/pingpong` → `/` (needed since exercise 3.4 moved the app's real route to `/`). The old root `../manifests/ingress.yaml` (Traefik-based) is no longer used locally — kept only for historical reference/the exercise 3.1–3.2 git tags.

Configuration is entirely via environment variables (no hardcoded ports/URLs in the source, consistent with exercise 2.6's project-wide rule):
- `PORT` (defaults to `3000`).
- `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` — read automatically by the `pg` client library; in the cluster these are set in `manifests/deployment.yaml` (`PGHOST`/`PGPORT` directly, the rest via `secretKeyRef` into `manifests/postgres-secret.yaml`'s `postgres-credentials` Secret, which Postgres itself also consumes via `envFrom`).

On startup the app retries connecting to Postgres (every 2s) in the background until it succeeds, since the database StatefulSet might not be ready yet when this Pod starts — see the hint in exercise 2.7. As of exercise 4.1, this retry loop no longer blocks `app.listen()`: the server starts immediately (the Pod shows `Running`), and a `readinessProbe` (`GET /healthz`, checks Postgres connectivity on every call) is what actually gates traffic until the database is reachable — so the Pod is correctly observable as `0/1` Ready, not simply absent, while Postgres is unavailable. It also registers a `pool.on('error', ...)` handler: without one, an unexpected connection drop (e.g. the Postgres pod restarting) crashes the whole Node process instead of just failing the in-flight query.

As of exercise 3.2, the app also needed to respond `200` on `GET /` for GKE's Ingress health check (which always checks `/`, regardless of which path it's actually routed under). As of exercise 3.4, `/` *is* the real `pingpong` endpoint (see below), so that requirement is satisfied automatically — no separate stub route needed anymore.

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
docker build -t ping-pong:2.3.0 .

# get cluster name if you don't know it
k3d cluster list

# load it into your local cluster
k3d image import ping-pong:2.3.0 -c <cluster-name>

# the exercises namespace, Postgres credentials/StatefulSet/Service and shared Gateway must exist first (repo root for the namespace/Gateway)
kubectl apply -f ../manifests/namespace-exercises.yaml
kubectl apply -f manifests/postgres-secret.yaml
kubectl apply -f manifests/postgres.yaml
kubectl rollout status statefulset/postgres-stset -n exercises
kubectl apply -f ../manifests/gateway.yaml

# update the image tag in manifests/deployment.yaml to match, then apply
kubectl apply -f manifests/deployment.yaml
kubectl apply -f manifests/service.yaml

# confirm it's running
kubectl get pods -n exercises
kubectl logs -f <pod-name> -n exercises
```

## Access it locally

Exposed via the shared `Gateway` (`../manifests/gateway.yaml`) on path `/pingpong`, rewritten to `/`. Reachable on whichever host port your k3d cluster maps to the load balancer's port 80 (e.g. `http://localhost:8081/pingpong`) — check your cluster's port mapping.

`/pings` is cluster-internal only (no route exposes it) — it's consumed by `log_output`'s reader via `http://ping-pong-svc:3000/pings`.

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
docker build -t ping-pong:2.3.0 .
gcloud auth configure-docker europe-west4-docker.pkg.dev
docker tag ping-pong:2.3.0 europe-west4-docker.pkg.dev/<project-id>/dwk-repo/ping-pong:2.3.0
docker push europe-west4-docker.pkg.dev/<project-id>/dwk-repo/ping-pong:2.3.0

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

`gke/service.yaml` was `type: NodePort` for this exercise — GKE's Ingress controller requires a NodePort backend Service (it doesn't expose the NodePort externally itself, the Ingress's load balancer does that). The shared root `../manifests/ingress.yaml` routed `/pingpong` here, same as it does locally. As of exercise 3.3 below, the Ingress has been replaced by a Gateway and the Service is `ClusterIP` again — the `3.2` git tag still has the `NodePort` version if you need to see exactly what this exercise looked like.

## Exercise 3.3: Gateway API instead of Ingress

The Gateway API is the next-generation successor to Ingress — same job (routing external HTTP traffic to Services based on path/host rules), but as a more extensible, standardized set of resources (`GatewayClass`, `Gateway`, `HTTPRoute`) instead of the single monolithic `Ingress` kind:
- **`GatewayClass`** (`gke-l7-global-external-managed` here) — provided by GKE itself, picks which load balancer implementation backs the Gateway. Enabled on the cluster once with `gcloud container clusters update dwk-cluster --zone=europe-west4-a --gateway-api=standard`.
- **`Gateway`** — defines *where* traffic enters (which ports/protocols to listen on), independent of routing rules.
- **`HTTPRoute`** — defines the actual routing rules (path matches → backend Service), analogous to an Ingress's `paths` list.

`../manifests/gke/gateway.yaml` defines one shared `Gateway` (`my-gateway`) and one `HTTPRoute` with two rules — `/pingpong` → `ping-pong-svc`, `/status` → `log-output-svc` — the same shape as the old shared `../manifests/ingress.yaml`, just split across two resource kinds. `gke/service.yaml` is back to plain `ClusterIP`: unlike Ingress, an `HTTPRoute` targets a Service directly, no NodePort needed.

```bash
# one-time per cluster
gcloud container clusters update dwk-cluster --zone=europe-west4-a --gateway-api=standard

kubectl apply -f manifests/gke/service.yaml   # ClusterIP now
kubectl apply -f ../manifests/gke/gateway.yaml

# wait for the Gateway to get an address (can take several minutes; 404/502 is normal while it provisions)
kubectl get gateway my-gateway -n exercises --watch
curl http://<gateway-address>/pingpong

# the old Ingress is no longer needed once the Gateway works — remove it to avoid paying for two load balancers
kubectl delete -f ../manifests/ingress.yaml
```

## Exercise 3.4: rewritten routing

The app now responds on `/` instead of `/pingpong` — rather than baking the cluster's external URL structure (`/pingpong`) into the app itself, that translation now lives entirely in the `HTTPRoute`'s `URLRewrite` filter (`../manifests/gke/gateway.yaml`): a request matching the `/pingpong` prefix gets its path rewritten to `/` (via `ReplacePrefixMatch`) before being forwarded to `ping-pong-svc`. This is the same `URLRewrite`/`ReplacePrefixMatch` mechanism Ingress has no equivalent for — one of the concrete advantages of the Gateway API mentioned in the course material.

A side effect: since the old `/` health-check stub and the real `pingpong` logic are now the same route, GKE's health check (also always `GET /`) exercises the real counter logic directly — no separate dummy route needed anymore (see the note above).

**Local k3d note:** this was GKE/Gateway-specific when written. As of chapter 5, the local cluster also runs Envoy Gateway (Traefik disabled, see `../manifests/gateway.yaml`), with the exact same `URLRewrite` rule — so `http://localhost:8081/pingpong` works locally too now, same as on GKE.

```bash
# after bumping gke/deployment.yaml's image tag and re-applying it
kubectl apply -f ../manifests/gke/gateway.yaml   # picks up the new URLRewrite filter
curl http://<gateway-address>/pingpong           # now rewritten to / before reaching the app
```

## Exercise 4.1: readiness probe

`GET /healthz` reports readiness based on Postgres connectivity: a cheap `SELECT 1` on every call (not `ensureTable()`, which would be unsafe to call repeatedly — it reloads `lastShown`/`nextValue` from the database on every call, which would clobber the in-memory counter state between requests), plus a check that the one-time startup table/state load has finished. The local `readinessProbe` lived in `manifests/deployment.yaml` here (`initialDelaySeconds: 5`, `periodSeconds: 5`); as of exercise 4.4 that file was replaced by `manifests/rollout.yaml` (see below), which carries the same probe forward. `manifests/gke/deployment.yaml` (still a plain `Deployment`, GKE wasn't touched by 4.4) has the identical probe.

Tested per the exercise instructions: scaled `postgres-stset` to 0 replicas, then deleted and re-applied the Deployment. `kubectl get pods` showed `ping-pong` at `0/1` `Running` (not absent — the server starts regardless of Postgres) while `../log_output`'s reader also dropped to not-ready (its own readiness probe depends on reaching `ping-pong`, see that app's README). Scaling Postgres back to 1 replica flipped both back to ready automatically within a few seconds, with no manual intervention.

## Exercise 4.4: canary analysis on CPU usage

`manifests/deployment.yaml` is replaced by `manifests/rollout.yaml` — a [Rollout](https://argo-rollouts.readthedocs.io/en/stable/features/specification/) (Argo Rollouts' `Deployment` equivalent) using a `canary` strategy, plus an `AnalysisTemplate` that gates the rollout on cluster-wide CPU usage instead of just probes:

```yaml
strategy:
  canary:
    steps:
      - setWeight: 50
      - analysis:
          templates:
            - templateName: cpu-usage-rate
      - setWeight: 100
```

`replicas` was also bumped from `1` to `2`: a canary `setWeight: 50` step is meaningless with a single replica (there's no partial state — it's either 0% or 100% canary), so a real canary rollout needs at least 2 to actually run half-old/half-new in between.

The `AnalysisTemplate` (`cpu-usage-rate`) queries Prometheus for the combined CPU usage rate of every container in the `exercises` namespace over a 5-minute window:

```promql
scalar(sum(rate(container_cpu_usage_seconds_total{namespace="exercises"}[5m])))
```

`successCondition: result < 0.5` (cores) — a hardcoded value picked after measuring: this namespace's actual idle/light-load usage sits around `0.01`–`0.05` cores, so `0.5` comfortably passes normal traffic while still catching a genuine runaway spike.

**Tested both halves of the requirement**, by temporarily changing `successCondition` and reapplying (which also bumps the revision, since the canary logic only runs on a genuine spec change):
- **Threshold set too low** (`result < 0.001`, guaranteed below real usage): the `AnalysisRun` correctly came back `Failed` (measured `~0.044` cores at the time) and the Rollout aborted — `kubectl argo rollouts get rollout ping-pong -n exercises` showed `Status: ✖ Degraded`, canary scaled back down, 100% traffic stayed on the stable (pre-update) `ReplicaSet`. The update did not go through, as required.
- **Threshold reset to `0.5`**: the same update now passed all 3 canary steps and reached `Status: ✔ Healthy`, `SetWeight: 100` — the update completed normally.

Evidence of the blocked (too-low-threshold) run, from `kubectl describe analysisrun <name> -n exercises`:

```
Status:
  Message:  Metric "cpu-usage-rate" assessed Failed due to failed (1) > failureLimit (0)
  Metric Results:
    Count:   1
    Failed:  1
    Measurements:
      Phase:  Failed
      Value:  0.043718459009398664
    Name:     cpu-usage-rate
    Phase:    Failed
  Phase:      Failed
Events:
  Warning  MetricFailed       rollouts-controller  Metric 'cpu-usage-rate' Completed. Result: Failed
  Warning  AnalysisRunFailed  rollouts-controller  Analysis Completed. Result: Failed
```

The same value (`sum(rate(container_cpu_usage_seconds_total{namespace="exercises"}[5m]))` ≈ `0.044` cores) can also be checked directly in Prometheus at `localhost:9090` for the relevant time window, confirming the AnalysisRun measured real cluster data rather than erroring out.

```bash
# install Argo Rollouts once per cluster (large CRDs, needs --server-side)
kubectl create namespace argo-rollouts
kubectl apply --server-side -n argo-rollouts -f https://github.com/argoproj/argo-rollouts/releases/latest/download/install.yaml

# the kubectl plugin used above, for inspecting Rollouts/AnalysisRuns
curl -fsSL -o kubectl-argo-rollouts https://github.com/argoproj/argo-rollouts/releases/latest/download/kubectl-argo-rollouts-linux-amd64
chmod +x kubectl-argo-rollouts && mv kubectl-argo-rollouts /usr/local/bin/

kubectl apply -f manifests/rollout.yaml
kubectl argo rollouts get rollout ping-pong -n exercises --watch
```

**Known limitation from going to 2 replicas:** the in-memory counter (`lastShown`/`nextValue`) is loaded once per pod at startup and isn't synchronized live between replicas — with the Gateway load-balancing across both, two consecutive requests can occasionally land on different pods and show the same or an out-of-order `pong <n>` value. This predates and is independent of exercise 4.4's actual subject (canary analysis); fixing it would mean making every request hit Postgres directly (e.g. an atomic `UPDATE ... RETURNING`) instead of serving from in-memory state, which is out of scope here.
