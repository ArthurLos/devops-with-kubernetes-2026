# greeter

Chapter 6, exercise 5.3 ("Log app, the Service Mesh Edition"): a minimal Express app whose only route, `GET /`, returns a greeting as plain text — configurable via the `GREETING` env variable (defaults to `Hello`). `../log_output`'s reader fetches it over HTTP and displays it alongside the rest of its `/status` output (see that app's README).

Gets its own top-level folder rather than living inside `log_output/`, the same way `../ping-pong` does — a separate microservice `log_output` depends on, not a part of it.

## Two versions, split by weight

`manifests/deployment.yaml` deploys two versions as separate Deployments, `greeter-v1`/`greeter-v2` (labels `app: greeter`, `version: v1`/`v2`, the same convention as the Bookinfo sample app from exercise 5.2), each with its own `GREETING`:
- `greeter-v1`: `Hello from version 1`
- `greeter-v2`: `Hello from version 2`

`manifests/service.yaml` defines three Services:
- `greeter-svc-1` / `greeter-svc-2` — select one version each.
- `greeter-svc` — selects both versions (`app: greeter`), and is what `log_output` actually calls, and the `parentRefs` target for the traffic-splitting `HTTPRoute` below.

`manifests/greeter-split.yaml` is a Gateway API `HTTPRoute` whose `parentRefs` is the `greeter-svc` **Service** directly (not a `Gateway`) — the same mesh-internal traffic-splitting mechanism used for Bookinfo's `reviews` service in exercise 5.2 (`../service-mesh/reviews-split.yaml`) — splitting requests between `greeter-svc-1` (weight `75`) and `greeter-svc-2` (weight `25`) without any ingress gateway involved.

This requires the `exercises` namespace to have a waypoint enrolled (`istioctl waypoint apply --enroll-namespace --wait --namespace exercises`), since L7 HTTPRoute processing for a plain Service needs one — exactly as learned enforcing L7 `AuthorizationPolicy`s in exercise 5.2.

## Deploy

```bash
# build the image
docker build -t greeter:1.0.0 .
k3d image import greeter:1.0.0 -c <cluster-name>

# the exercises namespace must already be part of the ambient mesh (see ../service-mesh/README.md
# and ../log_output/README.md's "Exercise 5.3" section for the full namespace setup)
kubectl apply -f manifests/deployment.yaml
kubectl apply -f manifests/service.yaml
kubectl apply -f manifests/greeter-split.yaml
```

**Tested**: 100 requests against `greeter-svc` from the `curl` pod (`../service-mesh/curl/curl.yaml`) in the `default` namespace — cross-namespace works because `default` is ambient too, and the ambient data plane routes to a destination Service's waypoint regardless of which namespace the client is in:

```bash
kubectl exec deploy/curl -n default -- sh -c 'for i in $(seq 1 100); do curl -s http://greeter-svc.exercises.svc.cluster.local:3000/; echo; done' | sort | uniq -c
#      71  Hello from version 1   (≈71%, target 75%)
#      29  Hello from version 2   (≈29%, target 25%)
```

Close enough to the configured 75/25 split given normal sampling variance over 100 requests (same margin seen in exercise 5.2's 90/10 test). Also confirmed end-to-end through `../log_output`'s own `/status` endpoint — see that app's README — and visually in Kiali's traffic graph (namespace `exercises`).
