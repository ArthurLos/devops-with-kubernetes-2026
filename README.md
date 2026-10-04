# KubernetesSubmissions

Submissions for the DevOps with Kubernetes course.

Structure:
- `log_output/` — the logging exercise project (early exercises)
- `ping-pong/` — simple counter app, sharing an Ingress with `log_output`
- `the_project/` — the main course project, growing over time (contains one subfolder per microservice, e.g. `todo-app/`)
- `manifests/` — manifests that are either shared across apps or inherently cluster/admin-level (PersistentVolumes). Includes the Ingress shared by `log_output` and `ping-pong`, the PersistentVolume/Claim shared between them for `ping-pong`'s request counter, and `todo-app`'s own PersistentVolume/Claim for its cached picture (not shared with other apps, but still kept here since PVs aren't app-specific resources). App-specific manifests live in each app's own `manifests/` folder.

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
