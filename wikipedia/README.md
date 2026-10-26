# wikipedia

Chapter 6, exercise 5.4 ("Wikipedia with init and sidecar"): one Pod, three containers sharing an `emptyDir` volume mounted at `/www` (init container, sidecar) / `/usr/share/nginx/html` (main container) — the same shared-volume pattern as `../log_output`'s writer/reader from chapter 2, just with the Wikipedia page itself as the shared file instead of a status line.

No application source code here — every container uses a stock image (`nginx:alpine`, `curlimages/curl:8.16.0`, the same `curl` image already used in `../service-mesh/curl/curl.yaml`), configured entirely through `command`/`args` in `manifests/deployment.yaml`.

- **`nginx`** (main container) — serves whatever's in `/usr/share/nginx/html` as-is, no config of its own.
- **`fetch-kubernetes-page`** (plain init container) — `curl`s `https://en.wikipedia.org/wiki/Kubernetes` once into the shared volume, then exits. Runs to completion *before* `nginx` starts, so the main container never serves an empty webroot.
- **`random-page-refresher`** (**native sidecar**) — an `initContainers` entry with `restartPolicy: Always` (stable since Kubernetes 1.29, this cluster runs 1.35): Kubernetes starts it alongside the other init container but keeps it running for the Pod's entire lifetime instead of waiting for it to exit, and it counts toward the Pod's readiness like a regular container. In a loop, it sleeps a random 300-900 seconds (5-15 minutes) and then overwrites the shared file with a random article from `https://en.wikipedia.org/wiki/Special:Random`.

  ```sh
  while true; do
    sleep "$(( $(od -An -N2 -tu2 /dev/urandom) % 601 + 300 ))"
    curl -sL -o /www/index.html https://en.wikipedia.org/wiki/Special:Random
  done
  ```

  The random delay is computed from two bytes read directly off `/dev/urandom` rather than the shell's `$RANDOM`, since that's a `bash` extension not guaranteed to exist in every `/bin/sh` (the `curlimages/curl` image's is Alpine's BusyBox `ash`).

## Deploy

```bash
# the exercises namespace and shared Gateway must exist first (repo root)
kubectl apply -f ../manifests/namespace-exercises.yaml
kubectl apply -f ../manifests/gateway.yaml

kubectl apply -f manifests/deployment.yaml
kubectl apply -f manifests/service.yaml
kubectl apply -f manifests/gateway.yaml
kubectl rollout status deployment/wikipedia -n exercises
```

## Access it locally

Exposed via the shared `Gateway`/`HTTPRoute` (`../manifests/gateway.yaml`, same one `../log_output`/`../ping-pong` use), path `/wikipedia` rewritten to `/` (same `URLRewrite` pattern as `../ping-pong`'s `/pingpong`): `http://localhost:8081/wikipedia` (check your cluster's actual host-port mapping).

## Tested

```bash
# the init container ran to completion before nginx started, the sidecar kept running
kubectl get pod <pod> -n exercises -o jsonpath='{range .status.initContainerStatuses[*]}{.name}{"\t"}{.state}{"\n"}{end}'
# fetch-kubernetes-page    {"terminated":{...,"exitCode":0,"reason":"Completed",...}}
# random-page-refresher    {"running":{...}}

curl -s http://localhost:8081/wikipedia | grep -o '<title>.*</title>'
# <title>Kubernetes - Wikipedia</title>
```

Then, to verify the sidecar's actual overwrite behavior without waiting the full 5-15 minutes, ran its exact `curl` command manually inside the running sidecar container:

```bash
kubectl exec -n exercises <pod> -c random-page-refresher -- curl -sL -o /www/index.html https://en.wikipedia.org/wiki/Special:Random
curl -s http://localhost:8081/wikipedia | grep -o '<title>.*</title>'
# <title>878th Engineer Battalion (United States) - Wikipedia</title>
```

Confirms the whole chain works: the sidecar can reach Wikipedia, overwrite the shared file nginx is serving, and the new content is visible immediately — no Pod restart or nginx reload needed, since nginx just serves whatever's on disk at request time.
