# todo-app

Web server for the course project. Currently just starts up and logs the port it's listening on; todo functionality is added in later exercises.

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
kubectl rollout status deployment/todo-app

# confirm it's running
kubectl get pods
kubectl logs -f <pod-name>
```

## Access it locally

The app isn't exposed outside the cluster yet, so use port-forwarding to reach it:

```bash
kubectl port-forward deployment/todo-app 3000:3000
```

Then open http://localhost:3000 in a browser.
