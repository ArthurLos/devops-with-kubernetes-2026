# wiki-reminder

A `CronJob` (`manifests/cronjob.yaml`) that runs once an hour and adds a todo to `../todo-backend` reminding you to read a random Wikipedia article: `Read <url>`.

`add-random-todo.sh` does the actual work:
1. Requests `https://en.wikipedia.org/wiki/Special:Random`, which responds with a redirect (no body) to a random article. `curl -w '%{redirect_url}'` reads that `Location` header for us instead of fetching the page itself.
2. POSTs `{"text": "Read <url>"}` to `$TODO_BACKEND_URL` (`../todo-backend`'s `POST /todos`).

Configuration is entirely via the `TODO_BACKEND_URL` environment variable (no hardcoded URLs in the script, consistent with exercise 2.6's project-wide rule) — set in `manifests/cronjob.yaml` to `http://todo-backend-svc:2345/todos`.

As of exercise 2.4's `project` namespace split, this runs in `project` alongside `../todo-app` and `../todo-backend` (see `../../manifests/namespace-project.yaml`).

## Build and deploy

**As of exercise 4.10**, this section's old `kubectl apply -f manifests/...` steps no longer apply — this app's manifests moved to [ArthurLos/the-project-config](https://github.com/ArthurLos/the-project-config) (see `../README.md`'s "Exercise 4.10"). Deployment is now via ArgoCD; this section only still covers building and locally importing the image:

```bash
# build the image (bump the tag when the script changes)
docker build -t wiki-reminder:1.0.0 .

# get cluster name if you don't know it
k3d cluster list

# load it into your local cluster
k3d image import wiki-reminder:1.0.0 -c <cluster-name>

# bump the image tag in the-project-config's wiki-reminder/manifests/cronjob.yaml
# to match, commit and push - ArgoCD picks it up automatically

# confirm it's scheduled
kubectl get cronjobs -n staging    # or -n production
```

## Testing

A `CronJob` only fires on schedule (every hour here), so to test it immediately, trigger a one-off `Job` from it instead of waiting:

```bash
kubectl create job -n project --from=cronjob/wiki-reminder wiki-reminder-manual-test

kubectl get jobs -n project
kubectl logs -n project job/wiki-reminder-manual-test

# clean up the test job (the CronJob itself keeps running on schedule)
kubectl delete job -n project wiki-reminder-manual-test
```

`concurrencyPolicy: Forbid` skips a scheduled run if the previous one is still going (shouldn't normally happen, this job finishes in seconds). `backoffLimit: 2` lets a failed run (e.g. Wikipedia or todo-backend briefly unreachable) retry a couple of times before giving up for that hour.
