# ping-pong

Responds to `GET /pingpong` with `pong <n>`. The counter lives in memory for speed and is persisted to its own `PersistentVolume` (`../manifests/ping-pong-persistentvolume.yaml` + `ping-pong-persistentvolumeclaim.yaml`), so it survives pod restarts. As of exercise 2.1 this volume is no longer shared with `log_output` — that app now reads the count over HTTP instead (`GET /pings`, plain text, same value as the last `pong` shown).

Shares an Ingress with the `log_output` application (see `../manifests/ingress.yaml` at the repo root, since it spans both apps): `/pingpong` routes here, `/status` goes to `log_output`.

The port is configurable via the `PORT` environment variable (defaults to `3000`).

## Local development

```bash
npm install
npm start
```

## Build and deploy

```bash
# build the image (bump the tag when the code changes)
docker build -t ping-pong:1.2.0 .

# get cluster name if you don't know it
k3d cluster list

# load it into your local cluster
k3d image import ping-pong:1.2.0 -c <cluster-name>

# the PersistentVolume/Claim and shared Ingress must exist first (repo root)
kubectl apply -f ../manifests/ping-pong-persistentvolume.yaml
kubectl apply -f ../manifests/ping-pong-persistentvolumeclaim.yaml
kubectl apply -f ../manifests/ingress.yaml

# update the image tag in manifests/deployment.yaml to match, then apply
kubectl apply -f manifests/deployment.yaml
kubectl apply -f manifests/service.yaml

# confirm it's running
kubectl get pods
kubectl logs -f <pod-name>
```

## Access it locally

Exposed via `log_output`'s Ingress on path `/pingpong`. Reachable on whichever host port your cluster maps to the ingress controller's port 80 (e.g. `http://localhost:8081/pingpong`) — check your cluster's port mapping.

`/pings` is cluster-internal only (no Ingress route) — it's consumed by `log_output`'s reader via `http://ping-pong-svc:3000/pings`.

## Note on the private volume

Uses `hostPath` with `nodeAffinity` pinning it to one specific node (see `../manifests/ping-pong-persistentvolume.yaml`). Since only this app's own Pod uses it now (not shared with `log_output` anymore), the pinning is mostly a safety net in case the Pod ever gets rescheduled to a different node — `hostPath` data wouldn't follow it otherwise.
