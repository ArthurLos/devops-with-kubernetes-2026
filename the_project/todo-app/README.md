# todo-app

Web server for the course project. Responds to `GET /` with a simple HTML page; todo functionality is added in later exercises.

The port is configurable via the `PORT` environment variable (defaults to `3000`).

## Local development

```bash
cp .env.sample .env
npm install
npm start
```

## Build and deploy

```bash
# build the image (bump the tag when the code changes)
docker build -t todo-app:1.1.0 .

# get cluster name if you don't know it
k3d cluster list

# load it into your local cluster
k3d image import todo-app:1.1.0 -c <cluster-name>

# update the image tag in manifests/deployment.yaml to match, then apply
kubectl apply -f manifests/deployment.yaml
kubectl apply -f manifests/service.yaml
kubectl rollout status deployment/todo-app

# confirm it's running
kubectl get pods
kubectl logs -f <pod-name>
```

## Access it locally

Exposed via a NodePort service (`manifests/service.yaml`, `nodePort: 30080`). Whether this is reachable directly on `localhost:30080` depends on how your cluster maps ports to the host (e.g. a k3d cluster created with `-p "8082:30080@loadbalancer"` maps it to `localhost:8082` instead) — check your cluster's port mapping.

Alternatively, port-forward works regardless of cluster setup:

```bash
kubectl port-forward deployment/todo-app 3000:3000
```

Then open the app in a browser on whichever port applies.
