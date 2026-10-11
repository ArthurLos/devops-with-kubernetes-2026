# todo-backend

Backend microservice for the course project's todo functionality. Stores todos in memory (no database yet).

- `GET /todos` — returns the current list as JSON.
- `POST /todos` — adds a new todo (`text` field, max 140 characters, trimmed). Content-type decides the response: `application/json` requests get the updated list back (`201`), anything else (e.g. a plain HTML form submission) gets redirected to `/` so the browser lands back on `../todo-app`'s page with the updated list.

The port is configurable via the `PORT` environment variable (defaults to `3000`).

## Local development

```bash
npm install
npm start
```

## Build and deploy

```bash
# build the image (bump the tag when the code changes)
docker build -t todo-backend:1.1.0 .

# get cluster name if you don't know it
k3d cluster list

# load it into your local cluster
k3d image import todo-backend:1.1.0 -c <cluster-name>

# update the image tag in manifests/deployment.yaml to match, then apply
kubectl apply -f manifests/deployment.yaml
kubectl apply -f manifests/service.yaml

# confirm it's running
kubectl get pods
kubectl logs -f <pod-name>
```

## Access it locally

- `GET /todos` is exposed externally via `../todo-app`'s shared Ingress (`../todo-app/manifests/ingress.yaml`, path `/todos`), e.g. `http://localhost:8081/todos` — check your cluster's port mapping.
- Cluster-internal address: `http://todo-backend-svc:2345/todos`.

## Testing

```bash
# list todos
curl http://localhost:8081/todos

# add one via a plain form submission (redirects to /)
curl -i -X POST -d "text=Write the Kubernetes submission" http://localhost:8081/todos

# add one via JSON (returns the updated list)
curl -i -X POST -H "Content-Type: application/json" -d '{"text":"Test via JSON"}' http://localhost:8081/todos
```
