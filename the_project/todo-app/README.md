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
# build the image
docker build -t todo-app:1.0.0 .

# Get cluster name
k3d cluster list 

# load it into your local cluster
k3d image import todo-app:1.0.0 -c <cluster-name>

# apply the deployment
kubectl apply -f manifests/deployment.yaml

# confirm it's running
kubectl get pods
kubectl logs -f <pod-name>
```
