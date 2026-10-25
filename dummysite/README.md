# dummysite

Exercise 5.1 ("DIY CRD & Controller"): a `DummySite` Custom Resource Definition and a controller for it. Creating a `DummySite` with a `website_url` makes a served copy of that page appear in the cluster — the controller fetches the HTML once and stands up everything needed to serve it, with no further app-specific code per site. A small `ui/` web app is a nicer way to create one than hand-writing YAML: type a URL, it creates the `DummySite` and opens the result in a new tab.

Doesn't depend on any other exercise; deployed into the existing `exercises` namespace (see `../manifests/namespace-exercises.yaml`) since it's a standalone chapter exercise, same as `../log_output`/`../ping-pong`.

## Structure

- **`controller/`** — the actual exercise: watches `DummySite` objects and reconciles them into a served copy.
- **`ui/`** — not required by the exercise, but a much nicer way to use it than writing a `DummySite` YAML by hand: a form that creates one and opens it.
- **`manifests/`** — one file per logical unit: the CRD, each component's RBAC, each component's Deployment(+Service), and the Gateway route for the UI.

## How the controller works

- **`manifests/crd.yaml`** — the `DummySite` CustomResourceDefinition itself: group `stable.dwk` (same convention as the course's own `Countdown` example), namespaced, one required field `spec.website_url` (string).
- **`controller/index.js`** — a long-running process, independent of whether any `DummySite` exists yet (same as any built-in Kubernetes controller):
  1. On startup, lists existing `DummySite` objects once (`CustomObjectsApi.listClusterCustomObject`) and reconciles each — a `watch` alone only reports events for objects created *after* it connects, so without this, a controller restart would silently ignore `DummySite`s that already existed.
  2. Opens a watch on `/apis/stable.dwk/v1/dummysites` (via `@kubernetes/client-node`'s `Watch` class) and reconciles every `ADDED` event the same way, live.
  3. **Reconcile** = fetch `spec.website_url`'s HTML (plain `fetch`, no asset rewriting — per the exercise, a broken-CSS copy of a complex page like Wikipedia is fine), then create a `ConfigMap` (`<name>-html`, holding the fetched HTML as `index.html`), a `Deployment` (`<name>-dep`, a single `nginx:alpine` replica serving that ConfigMap as its webroot), and a `Service` (`<name>-svc`, `ClusterIP` port 80) — "all of the resources required for the functionality", per the exercise.
  4. Every created resource carries an `ownerReference` back to the `DummySite` that caused it. **No delete-handling code exists in the controller at all** — deleting a `DummySite` lets Kubernetes' own garbage collector cascade-delete the ConfigMap/Deployment/Service/Pod automatically. Verified: `kubectl delete -f manifests/example-dummysite.yaml` left nothing behind.
  5. Creation calls are idempotent (a `409 Conflict` from an already-existing resource, e.g. after a controller restart re-reconciling the same `DummySite`, is caught and ignored) — matches "the controller doesn't have to work perfectly in all circumstances".
- **`manifests/controller-rbac.yaml`** — `ServiceAccount` + `ClusterRole` + `ClusterRoleBinding`: `get/list/create` on `configmaps`/`services` (core) and `deployments` (`apps`), `get/list/watch` on `dummysites` (`stable.dwk`). A `ClusterRole` (not a namespaced `Role`) because `DummySite`s — like the course's own `Countdown` example — can be created in any namespace, not just `exercises`.
- **`manifests/controller-deployment.yaml`** — the controller's own `Deployment` (1 replica). Its own replica count is completely independent of how many `DummySite`s exist — one controller instance manages any number of them.

## How the UI works

- **`ui/index.js`** — three routes:
  - `GET /` — a plain HTML form, one `url` input, `method="POST"` to `/create`, `target="_blank"` so submitting it opens a new tab without navigating away from the form.
  - `POST /create` — generates a short random name (`site-<8 hex chars>`), creates a `DummySite` with it via `CustomObjectsApi.createNamespacedCustomObject` (this is the *only* permission the UI needs — see `manifests/ui-rbac.yaml`), then redirects to `/sites/<name>/`.
  - `GET /sites/:name/*` — a small reverse proxy to `<name>-svc` (the Service `controller/` creates for that `DummySite`). The controller's own reconcile takes a moment (fetch + create three resources), so the Service may not exist/resolve yet when the new tab first opens — one proxy attempt per request; on failure, immediately returns a self-refreshing "still creating..." page (`<meta http-equiv="refresh" content="2">`) rather than a bare connection error, so the *browser* is what retries, as real, visible page loads, until the Service answers. (A server-side retry loop was tried first and dropped — it blocks a single request behind the scenes, so the wait page would only ever render after giving up entirely, never while actually waiting.)
- **`manifests/ui-rbac.yaml`** — a namespaced `Role`/`RoleBinding` (not a `ClusterRole`): the UI only ever creates `DummySite`s in its own namespace, unlike the controller, which has to watch every namespace.
- **`manifests/ui-deployment.yaml`** — `Deployment` + `Service` for the UI itself.
- **`manifests/gateway.yaml`** — exposes the UI on the shared Gateway (`../manifests/gateway.yaml`) under `/dummysite`, same pattern as `../ping-pong`'s `/pingpong`: a `URLRewrite` filter strips the prefix before it reaches `dummysite-ui-svc`, so the app itself only ever sees `/`, `/create`, `/sites/<name>`.

  **One wrinkle `../ping-pong` doesn't have**: a `URLRewrite` only rewrites the *request* path on the way in — it does nothing to a redirect's `Location` header or a form's `action`, both of which go straight back to the browser untouched. Without accounting for this, `POST /dummysite/create`'s internally-generated redirect to `/sites/<name>/` would send the browser to `$HOST/sites/<name>/` (escaping the `/dummysite` prefix entirely) instead of `$HOST/dummysite/sites/<name>/`. Fixed with a `BASE_PATH` env var (`/dummysite`, set in `manifests/ui-deployment.yaml`) that the app prepends to anything it emits itself (the form's `action`, the redirect's `Location`) — a very standard pattern for apps served behind a path-prefixing reverse proxy (e.g. Grafana's own `root_url`/`serve_from_sub_path` settings, used elsewhere in this repo's `monitoring/` setup, solve the exact same problem).

## Choosing a client

Used the official [`@kubernetes/client-node`](https://github.com/kubernetes-client/javascript) library (both `controller/` and `ui/`) rather than raw `fetch` calls against the REST API directly (the course's own JavaScript example material does this, since it predates a usable JS client) — it's actively maintained and handles auth/TLS against the API server and the `watch` long-poll connection for us. `KubeConfig.loadFromCluster()` is used when running as a Pod (detected via `KUBERNETES_SERVICE_HOST`), `loadFromDefault()` otherwise (for anyone running it locally against their own `~/.kube/config`).

## Build and deploy

```bash
# controller
docker build -t dummysite-controller:1.0.0 controller/
k3d image import dummysite-controller:1.0.0 -c <cluster-name>

# ui
docker build -t dummysite-ui:1.0.0 ui/
k3d image import dummysite-ui:1.0.0 -c <cluster-name>

# workflow the exercise itself specifies: role/account/binding, then the
# deployment, then only then a DummySite - the controller must already be
# watching before anything can react to it
kubectl apply -f manifests/crd.yaml
kubectl apply -f manifests/controller-rbac.yaml
kubectl apply -f manifests/controller-deployment.yaml

# the UI is additional, not part of the exercise's own required workflow
kubectl apply -f manifests/ui-rbac.yaml
kubectl apply -f manifests/ui-deployment.yaml
kubectl apply -f manifests/gateway.yaml

kubectl apply -f manifests/example-dummysite.yaml
```

## Access it locally

- UI: exposed via the shared `Gateway`/`HTTPRoute`, e.g. `http://localhost:8081/dummysite` — check your cluster's port mapping.
- A specific site created through it: `http://localhost:8081/dummysite/sites/<name>/`.
- Without the UI, directly: `kubectl port-forward -n exercises svc/<name>-svc 8099:80`.

## Testing

```bash
kubectl get dummysites -n exercises    # or: kubectl get ds -n exercises (shortName)
kubectl logs -n exercises -l app=dummysite-controller -f
```

**`manifests/example-dummysite.yaml`** (`https://example.com/`, the exercise's own first test case): controller logged `Reconciling DummySite exercises/example -> https://example.com/` then `... ready: Service example-svc serves the copy`; `configmap/example-html`, `deployment.apps/example-dep` (`1/1`), and `service/example-svc` all appeared; a `curl` from inside the cluster against `example-svc` returned the real example.com page.

**`manifests/example-wikipedia-dummysite.yaml`** (`https://en.wikipedia.org/wiki/Kubernetes`, the exercise's own "more complex website" test case): same flow, `wikipedia-kubernetes-svc` served `200` with ~585 KiB of HTML (Wikipedia's own CSS/JS isn't fetched, so it renders unstyled — explicitly acceptable per the exercise's own example). Both of these are kept as separate manifests specifically because the exercise instructions name both test cases individually.

**Deletion**: `kubectl delete -f manifests/example-dummysite.yaml` removed the `ConfigMap`, `Deployment`, `Pod`, and `Service` along with it — pure Kubernetes garbage collection via the `ownerReference`s, no code in the controller handled this.

**The UI, end-to-end, through the real Gateway path** (not a direct Service port-forward):

```bash
curl -i -X POST http://localhost:8081/dummysite/create -d 'url=https://example.com/'
# HTTP/1.1 302 Found
# location: /dummysite/sites/site-10f9df2a/

curl http://localhost:8081/dummysite/sites/site-10f9df2a/
# <!doctype html>...<title>Example Domain</title>...
```

Confirmed the `Location` header correctly included the `/dummysite` prefix (the `BASE_PATH` fix above) and that following it actually served the copied page — not just that the create call succeeded.
