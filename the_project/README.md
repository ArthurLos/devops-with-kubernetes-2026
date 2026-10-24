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

## Exercise 3.7: a separate environment per branch

The workflow now triggers on a push to **any** branch (not just `main`), and deploys each one into its own namespace — a fully separate copy of the whole stack (Postgres, `todo-backend`, `todo-app`, `wiki-reminder`, Ingress):

- `main` always deploys to the `project` namespace, same as every exercise since 2.4.
- Any other branch deploys to a namespace **named after the branch itself**.

This is driven by two new lines in the `deploy` job of `.github/workflows/main.yaml`:
```bash
kubectl config set-context --current --namespace="$NAMESPACE"
kustomize edit set namespace "$NAMESPACE"
```
`kustomize edit set namespace` rewrites `kustomization.yaml`'s top-level `namespace:` field for that run only (the checkout is thrown away after the job, so the committed file never changes) — Kustomize then stamps every resource's `metadata.namespace` with it, **and** renames the `Namespace` resource itself (`manifests/namespace.yaml`, `name: project`) to match. That's why no separate `kubectl create namespace ... || true` step is needed, unlike the plain course example: our `kustomization.yaml` already includes the namespace as one of its own resources, so creating it is just part of the same `kubectl apply`.

Tested by pushing a branch `test-3-7` with no other changes: the workflow created a brand-new `test-3-7` namespace with its own running Postgres/todo-app/todo-backend, completely independent of `project`.

## Exercise 3.8: deleting a branch deletes its environment

A second, separate workflow — `.github/workflows/delete-environment.yaml` — triggers on GitHub's [`delete`](https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows#delete) event (fired whenever a branch or tag is deleted) and removes the matching namespace with `kubectl delete namespace "$NAMESPACE" --ignore-not-found`:

