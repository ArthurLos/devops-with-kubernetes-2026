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

## Exercise 3.6: automatic deployment via GitHub Actions

Pushing to `main` now builds, publishes and deploys the whole project automatically — `.github/workflows/main.yaml`:

- **`build-publish`** job — a [matrix](https://docs.github.com/en/actions/using-jobs/using-a-build-matrix-for-your-jobs) over the three apps (`todo-app`, `todo-backend`, `wiki-reminder`) builds and pushes each image to Artifact Registry in parallel, tagged `<branch>-<commit-sha>` (so every push gets a unique, traceable image per app, no manual version bumps needed for CI deploys).
- **`deploy`** job (runs after all three builds succeed) — uses `kustomize edit set image` to point this folder's `kustomization.yaml` at the three freshly-pushed image tags, then `kustomize build . | kubectl apply -f -`, and waits for each rollout.

**Authentication** uses [Workload Identity Federation](https://cloud.google.com/iam/docs/workload-identity-federation) instead of a long-lived service account key — GitHub issues a short-lived OIDC token for each run, which Google Cloud exchanges for a token to impersonate the `github-actions-sa` service account, scoped so only this exact repo (`ArthurLos/devops-with-kubernetes-2026`) can do so. Nothing secret is stored in the repo itself. Set up once via:

```bash
gcloud iam service-accounts create "github-actions-sa" --display-name="GitHub Actions SA"

gcloud projects add-iam-policy-binding dwk-gke-512012 \
  --role="roles/artifactregistry.writer" \
  --member="serviceAccount:github-actions-sa@dwk-gke-512012.iam.gserviceaccount.com"

gcloud projects add-iam-policy-binding dwk-gke-512012 \
  --role="roles/container.admin" \
  --member="serviceAccount:github-actions-sa@dwk-gke-512012.iam.gserviceaccount.com"

gcloud iam workload-identity-pools create "github-pool" --location="global"

gcloud iam workload-identity-pools providers create-oidc "github-provider" \
  --location="global" \
  --workload-identity-pool="github-pool" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository=='ArthurLos/devops-with-kubernetes-2026'" \
  --issuer-uri="https://token.actions.githubusercontent.com"

gcloud iam service-accounts add-iam-policy-binding \
  github-actions-sa@dwk-gke-512012.iam.gserviceaccount.com \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/114361046393/locations/global/workloadIdentityPools/github-pool/attribute.repository/ArthurLos/devops-with-kubernetes-2026"
```

The workflow reads three secrets from a GitHub **environment** named `GKE_PROJECT` (referenced via `environment: GKE_PROJECT` in the workflow, must match exactly):
- `GKE_PROJECT` — the GCP project ID (`dwk-gke-512012`).
- `SERVICE_ACCOUNT` — `github-actions-sa@dwk-gke-512012.iam.gserviceaccount.com`.
- `WORKLOAD_IDENTITY_PROVIDER` — `projects/114361046393/locations/global/workloadIdentityPools/github-pool/providers/github-provider`.

**Note on `todo-app`'s Deployment strategy:** `todo-app/manifests/deployment.yaml` sets `strategy: type: Recreate` instead of the Kubernetes default `RollingUpdate`. `todo-app-pvc` is `ReadWriteOnce` (a GKE Persistent Disk only attaches to one node at a time); `RollingUpdate` tries to start the new pod before the old one releases the volume — possibly on a different node — which can get the deployment stuck waiting for a volume attachment. `Recreate` fully terminates the old pod (and releases the disk) before starting the new one, at the cost of a brief moment of downtime on deploy. This doesn't affect the data itself — the PVC and its underlying disk are independent of the Deployment's pod-replacement strategy, so whichever pod runs next mounts the exact same, still-intact volume.

## Deploying to GKE (manually)

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
