# KubernetesSubmissions

Submissions for the DevOps with Kubernetes course.

Structure:
- `log_output/` — the logging exercise project (early exercises)
- `ping-pong/` — simple counter app, sharing a Gateway with `log_output`
- `the_project/` — the main course project, growing over time (contains one subfolder per microservice, e.g. `todo-app/`). As of exercise 3.5, deployed to GKE as one unit via Kustomize (`the_project/kustomization.yaml`) — see `the_project/README.md`. As of exercise 4.10, its Kubernetes configuration lives in a separate repository (see below) — this folder keeps only application source code.
- `manifests/` — manifests that are either shared across apps or inherently cluster/admin-level (Namespaces, PersistentVolumes). Includes the two Namespaces (see below), the Gateway/HTTPRoute shared by `log_output` and `ping-pong` (`gateway.yaml`, see note below), and `todo-app`'s own PersistentVolume/Claim for its cached picture (not app-specific resources, so kept separate from `todo-app`'s own `manifests/` folder even though only it uses this PV). `ping-pong`'s counter moved from its own PV to a Postgres `StatefulSet` in exercise 2.7 — see `ping-pong/manifests/`.
- `monitoring-query/` — exercise 4.3's Prometheus/Helm write-up and query result (the Helm values files it refers to live in the gitignored, not-graded `monitoring/` folder — chapter 3 reading material).
- `dummysite/` — chapter 6, exercise 5.1: a `DummySite` Custom Resource Definition and a hand-written controller for it. Standalone, deployed to the `exercises` namespace — see `dummysite/README.md`.

**NATS (chapter 5, exercise 4.6):** installed locally via Helm (`helm install my-nats nats/nats --namespace nats --create-namespace --set promExporter.enabled=true`), same as the course's "Messaging systems" reading material. `the_project/todo-backend` publishes todo create/update events to it; `the_project/broadcaster` is a new service that subscribes and forwards them to an external chat service — see `the_project/broadcaster/README.md`. Prometheus/Grafana scrape and visualize NATS' own metrics too, via the gitignored `monitoring/prom-values.yaml` and `monitoring/grafana-values.yaml` (same not-graded chapter-3 reading-material files `monitoring-query/` already refers to).

