# ping-pong

Responds to `GET /pingpong` with `pong <n>`. The counter lives in memory for speed, and is written to a shared `PersistentVolume` (`../manifests/persistentvolume.yaml` + `persistentvolumeclaim.yaml`) right after each response — before incrementing — so the file always holds exactly the value that was just shown. The same volume is also mounted into the `log_output` reader, which displays the count, matching the last `pong` value exactly.

On startup, the counter resumes from `(file value) + 1`, since the file holds the *last shown* value, not the next one — so a restart continues correctly instead of repeating the last `pong`.

Shares an Ingress with the `log_output` application (see `../manifests/ingress.yaml` at the repo root, since it spans both apps): `/pingpong` routes here, `/status` goes to `log_output`.

The port is configurable via the `PORT` environment variable (defaults to `3000`).

## Local development

```bash
npm install
npm start
```

## Build and deploy

```bash
# build the image (bump the tag when the code changes)
docker build -t ping-pong:1.1.0 .

# get cluster name if you don't know it
k3d cluster list

# load it into your local cluster
k3d image import ping-pong:1.1.0 -c <cluster-name>

# the shared PersistentVolume/Claim and Ingress must exist first (repo root, span multiple apps)
kubectl apply -f ../manifests/persistentvolume.yaml
kubectl apply -f ../manifests/persistentvolumeclaim.yaml
kubectl apply -f ../manifests/ingress.yaml

# update the image tag in manifests/deployment.yaml to match, then apply
kubectl apply -f manifests/deployment.yaml
kubectl apply -f manifests/service.yaml

# confirm it's running
kubectl get pods
kubectl logs -f <pod-name>
```

## Access it locally

Exposed via `log_output`'s Ingress on path `/pingpong`. Reachable on whichever host port your cluster maps to the ingress controller's port 80 (e.g. `http://localhost:8081/pingpong`) — check your cluster's port mapping.

## Note on the shared volume

The `PersistentVolume` uses `hostPath` with `nodeAffinity` pinning it to one specific node (see `../manifests/persistentvolume.yaml`). `hostPath` only works correctly when every Pod using it lands on that same node — the affinity rule makes the scheduler enforce that automatically for both this app and `log_output`.