- Guarded with `if: github.event.ref_type == 'branch' && github.event.ref != 'main'` — only reacts to an actual branch deletion, and never touches the `project` namespace (deleting the `main` branch isn't something GitHub even allows, but the check costs nothing).
- The branch name comes in via an `env:` entry (`NAMESPACE: ${{ github.event.ref }}`) rather than being interpolated directly into the `run:` script — avoids a shell-injection risk from a maliciously-named branch, since GitHub Actions substitutes `${{ }}` expressions into `run:` steps as raw text before the shell ever sees them.
- Deleting a namespace deletes everything in it in one go — Deployments, the StatefulSet (and its PVC, so that branch's Postgres data goes with it), Services, Ingress, the CronJob — no need to delete resources one by one.

## Exercise 3.9: DBaaS vs DIY

Since exercise 2.7/2.8, this project has run Postgres itself — a `StatefulSet` + `PersistentVolumeClaim` (`todo-backend/manifests/postgres.yaml` locally, `todo-backend/manifests/gke/postgres.yaml` on GKE), with GKE auto-provisioning the underlying Persistent Disk. The alternative the course material raises is a **Database as a Service (DBaaS)**, e.g. [Cloud SQL for PostgreSQL](https://cloud.google.com/sql/postgresql) — Google runs the actual database server, we just connect to an endpoint.

### Work to initialize

- **DIY:** already done — one more `StatefulSet` + `Secret` in the same `kubectl apply -k .` as everything else. No new GCP API, no separate provisioning step.
- **DBaaS:** a genuinely separate resource to provision and wire up — enable the Cloud SQL Admin API, create an instance (region, tier, HA or not), create the database/user, then connect from the cluster via either a [Cloud SQL Auth Proxy](https://cloud.google.com/sql/docs/postgres/connect-auth-proxy) sidecar container or Private IP/VPC peering, since it isn't reachable via a simple in-cluster `ClusterIP`/headless Service like our own StatefulSet is.

### Cost to initialize/run

- **DIY:** effectively free beyond the already-running cluster — just compute + a small Persistent Disk, both billed as part of the GKE node pool/disk costs we're paying for anyway. Deleting the GKE cluster (as we do between sessions, to stay within the course's free trial credits) stops all of it from billing too.
- **DBaaS:** a Cloud SQL instance is a **separate, always-on** billable resource — even the cheapest shared-core tier costs money every hour, independent of whether the GKE cluster exists at all. For a course relying on limited free trial credits, that matters: you'd have to remember to also stop/delete the Cloud SQL instance separately, or it keeps draining credits even while the "cluster deleted between sessions" habit is otherwise working.

### Maintenance

- **DIY:** we own all of it — OS and Postgres version patching, no built-in failover (one replica, so if the pod dies the app has no DB access until it reschedules), and any tuning or config change means editing and re-rolling the `StatefulSet` ourselves.
- **DBaaS:** Google handles OS/minor-version patching, and an HA (regional) configuration gives automatic failover to a standby — for money, not effort. Built-in monitoring integrates with the same Cloud Monitoring/Logging used for the rest of GKE (relevant for exercise 3.12).

### Backups

- **DIY:** entirely manual and our own responsibility — this is exactly what exercise 3.10 (next) has us build by hand: a `CronJob` running `pg_dump`, pushed to Cloud Storage ourselves, with no restore tooling beyond whatever we also write. Easy to get wrong or forget — the Chapter "Deployment Pipeline" reading material's own `pg_dump` example notes its backup "was not saved anywhere" as a cautionary example of exactly this risk.
- **DBaaS:** built-in automated daily backups and point-in-time recovery (via WAL replay) are a couple of `gcloud sql instances patch` flags away (`--backup-start-time`, `--enable-point-in-time-recovery`), restorable from the Console or CLI without writing or maintaining any of that tooling ourselves.

**Verdict for this project:** DIY is the right call *here*, specifically because of the cost structure — it piggybacks on infrastructure (the cluster) we're deleting and recreating around our own schedule anyway, with zero extra always-on billing, and stays declarative/reproducible through the same Kustomize + git workflow as everything else. For a real production system without a hard, limited credit budget, Cloud SQL's maintenance and backup story would likely be worth the extra cost well before the DIY approach's manual backup/failover gaps turn into an actual incident — engineer time spent babysitting a hand-rolled Postgres and testing that its backups actually restore isn't free either, it's just a cost that doesn't show up on the GCP bill.

## Exercise 3.10: backing up the database to Google Cloud Storage

New component: `db-backup/` — a `CronJob` that `pg_dump`s the todo database once every 24 hours and uploads it to a GCS bucket. See `db-backup/README.md` for the full picture, including the one-time manual setup (bucket, a dedicated bucket-scoped service account, and the `storage-sa-key` Secret — per the exercise instructions, that Secret is created by hand with `kubectl create secret`, not through Kustomize or the GitHub Actions pipeline, so no key ever touches git).

Tested by manually triggering a `Job` from the `CronJob` (`kubectl create job --from=cronjob/db-backup`) and confirming the dump landed in `gs://dwk-gke-512012-todo-backup/`.

## Exercise 3.11: resource requests and limits

Every container in the project now sets `resources.requests`/`resources.limits` (CPU/memory), chosen from actual measurements rather than guesses — `kubectl top pods -n project` on GKE, both idle and under a burst of concurrent `curl` requests against the Ingress:

- `todo-app` / `todo-backend`: idle ~1-3m CPU / ~22-27Mi memory, briefly up to ~30-35m CPU under concurrent load → `requests: 20m CPU / 64Mi memory`, `limits: 200m CPU / 128Mi memory` for both (several times headroom above observed peak).
- `postgres`: idle ~1-2m CPU / ~34-36Mi memory → `requests: 50m CPU / 128Mi memory`, `limits: 500m CPU / 256Mi memory` (more generous, since it has no replica to fail over to if it gets OOM-killed).
- `wiki-reminder`: a short-lived `curl`+`bash` script, barely measurable → `requests: 10m CPU / 32Mi memory`, `limits: 100m CPU / 64Mi memory`.
- `db-backup`: the heaviest of the short-lived jobs (full `google-cloud-sdk` + Python, not just `curl`) → `requests: 50m CPU / 128Mi memory`, `limits: 300m CPU / 512Mi memory`.

Verified by re-applying (`kubectl apply -k .`) and confirming every Deployment/StatefulSet rolled out successfully, then re-running the same concurrent-`curl` load test and a manual `db-backup` `Job` — nothing was OOMKilled or CPU-throttled into failure, and actual usage stayed well under every limit.

## Exercise 3.12: finding application logs in GKE

GKE ships with Kubernetes Engine Monitoring already enabled — container stdout/stderr is sent to Cloud Logging automatically, no setup needed. To find a specific workload's logs:

- **Easiest:** Kubernetes Engine → **Workloads** → select the workload (e.g. `todo-backend`) → **Container logs** link — opens Logs Explorer pre-filtered to exactly that workload.
- **Manually in Logs Explorer**, the relevant filter fields are:
  ```
  resource.type="k8s_container"
  resource.labels.cluster_name="dwk-cluster"
  resource.labels.namespace_name="project"
  resource.labels.container_name="todo-backend"
  ```

## Exercise 4.8: GitOps with ArgoCD

Same mechanism as `../log_output`'s exercise 4.7 (see that README for the general explanation of ArgoCD/`automated: {prune, selfHeal}`), but this project's manifests live across several subfolders (one per microservice) instead of one shared `manifests/`, so `argocd-application.yaml` registers it as a [multi-source Application](https://argo-cd.readthedocs.io/en/stable/user-guide/multiple_sources/) (ArgoCD 2.6+) — one plain-directory source per app's `manifests/` folder, all synced together into the `project` namespace:

```bash
kubectl apply -f argocd-application.yaml
```

Deliberately **not** reused for this: this folder's own `kustomization.yaml` (GKE-specific — Artifact Registry images, `manifests/gke/` variants — kept for the GitHub Actions pipeline in case GKE work resumes, see exercise 3.6 above) and `db-backup/` (only meaningful against a real GCS bucket/service-account key per `db-backup/README.md`, and was never part of the local k3d deployment even before GitOps — unaffected by this exercise). `todo-app/manifests/ingress.yaml` is excluded the same way `../log_output` excludes its GKE-only files: it's obsolete locally (replaced by the Gateway API `HTTPRoute` in `manifests/gateway.yaml`), via the source's `directory.exclude`.

Applying it for the first time reported `Synced`/`Healthy` immediately, with all 13 resources already matching what was running (`Namespace`, `ConfigMap`, 2 `Secret`s, 3 `Service`s, 3 `Deployment`s, 1 `StatefulSet`, 1 `CronJob`, 1 `HTTPRoute`) — confirming ArgoCD took over management without pruning or recreating anything that was already correctly deployed by hand in earlier exercises.

![ArgoCD resource tree for the-project, part 1: todo-backend/postgres/wiki-reminder/project-route all Synced/Healthy](./argocd-sync-1.png)
![ArgoCD resource tree for the-project, part 2: todo-app/todo-backend/broadcaster Services, Secrets and ConfigMap all Synced/Healthy](./argocd-sync-2.png)

**"enough that the main branch is deployed to cluster"** (the exercise's own scope) is satisfied by `syncPolicy.automated` alone: any commit pushed to `main` that touches one of the sourced paths is picked up and applied automatically, same live-tested behavior as `../log_output/README.md`'s exercise 4.7 section.

Verified by creating a new todo (`POST /todos`) with a distinctive marker text and finding it in Logs Explorer within seconds — both `todo-backend`'s `morgan` access-log line and its own `Received todo (...)` line (added in exercise 2.10) show up:

![GKE Logs Explorer showing the log line for a newly created todo](docs/gke-logs-new-todo.png)

## Exercise 4.2: probes and a "break the app" button

Chapter 5's readiness/liveness probe pattern (introduced for `../ping-pong`/`../log_output` in exercise 4.1) now applies to the project too:

- **`todo-backend`** gets a `readinessProbe` on a new `GET /healthz`, checking its Postgres connection — see `todo-backend/README.md`.
- **`todo-app`** gets a `readinessProbe` on a new `GET /ready` (checks it can reach `todo-backend`, cascading from the above) **and** a `livenessProbe` on a new `GET /healthz` (a self-contained `isHealthy` flag, deliberately independent of any other service) — see `todo-app/README.md` for the full picture, including the "break the app" button that flips that flag and the restart-then-recover test.

Tested exactly like exercise 4.1: scaling `postgres-stset` to 0 replicas and redeploying both apps brought them up `0/1`; scaling it back brought both to `1/1` automatically. Breaking `todo-app` via its button triggered an automatic liveness-restart and recovery, confirmed via `kubectl get pods --watch` and the `RESTARTS` counter.

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

The local k3d cluster doesn't use Kustomize or any of the GKE-specific manifests above — it uses the plain `kubectl apply -f <app>/manifests/...` workflow documented in each subfolder's own README, with its own `hostPath` PersistentVolume and `ClusterIP` Services. As of chapter 5, routing locally is via `manifests/gateway.yaml` (Envoy Gateway, Traefik is disabled on this cluster) rather than `todo-app/manifests/ingress.yaml` — see `todo-app/README.md`.