**GitOps (chapter 5, exercises 4.7-4.9):** [ArgoCD](https://argo-cd.readthedocs.io/) runs locally on the same k3d cluster (`kubectl create namespace argocd` + `kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml`, reachable at `https://localhost:8443` via `kubectl port-forward -n argocd svc/argocd-server 8443:443` — no GKE/cloud component, per the decision to keep chapter 5 entirely local). `log_output/argocd-application.yaml` registers that app as an ArgoCD `Application` watching this repo's `main` branch with `automated: {prune: true, selfHeal: true}` — see that folder's README ("Exercise 4.7") for the full explanation, including a live test of commit → auto-deploy with no manual `kubectl apply`.

As of exercise 4.9, `the_project` runs as two separate environments instead of one: a staging environment tracking `main`, and a production environment tracking a `production` branch (moved by a `promote-production` workflow whenever a `v*` tag is pushed) — see `the_project/README.md`'s "Exercise 4.9" section for the full design (Kustomize overlays, why, and the staging-only/production-only differences) and a live test of the whole promotion chain.

As of exercise 4.10, all of that — every Kubernetes manifest, the Kustomize overlays, both ArgoCD `Application` definitions, and the promotion workflow — lives in a **separate repository**, **[ArthurLos/the-project-config](https://github.com/ArthurLos/the-project-config)**, not this one. This repo keeps only `the_project`'s application source code and Dockerfiles. See `the_project/README.md`'s "Exercise 4.10" section for why and the live re-verification after the move.

**Local cluster note (chapter 5):** the local k3d cluster now runs with Traefik disabled and [Envoy Gateway](https://gateway.envoyproxy.io/) installed instead (`kubectl apply -f https://github.com/envoyproxy/gateway/releases/latest/download/install.yaml`, plus a `GatewayClass` named `eg`), since several apps (`ping-pong`) rely on Gateway API's `URLRewrite` filter, which plain Ingress has no equivalent for. Routing locally is now via `manifests/gateway.yaml` (one shared `Gateway` for `log_output`+`ping-pong`) and an `HTTPRoute` for `the_project` attached to that same Gateway — k3d's `ServiceLB` can only bind one Gateway's `LoadBalancer` Service to host port 80 (as of exercise 4.10, that `HTTPRoute` is `production-route` in [the-project-config](https://github.com/ArthurLos/the-project-config)'s `overlays/production/gateway.yaml`, not in this repo). The old `manifests/ingress.yaml` and `the_project/todo-app/manifests/ingress.yaml` are no longer used locally, kept only for historical reference and the exercise tags that predate this change.

Namespaces:
- `exercises` (since 2.3) — `log_output` and `ping-pong`, i.e. everything from the standalone course exercises (outside the project). Used for all future exercises outside `the_project`.
- `project` (since 2.4) — everything in `the_project` (`todo-app`, `todo-backend`). Used for all future project-related exercises.
- `default` — left untouched, only used for ad-hoc course reading material (e.g. `busybox`), not for any graded exercise.

Each finished exercise gets a git tag named after the exercise (e.g. `1.1`, `1.2`, ...) on the commit that completes it. The table below links each exercise to its tag.

## Exercises

### Chapter 2

- [1.1.](https://github.com/ArthurLos/devops-with-kubernetes-2026/tree/1.1/log_output)
- [1.2.](https://github.com/ArthurLos/devops-with-kubernetes-2026/tree/1.2/the_project)
- [1.3.](https://github.com/ArthurLos/devops-with-kubernetes-2026/tree/1.3/log_output)
- [1.4.](https://github.com/ArthurLos/devops-with-kubernetes-2026/tree/1.4/the_project)
- [1.5.](https://github.com/ArthurLos/devops-with-kubernetes-2026/tree/1.5/the_project)
- [1.6.](https://github.com/ArthurLos/devops-with-kubernetes-2026/tree/1.6/the_project)
- [1.7.](https://github.com/ArthurLos/devops-with-kubernetes-2026/tree/1.7/log_output)
- [1.8.](https://github.com/ArthurLos/devops-with-kubernetes-2026/tree/1.8/the_project)
- [1.9.](https://github.com/ArthurLos/devops-with-kubernetes-2026/tree/1.9/ping-pong)
- [1.10.](https://github.com/ArthurLos/devops-with-kubernetes-2026/tree/1.10/log_output)
- [1.11.](https://github.com/ArthurLos/devops-with-kubernetes-2026/tree/1.11/ping-pong)
- [1.12.](https://github.com/ArthurLos/devops-with-kubernetes-2026/tree/1.12/the_project)
- [1.13.](https://github.com/ArthurLos/devops-with-kubernetes-2026/tree/1.13/the_project)

### Chapter 3

- [2.1.](https://github.com/ArthurLos/devops-with-kubernetes-2026/tree/2.1/ping-pong)
- [2.2.](https://github.com/ArthurLos/devops-with-kubernetes-2026/tree/2.2/the_project)
- [2.3.](https://github.com/ArthurLos/devops-with-kubernetes-2026/tree/2.3/manifests)
- [2.4.](https://github.com/ArthurLos/devops-with-kubernetes-2026/tree/2.4/the_project)
- [2.5.](https://github.com/ArthurLos/devops-with-kubernetes-2026/tree/2.5/log_output)
- [2.6.](https://github.com/ArthurLos/devops-with-kubernetes-2026/tree/2.6/the_project)
- [2.7.](https://github.com/ArthurLos/devops-with-kubernetes-2026/tree/2.7/ping-pong)
- [2.8.](https://github.com/ArthurLos/devops-with-kubernetes-2026/tree/2.8/the_project)
- [2.9.](https://github.com/ArthurLos/devops-with-kubernetes-2026/tree/2.9/the_project)
- [2.10.](https://github.com/ArthurLos/devops-with-kubernetes-2026/tree/2.10/the_project)

### Chapter 4

- [3.1.](https://github.com/ArthurLos/devops-with-kubernetes-2026/tree/3.1/ping-pong)
- [3.2.](https://github.com/ArthurLos/devops-with-kubernetes-2026/tree/3.2/log_output)
- [3.3.](https://github.com/ArthurLos/devops-with-kubernetes-2026/tree/3.3/manifests)
- [3.4.](https://github.com/ArthurLos/devops-with-kubernetes-2026/tree/3.4/ping-pong)
- [3.5.](https://github.com/ArthurLos/devops-with-kubernetes-2026/tree/3.5/the_project)
- [3.6.](https://github.com/ArthurLos/devops-with-kubernetes-2026/tree/3.6/the_project)
- [3.7.](https://github.com/ArthurLos/devops-with-kubernetes-2026/tree/3.7/the_project)
- [3.8.](https://github.com/ArthurLos/devops-with-kubernetes-2026/tree/3.8/.github)
- [3.9.](https://github.com/ArthurLos/devops-with-kubernetes-2026/tree/3.9/the_project)
- [3.10.](https://github.com/ArthurLos/devops-with-kubernetes-2026/tree/3.10/the_project)
- [3.11.](https://github.com/ArthurLos/devops-with-kubernetes-2026/tree/3.11/the_project)
- [3.12.](https://github.com/ArthurLos/devops-with-kubernetes-2026/tree/3.12/the_project)

### Chapter 5

- [4.1.](https://github.com/ArthurLos/devops-with-kubernetes-2026/tree/4.1/ping-pong)
- [4.2.](https://github.com/ArthurLos/devops-with-kubernetes-2026/tree/4.2/the_project)
- [4.3.](https://github.com/ArthurLos/devops-with-kubernetes-2026/tree/4.3/monitoring-query)
- [4.4.](https://github.com/ArthurLos/devops-with-kubernetes-2026/tree/4.4/ping-pong)
- [4.5.](https://github.com/ArthurLos/devops-with-kubernetes-2026/tree/4.5/the_project)
- [4.6.](https://github.com/ArthurLos/devops-with-kubernetes-2026/tree/4.6/the_project/broadcaster)
- [4.7.](https://github.com/ArthurLos/devops-with-kubernetes-2026/tree/4.7/log_output)
- [4.8.](https://github.com/ArthurLos/devops-with-kubernetes-2026/tree/4.8/the_project)
- [4.9.](https://github.com/ArthurLos/devops-with-kubernetes-2026/tree/4.9/the_project)
- [4.10.](https://github.com/ArthurLos/devops-with-kubernetes-2026/tree/4.10/the_project)

### Chapter 6

- [5.1.](https://github.com/ArthurLos/devops-with-kubernetes-2026/tree/5.1/dummysite)
