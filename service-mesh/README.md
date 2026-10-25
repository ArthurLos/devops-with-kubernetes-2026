# service-mesh

Exercise 5.2 ("Getting started with Istio service mesh"): installs [Istio](https://istio.io/) in **ambient mode** on the local k3d cluster and works through the official ambient getting-started guide — deploying the Bookinfo sample app, visualizing traffic with Kiali, enforcing L4/L7 authorization policies, and splitting traffic between service versions. Per the exercise instructions, this follows the guide up to (not including) its own "Clean up" step.

Doesn't depend on any other exercise; everything here runs in the `default` namespace (as the upstream guide itself uses), on the existing local k3d cluster — no new cluster needed for this one (unlike the later Knative exercise).

## Installing Istio

```bash
# istioctl itself - downloaded as a release tarball rather than the docs' own
# `curl | sh` one-liner (avoids piping a downloaded script straight into a shell)
curl -LO https://github.com/istio/istio/releases/download/1.31.3/istio-1.31.3-linux-amd64.tar.gz
tar xzf istio-1.31.3-linux-amd64.tar.gz
cp istio-1.31.3/bin/istioctl ~/.local/bin/

istioctl install --set profile=ambient --set values.global.platform=k3d --set values.cni.cniBinDir=/var/lib/rancher/k3s/data/cni --skip-confirmation
```

Gateway API CRDs were already present on this cluster (installed earlier for Envoy Gateway — exercise 4.x), so the guide's own `kubectl apply ... experimental-install.yaml` step wasn't needed.

### A real bug: `--set values.global.platform=k3d` installs the CNI binary to the wrong path

The [k3d platform prerequisites page](https://istio.io/latest/docs/ambient/install/platform-prerequisites/#k3d) says to pass `--set values.global.platform=k3d` so `istio-cni-node` copies its binary to k3d's actual CNI directory instead of the generic default. On this cluster (k3d running k3s v1.35.5), that preset still copied the binary to host path `/bin` (visible in the `istio-cni-node` logs as `Copied istio-cni to /host/opt/cni/bin`, which is bind-mounted from host `/bin`) — but the kubelet's actual CNI plugin search path is `/var/lib/rancher/k3s/data/cni`, confirmed directly:

```bash
docker exec k3d-k3s-default-server-0 ls /var/lib/rancher/k3s/data/cni/
# bandwidth -> /bin/cni, bridge -> /bin/cni, flannel -> /bin/cni, ... (no istio-cni)
```

Every new pod on every node failed with:

```
Failed to create pod sandbox: ... plugin type="istio-cni" name="istio-cni" failed (add): failed to find plugin "istio-cni" in path [/var/lib/rancher/k3s/data/cni]
```

**This is a chicken-and-egg problem once it happens**: `istio-cni-node` itself is a normal (non-`hostNetwork`) pod, so *its own* sandbox creation goes through the same broken CNI chain it's supposed to fix — a fresh `istio-cni-node` pod can't even start to install the binary in the first place. Worked around by manually copying the already-downloaded binary (present in every node's container at the wrong path, `/bin/istio-cni`, from the one pod that *did* start before this was diagnosed) to the correct path on all three nodes:

```bash
for node in k3d-k3s-default-server-0 k3d-k3s-default-agent-0 k3d-k3s-default-agent-1; do
  docker exec "$node" sh -c 'cp /bin/istio-cni /var/lib/rancher/k3s/data/cni/istio-cni && chmod +x /var/lib/rancher/k3s/data/cni/istio-cni'
done
```

Fixed properly going forward by explicitly overriding the bin dir rather than relying on the k3d preset: `--set values.cni.cniBinDir=/var/lib/rancher/k3s/data/cni` (shown in the install command above).

**A second-order effect**: every one of those hundreds of failed sandbox attempts had already asked flannel for an IP before failing at the `istio-cni` step, and the teardown of each failed attempt *also* went through the same broken chain and so never released it — flannel's IPAM pool (`/var/lib/cni/networks/cbr0/`, a /24 = 254 addresses) filled up completely on every node, so even pods unrelated to Istio stopped scheduling at all. Fixed by removing lease files whose owning container ID was no longer a real container (cross-checked against `crictl ps -a`, never a blind wipe):

```bash
LIVE_IDS=$(crictl ps -a -q)
cd /var/lib/cni/networks/cbr0
for f in $(ls | grep -v last_reserved_ip); do
  id=$(head -1 "$f")
  echo "$LIVE_IDS" | grep -q "^$id" || rm -f "$f"
done
```

After both fixes, every `istio-cni-node` DaemonSet pod came up clean and new pods scheduled normally everywhere.

## Deploy the Bookinfo sample app

```bash
kubectl apply -f bookinfo/bookinfo.yaml
kubectl apply -f bookinfo/bookinfo-versions.yaml
kubectl apply -f gateway-api/bookinfo-gateway.yaml
kubectl annotate gateway bookinfo-gateway networking.istio.io/service-type=ClusterIP --namespace=default
kubectl port-forward svc/bookinfo-gateway-istio 8080:80
```

**Tested**: all 6 Bookinfo pods (`details-v1`, `productpage-v1`, `ratings-v1`, `reviews-v1/v2/v3`) `1/1 Running`; `kubectl get gateway` showed `PROGRAMMED: True`; `curl http://localhost:8080/productpage` returned `200`.

## Secure and visualize

```bash
kubectl label namespace default istio.io/dataplane-mode=ambient
```

No pod restart needed — ambient mode's per-node `ztunnel` starts intercepting the namespace's traffic transparently. `curl http://localhost:8080/productpage` still returned `200` immediately after labeling, confirming this.

**Kiali**, reusing this cluster's existing Prometheus (installed in exercise 4.3, `monitoring` namespace) instead of deploying the addon's own second Prometheus instance:

```bash
# kiali.yaml here already has external_services.prometheus.url set to
# http://prom-prometheus-server.monitoring:80 - the upstream addon manifest
# defaults to an in-cluster Prometheus this setup doesn't have
kubectl apply -f kiali.yaml
istioctl dashboard kiali
```

**Tested**: sent 100 requests (`for i in $(seq 1 100); do curl -sSI -o /dev/null http://localhost:8080/productpage; done`), then confirmed in Kiali's Traffic Graph (namespace `default`) that the Bookinfo services and their traffic appeared, including mTLS status between services and per-edge L4 metrics.

## Enforce authorization policies

```bash
kubectl apply -f authz-policies/productpage-ztunnel.yaml   # L4: only the gateway's identity may reach productpage
kubectl apply -f curl/curl.yaml                             # a client with a different identity, to prove the policy
```

**Tested**: `kubectl exec deploy/curl -- curl -s http://productpage:9080/productpage` failed with `command terminated with exit code 56` — `curl`'s service account isn't in the L4 allowlist.

```bash
istioctl waypoint apply --enroll-namespace --wait            # per-namespace waypoint, needed for L7 policy
kubectl apply -f authz-policies/productpage-waypoint.yaml    # L7: only GET, only from the curl identity
# productpage-ztunnel.yaml above already includes the waypoint's own identity in its
# allowlist too, alongside the gateway's - needed once traffic routes through it
```

**Tested**, all three matching the guide's expected results exactly:
- `kubectl exec deploy/curl -- curl -s http://productpage:9080/productpage -X DELETE` → `RBAC: access denied` (wrong method)
- `kubectl exec deploy/reviews-v1 -- curl -s http://productpage:9080/productpage` → `RBAC: access denied` (wrong identity)
- `kubectl exec deploy/curl -- curl -s http://productpage:9080/productpage` → `<title>Simple Bookstore App</title>` (allowed)
- `curl http://localhost:8080/productpage` (via the gateway) still `200` throughout

## Manage traffic

```bash
kubectl apply -f reviews-split.yaml
```

A `HTTPRoute` whose `parentRefs` is the `reviews` **Service** directly (not a `Gateway`) — Gateway API's mesh-traffic-splitting mechanism, routing requests between `reviews-v1`/`reviews-v2` by weight without any ingress gateway involved.

**Tested**: 100 requests through the `curl` pod, counting which backend answered:

```bash
kubectl exec deploy/curl -- sh -c 'for i in $(seq 1 100); do curl -s http://productpage:9080/productpage | grep reviews-v.-; done' | sort | uniq -c
#     176  reviews-v1-...   (≈88%, target 90%)
#      24  reviews-v2-...   (≈12%, target 10%)
```

Close enough to the configured 90/10 split given normal sampling variance over 100 requests.

## Not yet done: Clean up

Per the exercise instructions ("follow the steps until Clean up"), the guide's own final "Clean up" section (removing Bookinfo/Kiali/policies) is intentionally **not** run here — Istio ambient itself and this setup stay in place for exercises 5.3/5.4, which build on it.
