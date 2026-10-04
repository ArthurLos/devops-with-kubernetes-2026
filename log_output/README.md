# Log output

Two containers sharing one Pod, communicating via a shared `emptyDir` volume:

- **`writer/`** — generates a random string on startup, (re)writes a line (timestamp + the string) to a shared file every 5 seconds, overwriting the previous one. No HTTP server, no stdout logging anymore — the file *is* the log.
- **`reader/`** — Express server; `GET /status` returns that status line plus the current ping-pong request count (read from a separate shared `PersistentVolume`, see below), e.g.:
  ```
  2026-10-04T16:29:17.416Z: 1d0f0cba-d291-4963-a8e9-09d3d724948a.
  Ping / Pongs: 3
  ```

The reader's port is configurable via the `PORT` environment variable (defaults to `3000`). The `writer`/`reader` pair agree on the status file path via `FILE_PATH` (defaults to `/usr/src/app/shared/status.txt`), mounted from an `emptyDir` volume local to this Pod. The ping-pong count comes from `COUNTER_FILE` (defaults to `/usr/src/app/pingpong/counter.txt`), mounted from the `PersistentVolume` shared with the `../ping-pong` app (`../manifests/persistentvolume.yaml` + `persistentvolumeclaim.yaml`).

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
docker build -t log-output-reader:1.1.0 reader/

# get cluster name if you don't know it
k3d cluster list

# load them into your local cluster
k3d image import log-output-writer:1.1.0 log-output-reader:1.1.0 -c <cluster-name>

# the shared PersistentVolume/Claim and Ingress must exist first (repo root, span multiple apps)
kubectl apply -f ../manifests/persistentvolume.yaml
kubectl apply -f ../manifests/persistentvolumeclaim.yaml
kubectl apply -f ../manifests/ingress.yaml

# update the image tags in manifests/deployment.yaml to match, then apply
kubectl apply -f manifests/deployment.yaml
kubectl apply -f manifests/service.yaml
kubectl rollout status deployment/log-output

# confirm it's running (2/2 containers ready)
kubectl get pods

# logs per container, since there's more than one now
kubectl logs -f <pod-name> -c writer
kubectl logs -f <pod-name> -c reader
```

Note: `writer` won't print anything to `kubectl logs` by design — it writes to the shared file instead. That's expected.

## Access it locally

Exposed via the shared Ingress (`../manifests/ingress.yaml`), shared with the `../ping-pong` application:
- `/status` → this app (reader)
- `/pingpong` → ping-pong

`the_project`'s own Ingress separately owns `/`, so there's no overlap between the two Ingress resources. Reachable on whichever host port your cluster maps to the ingress controller's port 80 (e.g. `http://localhost:8081/status`) — check your cluster's port mapping.
