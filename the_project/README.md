# the_project

The course's main project: a todo app (`todo-app/`, the frontend + cached-image service), its backend (`todo-backend/`, Postgres-backed todo storage), and a CronJob that periodically adds a "read this" reminder todo (`wiki-reminder/`). See each subfolder's own README for details on that specific service.

As of exercise 3.5, the whole project is deployed to GKE as **one unit via [Kustomize](https://kustomize.io/)** (`kustomization.yaml` in this folder) instead of applying each app's manifests one by one. This also solves the ordering problem the course material calls out: `kubectl apply -f manifests/` applies files alphabetically, which breaks if (for example) a ConfigMap is created before its namespace exists — Kustomize instead applies resources in the order you list them in `resources:`.

## What `kustomization.yaml` does

- **`resources`** lists every manifest that makes up the project, in dependency order: the `project` namespace first, then Postgres (Secret, StatefulSet), `todo-backend`, then `todo-app`'s ConfigMap/PVC/Deployment/Service, the shared Ingress, and finally the `wiki-reminder` CronJob.
- **`images`** rewrites each Deployment/CronJob's image at build time to its Artifact Registry location (`europe-west4-docker.pkg.dev/dwk-gke-512012/dwk-repo/<app>:<tag>`) — this is why the GKE-targeted resources below don't need their own copy of each Deployment just to change the image field; Kustomize does it centrally.
- The namespace file is a **local copy** (`manifests/namespace.yaml`) of the root `../manifests/namespace-project.yaml`: Kustomize refuses to read files outside its own directory tree by default (a security restriction), so the root file stays for the local, non-Kustomize k3d workflow, and this folder gets its own copy for Kustomize's use.

## GKE-specific manifests

Same pattern as `../ping-pong/manifests/gke/` and `../log_output/manifests/gke/` from exercises 3.1–3.2: a `manifests/gke/` subfolder per app holding only the files that structurally differ from the local k3d setup, everything else (Deployments, ConfigMap, Ingress, CronJob, Postgres Secret) is reused as-is:

- **`todo-app/manifests/gke/pvc.yaml`** — no `storageClassName`: GKE automatically provisions a (default) Persistent Disk. The local setup instead binds to a specific `hostPath` `PersistentVolume` pinned to one k3d node (`../manifests/todo-app-persistentvolume.yaml`), which has no GKE equivalent.
- **`todo-app/manifests/gke/service.yaml`** and **`todo-backend/manifests/gke/service.yaml`** — `type: NodePort` instead of `ClusterIP`: GKE's Ingress controller requires a NodePort backend Service (it doesn't expose the NodePort externally itself, the Ingress's load balancer does that) — same reasoning as exercise 3.2.
- **`todo-backend/manifests/gke/postgres.yaml`** — same StatefulSet as the local one, minus `storageClassName` on the `PersistentVolumeClaim`.

The shared `todo-app/manifests/ingress.yaml` is reused unchanged — GKE provisions its own `gce` `IngressClass` by default, same as exercise 3.2.

**Important:** both `todo-app` and `todo-backend` need to respond `200` on `GET /` for this to work — GKE's Ingress health-checks a Service at `/` regardless of which path it's actually routed under. `todo-app` already serves a real page at `/`; `todo-backend` got a dedicated stub route for this in exercise 3.5 (see `todo-backend/README.md`) after the Ingress 502'd on `/todos` without it.

## Deploying to GKE

```bash
# build and push each image (bump tags as needed, update kustomization.yaml's images: section to match)
docker build -t todo-app:1.5.0 todo-app/
docker build -t todo-backend:2.2.0 todo-backend/
docker build -t wiki-reminder:1.0.0 wiki-reminder/

gcloud auth configure-docker europe-west4-docker.pkg.dev
for IMAGE in todo-app:1.5.0 todo-backend:2.2.0 wiki-reminder:1.0.0; do
  docker tag "$IMAGE" "europe-west4-docker.pkg.dev/<project-id>/dwk-repo/$IMAGE"
  docker push "europe-west4-docker.pkg.dev/<project-id>/dwk-repo/$IMAGE"
done

# preview what Kustomize would apply, without touching the cluster
kubectl kustomize .

# deploy everything in one command
kubectl apply -k .

kubectl rollout status statefulset/postgres-stset -n project
kubectl rollout status deployment/todo-backend -n project
kubectl rollout status deployment/todo-app -n project

# wait for the Ingress to get an address (can take a few minutes; 404/502 is normal while it provisions)
kubectl get ingress project-ingress -n project --watch
curl http://<ingress-address>/
curl http://<ingress-address>/todos
```

## Local development

The local k3d cluster is unaffected by any of the above — it still uses the plain `kubectl apply -f <app>/manifests/...` workflow documented in each subfolder's own README, with its own `hostPath` PersistentVolume and `ClusterIP` Services.
