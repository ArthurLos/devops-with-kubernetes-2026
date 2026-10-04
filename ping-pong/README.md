# ping-pong

Responds to `GET /pingpong` with `pong <n>`, where `<n>` is an in-memory counter that increases on every request (resets when the pod restarts).

Shares an Ingress with the `log_output` application (see `../manifests/ingress.yaml` at the repo root, since it spans both apps): requests to `/pingpong` are routed here, everything else goes to `log_output`.

The port is configurable via the `PORT` environment variable (defaults to `3000`).

## Local development

```bash
npm install
npm start
```

## Build and deploy

```bash
# build the image (bump the tag when the code changes)
docker build -t ping-pong:1.0.0 .

# get cluster name if you don't know it
k3d cluster list

# load it into your local cluster
k3d image import ping-pong:1.0.0 -c <cluster-name>

# update the image tag in manifests/deployment.yaml to match, then apply
kubectl apply -f manifests/deployment.yaml
kubectl apply -f manifests/service.yaml

# also (re)apply the shared ingress, defined at the repo root since it spans multiple apps
kubectl apply -f ../manifests/ingress.yaml

# confirm it's running
kubectl get pods
kubectl logs -f <pod-name>
```

## Access it locally

Exposed via `log_output`'s Ingress on path `/pingpong`. Reachable on whichever host port your cluster maps to the ingress controller's port 80 (e.g. `http://localhost:8081/pingpong`) — check your cluster's port mapping.
