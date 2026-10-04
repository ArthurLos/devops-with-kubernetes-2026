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
kubectl apply -f manifests/ingress.yaml
kubectl rollout status deployment/todo-app

# confirm it's running
kubectl get pods
kubectl logs -f <pod-name>
```

## Access it locally

Exposed via Ingress (`manifests/ingress.yaml`), routed through the cluster's Traefik ingress controller (service is `ClusterIP`, no NodePort anymore as of exercise 1.8). Reachable on whichever host port your cluster maps to the ingress controller's port 80 (e.g. a k3d cluster created with `-p "8081:80@loadbalancer"` maps it to `http://localhost:8081`) — check your cluster's port mapping.
