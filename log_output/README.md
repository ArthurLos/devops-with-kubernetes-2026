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
kubectl rollout status deployment/log-output

# confirm it's running
kubectl get pods
kubectl logs -f <pod-name>
```

## Access it locally

No Ingress for now (removed in exercise 1.8 to avoid colliding with the project's Ingress on path `/`; will come back once path-based routing is set up alongside the project). Use port-forwarding in the meantime:

```bash
kubectl port-forward deployment/log-output 3000:3000
```

Then open http://localhost:3000 in a browser.
