# todo-app

Web server for the course project. `GET /` renders a page showing a random picture from [Lorem Picsum](https://picsum.photos), an input field + send button for new todos (not wired up yet, max 140 characters), and a list of hardcoded todos.

The picture is cached on a `PersistentVolume` (`../../manifests/todo-app-persistentvolume.yaml` + `todo-app-persistentvolumeclaim.yaml`) for 10 minutes — `GET /image` serves the cached file and only fetches a new one from Picsum once it's older than that (or missing). This means the picture survives pod restarts without hitting the external API again, and only refreshes lazily on the next request after the cache expires, not on a background timer.

The port is configurable via the `PORT` environment variable (defaults to `3000`); the image cache directory via `IMAGE_DIR` (defaults to `/usr/src/app/images`).

## Local development

```bash
cp .env.sample .env
npm install
npm start
```

## Build and deploy

```bash
# build the image (bump the tag when the code changes)
docker build -t todo-app:1.3.0 .

# get cluster name if you don't know it
k3d cluster list

# load it into your local cluster
k3d image import todo-app:1.3.0 -c <cluster-name>

# the PersistentVolume/Claim must exist first (repo root, admin-managed resource)
kubectl apply -f ../../manifests/todo-app-persistentvolume.yaml
kubectl apply -f ../../manifests/todo-app-persistentvolumeclaim.yaml

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

## Testing the image cache

```bash
# same picture on repeated requests
curl -s -o a.jpg http://localhost:8081/image
curl -s -o b.jpg http://localhost:8081/image
cmp a.jpg b.jpg   # identical -> cache works

# simulate a crash/restart and confirm the picture survives
kubectl delete pod -l app=todo-app
curl -s -o c.jpg http://localhost:8081/image
cmp a.jpg c.jpg   # still identical -> cached on the PersistentVolume, not refetched
```
