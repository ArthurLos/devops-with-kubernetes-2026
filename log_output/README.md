# Log output

Simple app that generates a random string on startup and logs it with a timestamp every 5 seconds.

## Build and deploy

```bash
# Optional: local test code
docker run -d --name log-output-test log-output:1.0.0

# build the image
docker build -t log-output:1.0.0 .

# Get cluster name
k3d cluster list 

# load it into your local cluster
k3d image import log-output:1.0.0 -c <cluster-name>

# apply the deployment
kubectl apply -f manifests/deployment.yaml

# confirm it's running
kubectl get pods
kubectl logs -f <pod-name>
```
