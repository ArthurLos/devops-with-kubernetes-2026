# Log output

Generates a random string on startup. Logs it with a timestamp every 5 seconds, and also serves it on `GET /` (timestamp + random string) via a web server.

The port is configurable via the `PORT` environment variable (defaults to `3000`).

## Local development

```bash
npm install
npm start
```

## Build and deploy

```bash
# build the image (bump the tag when the code changes)
docker build -t log-output:1.1.0 .

# get cluster name if you don't know it
k3d cluster list

# load it into your local cluster
k3d image import log-output:1.1.0 -c <cluster-name>

# update the image tag in manifests/deployment.yaml to match, then apply
kubectl apply -f manifests/deployment.yaml
kubectl apply -f manifests/service.yaml

# also (re)apply the shared ingress, defined at the repo root since it spans multiple apps
kubectl apply -f ../manifests/ingress.yaml
kubectl rollout status deployment/log-output

# confirm it's running
kubectl get pods
kubectl logs -f <pod-name>
```

## Access it locally

Exposed via the shared Ingress (`../manifests/ingress.yaml`), shared with the `../ping-pong` application: `/pingpong` routes there, everything else (`/`) comes here. Reachable on whichever host port your cluster maps to the ingress controller's port 80 (e.g. `http://localhost:8081`) — check your cluster's port mapping.

Note: as of exercise 1.9, `the_project`'s own Ingress (`project-ingress`) also still claims path `/`, so which one actually wins for the root path is currently ambiguous until a later exercise reconciles the two.
