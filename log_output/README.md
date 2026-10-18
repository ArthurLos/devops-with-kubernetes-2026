# Log output

Two containers sharing one Pod, communicating via a shared `emptyDir` volume:

- **`writer/`** — generates a random string on startup, (re)writes a line (timestamp + the string) to a shared file every 5 seconds, overwriting the previous one. No HTTP server, no stdout logging anymore — the file *is* the log.
- **`reader/`** — Express server; `GET /status` returns the file content and env variable from a `ConfigMap` (exercise 2.5), then that status line plus the current ping-pong count, fetched live over HTTP from `../ping-pong` (`GET http://ping-pong-svc:3000/pings`, as of exercise 2.1 — no more shared volume between the two apps), e.g.:
  ```
  file content: this text is from file
  env variable: MESSAGE=hello world
  2026-10-04T16:29:17.416Z: 1d0f0cba-d291-4963-a8e9-09d3d724948a.
  Ping / Pongs: 3
  ```

The reader's port is configurable via the `PORT` environment variable (defaults to `3000`); the ping-pong URL via `PINGPONG_URL` (defaults to `http://ping-pong-svc:3000/pings`). The `writer`/`reader` pair still agree on the status file path via `FILE_PATH` (defaults to `/usr/src/app/shared/status.txt`), mounted from an `emptyDir` volume local to this Pod — that one stays, it's internal to `log_output` itself.

As of exercise 3.2, the reader also responds `200` on `GET /` — GKE's Ingress health-checks a backend Service at `/` regardless of which path it's actually routed under (`/status` here), so without this the Ingress would never mark the backend healthy.

As of exercise 2.5, a `ConfigMap` (`manifests/configmap.yaml`, `log-output-config`) provides `information.txt` (mounted as a volume at `/usr/src/app/config/information.txt`, path configurable via `INFO_FILE_PATH`) and the `MESSAGE` env variable, both read by the reader and printed at the top of `/status`.

As of exercise 2.3, this app runs in the `exercises` namespace (see `../manifests/namespace-exercises.yaml`), together with `../ping-pong` — every exercise outside `the_project` lives there from now on.

## Local development

Run both separately, pointing at the same local file:

```bash
cd writer && FILE_PATH=/tmp/status.txt npm install && npm start
cd reader && FILE_PATH=/tmp/status.txt npm install && npm start
```

## Build and deploy

```bash
# build both images (bump tags when the code changes)
docker build -t log-output-writer:1.1.0 writer/
docker build -t log-output-reader:1.4.0 reader/

# get cluster name if you don't know it
k3d cluster list

# load them into your local cluster
k3d image import log-output-writer:1.1.0 log-output-reader:1.4.0 -c <cluster-name>

# the exercises namespace, the ConfigMap and the shared Ingress must exist first (repo root, spans multiple apps)
kubectl apply -f ../manifests/namespace-exercises.yaml
kubectl apply -f manifests/configmap.yaml
kubectl apply -f ../manifests/ingress.yaml

# update the image tags in manifests/deployment.yaml to match, then apply
kubectl apply -f manifests/deployment.yaml
kubectl apply -f manifests/service.yaml
kubectl rollout status deployment/log-output -n exercises

# confirm it's running (2/2 containers ready)
kubectl get pods -n exercises

# logs per container, since there's more than one now
kubectl logs -f <pod-name> -n exercises -c writer
kubectl logs -f <pod-name> -n exercises -c reader
```

Note: `writer` won't print anything to `kubectl logs` by design — it writes to the shared file instead. That's expected.

## Access it locally

Exposed via the shared Ingress (`../manifests/ingress.yaml`), shared with the `../ping-pong` application:
- `/status` → this app (reader)
- `/pingpong` → ping-pong

`the_project`'s own Ingress separately owns `/`, so there's no overlap between the two Ingress resources. Reachable on whichever host port your cluster maps to the ingress controller's port 80 (e.g. `http://localhost:8081/status`) — check your cluster's port mapping.

## Exercise 3.2: deploying to GKE with Ingress

`manifests/gke/deployment.yaml` and `manifests/gke/service.yaml` are GKE-specific variants, analogous to `../ping-pong/manifests/gke/` (see that app's README for the full GKE build/deploy/cleanup flow — cluster create, Artifact Registry push, cluster delete). Differences from the local manifests:
- `gke/deployment.yaml` — images from Google Artifact Registry instead of a locally-imported image.
- `gke/service.yaml` — `type: NodePort` instead of `ClusterIP`: GKE's Ingress controller requires a NodePort backend Service (it doesn't expose the NodePort externally itself — the Ingress's load balancer does that).

`manifests/configmap.yaml` is reused as-is (nothing cluster-specific in it). The root `../manifests/ingress.yaml` is also reused unchanged — GKE provisions its own `gce` `IngressClass` by default, and the rule definitions (paths, Service names, ports) are identical between clusters; only each Service's `type` differs, which lives in the per-app Service manifests, not the Ingress itself.

```bash
# after the cluster, namespace, images, Secret and gke/ manifests are set up (see ../ping-pong/README.md)
kubectl apply -f manifests/configmap.yaml
kubectl apply -f manifests/gke/deployment.yaml
kubectl apply -f manifests/gke/service.yaml
kubectl apply -f ../manifests/ingress.yaml

# wait for the Ingress to get an address (can take a few minutes; 404/502 is normal while it provisions)
kubectl get ingress -n exercises --watch
curl http://<ingress-address>/status
curl http://<ingress-address>/pingpong
```
