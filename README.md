# KubernetesSubmissions

Submissions for the DevOps with Kubernetes course.

Structure:
- `log_output/` — the logging exercise project (early exercises)
- `ping-pong/` — simple counter app, sharing an Ingress with `log_output`
- `the_project/` — the main course project, growing over time (contains one subfolder per microservice, e.g. `todo-app/`). As of exercise 3.5, deployed to GKE as one unit via Kustomize (`the_project/kustomization.yaml`) — see `the_project/README.md`.
- `manifests/` — manifests that are either shared across apps or inherently cluster/admin-level (Namespaces, PersistentVolumes). Includes the two Namespaces (see below), the Ingress shared by `log_output` and `ping-pong`, and `todo-app`'s own PersistentVolume/Claim for its cached picture (not app-specific resources, so kept separate from `todo-app`'s own `manifests/` folder even though only it uses this PV). `ping-pong`'s counter moved from its own PV to a Postgres `StatefulSet` in exercise 2.7 — see `ping-pong/manifests/`.

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
