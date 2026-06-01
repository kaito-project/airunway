# AI Runway — Projects + AKS Overlay (Headlamp)

**Date:** 2026-05-29
**Status:** Draft for stakeholder review
**Home repo:** `kaito-project/airunway` (controller + plugins live here)

---

## TL;DR

AI Runway today deploys ML models well but does not give operators an
*application* view. v1 of this work adds three things to the Headlamp
plugin: a **Project** CRD (label-selector grouping of the resources
that make up one ML app), a **Project-scoped Observability tab** that
unifies inference-server
metrics and Inspektor Gadget kernel diagnostics, and an **AKS overlay**
that wires KAITO, Workload Identity, ACR, Gateway API, and an Azure
OpenAI credential helper — *without any cloud-provider SDK dependency, ever*.
Azure-specific facts come from K8s labels, CR status, and Portal
deep-links. Everything optional fails open with a call-to-action.
A real topology view of each Project is a v1.0 stretch goal.

---

## 0. Prerequisites — plugin UX work that must land first

This spec sits on top of the existing Headlamp plugin and assumes it
behaves correctly per-cluster and doesn't crash on the deployments
list. Several findings in
[plugins/headlamp/docs/ux-improvements-spec.md](../plugins/headlamp/docs/ux-improvements-spec.md)
are genuine blockers for the Project work; others are quality-of-life
items we can land alongside. Calling them out so this v1 doesn't get
built on a broken base.

**Hard blockers — must land before v1.0 Project work starts:**

| Item | Why it blocks |
|---|---|
| **Open architectural question (UX spec §0)** — is this a Headlamp plugin at all, or should the Web UI ship standalone / behind a sidebar link? | **Resolved: continue as a Headlamp plugin.** The entire Layer-A/B architecture (§4), sidebar placement (§14.2), AKS overlay as a Headlamp plugin (§9), and IG-via-K8s-proxy data path (§8) all presume this answer, and v1.0 commits to it. If the project ever reopens this question, this spec needs a full revisit — flagged in §15 risks. |
| **UX spec P0-0 — per-cluster backend configuration** | We assume the backend is reached "via the K8s API proxy" (§4 / §11). Today the backend URL is a global plugin setting that ignores Headlamp's cluster context. Projects, app metrics, and detection probes all silently target the wrong cluster on a context switch. The §1 success criterion "every Project page renders without errors" cannot hold while this is broken. |
| **UX spec P0-1 — deployments list crash + namespace filter** | The Projects list and Resources tab (§5) follow the same list-rendering shape as `DeploymentsList`. Shipping new list views on top of the same crash mode would double the exposure. Fix the underlying defensive-property-access pattern once. |

**Soft prerequisites — should land before or during early v1.0 steps:**

| Item | Why it matters here |
|---|---|
| **UX spec P0-2 — settings consolidated to one location** | The §7.1 detection-registry overrides and the §8 `ig-recommended.json` override both live in plugin settings. Two competing Settings entries makes that surface ambiguous. |
| **UX spec P0-3 — single `useAutoRefresh` hook** | The Project chip (§6), resource counts (§5 status), and IG run results all need polling. We should consume the shared hook rather than add a fourth `setInterval` pattern. |
| **UX spec P1-1 — rebuild deployment detail on Headlamp's detail layout** | Aligns the "Don't re-implement Headlamp" principle (§3.5) for the existing surface; the new Project detail (§5) should adopt the same layout pattern, not invent its own. |

**Out of v1.0 scope but tracked:** UX spec P1-2 (in-plugin
port-forward), P1-3 (`ConnectionBanner` copy fixes), and all P2 items
are independent of the Project work and follow their own track.

**Sequencing note (revises §10 build order):** Step 1 (Project CRD +
controller) and step 2a (Projects list / Resources tab) cannot start
until UX P0-0 + P0-1 have landed. The AKS overlay scaffolding in step 4
can proceed independently of UX P0-2 / P0-3, but the plugin's day-2
pages built in steps 2a / 3 should consume the shared `useAutoRefresh`
hook (P0-3) from the start. See the new **v0.9 prerequisite phase** in
§10 for the explicit dependency.

---

## 1. Problem & goals

### Problem

AI Runway today gives operators a unified `ModelDeployment` CRD across
several inference providers, but a real ML application is almost never *one*
ModelDeployment. It is a model **plus** an app pod, **plus** a PVC for
weights or RAG indexes, **plus** a Service / HTTPRoute, **plus** secrets.
Headlamp shows these as scattered resources with no grouping, no
application-level health, and no AI-aware diagnostics. Two pain points
follow:

1. **No application identity.** Operators can't answer "what does the
   *Customer-Support RAG* app look like, and is it healthy?" without a
   mental join across kinds.
2. **No AI-aware observability.** Inference-server metrics (TTFT, KV-cache,
   tokens/s) live behind raw `/metrics` endpoints; kernel-level signals
   (DNS to HuggingFace, OOM-kills, model-weight I/O) are not surfaced at
   all. Operators reach for kubectl, Grafana, and Inspektor Gadget
   manually.

### Goals (v1)

- **Project as a first-class grouping** so an operator can see one ML
  application end-to-end and bulk-act on it.
- **Two-pane observability** scoped to a Project: app metrics from the
  inference engine, kernel diagnostics from Inspektor Gadget.
- **AKS-aware deploy glue** that removes the most common Azure
  paper-cuts (KAITO preset, Workload Identity, ACR, HTTPRoute, AOAI
  credential helper) without any cloud-provider SDK dep.

(Graceful degradation across all optional dependencies is treated as a
design principle, not a goal — see §3.)

### Non-goals (v1)

Replacing AI Runway's deploy wizard · generic IG browser · alerting /
on-call · GitOps integration · multi-cluster Project views · *any* cloud
SDK use (Azure ARM, AWS, GCP) · long-term metric / gadget-result
persistence.

### Success criteria

- **Release-gate demo (manual, run by the release driver before v1.0
  ships).** On a real AKS cluster with KAITO + IG pre-installed, a
  documented "fresh AKS demo script" executes end-to-end: each step
  in §9 deploy glue succeeds, the resulting Project shows up in the
  Projects list with Ready status, and the TTFT panel renders. No
  time bound — the gate is "all steps pass." Cluster-creation steps
  themselves are out of scope per the cloud-neutral rule (§3.5).
- **CI-enforced functional check.** Given a Project + ModelDeployment
  applied via YAML against the fixture corpus, the Projects list
  renders the new Project with the right resource counts and Ready
  status. (Real perf budgets / TTI gates are deferred to v1.1 — see
  §12.)
- On a cluster with the AI Runway backend installed (a required
  install-time dep — see §3 / §6) but **none** of the other optional
  pieces (no Prometheus, no IG, no KAITO, no Gateway API), every
  Project page still renders without errors and shows actionable CTAs.
- The AKS overlay can be pulled out into its own repo later as a config
  change, not a refactor (enforced by the import-direction lint rule,
  §4, and the cloud-neutral data-path rule, §3).

---

## 2. Personas

| Persona | Primary job | What they need from this work |
|---|---|---|
| **Platform engineer** (primary) | Runs the cluster; installs AI Runway, KAITO, IG; troubleshoots when ML eng pings them | Cluster-wide Projects view, deep diagnostics (IG), AKS glue that cuts ticket volume |
| **ML engineer** (secondary) | Owns one app (a Project); pushes new model versions; reads metrics | Project URL they can bookmark; TTFT / throughput / queue depth; "is my model healthy" at a glance |
| **Eng manager** (tertiary, read-only) | Wants a status overview before standup | Projects list with Ready / Degraded chips; no need to touch IG or AKS detail |

UX detailing optimizes for the platform engineer; ML-engineer access is via
shareable Project URLs (no separate role-restricted view in v1).

---

## 3. Key design principles

1. **Two data planes, treated independently.** AI-workload signal comes
   from two distinct sources: the **application-metrics plane** (TTFT,
   TPOT, tokens/s, KV-cache — emitted by the inference server on its
   Prometheus endpoint, served to the plugin through the AI Runway
   backend) and the **kernel/eBPF plane** (DNS, TCP, OOM, file-I/O —
   emitted by Inspektor Gadget). They have independent availability and
   never substitute for each other. IG cannot produce TTFT; an
   inference server cannot tell you why DNS to HuggingFace is slow.
2. **Inspektor Gadget is provider-neutral.** IG lives in the **core**
   plugin, scoped to a Project, on any Kubernetes distribution. The AKS
   overlay only adds AKS-*flavored enrichers* on top (GPU-SKU fit,
   NCCL flagging on Azure GPU pools).
3. **Project is a CRD with label-selector membership** — not
   namespace-as-Project. The CRD gives the UI a real object to watch,
   supports multiple-Projects-per-namespace, and leaves room for status
   aggregation and (later) ownerRef-style cascades. Membership is a
   single label `airunway.ai/project=<name>`; a resource belongs to
   exactly one Project in v1 (§5). Multi-Project membership is a
   deliberate v1.1+ question.
4. **Graceful degradation is a hard requirement.** Every optional
   dependency (IG, Prometheus, KAITO, Gateway API, AKS itself) is
   detected; missing = inline CTA; never a crash. The AI Runway
   backend is the one exception: it is a required install-time
   component (see §6), and its absence is surfaced as "Install or
   repair AI Runway backend" rather than as silent partial
   functionality.

   **Rendering surface — one shared component.** All "missing
   dependency" empty states render through a single
   `MissingDependency` component:

   ```ts
   <MissingDependency
     probe="ig"                       // §7.1 registry key
     title="Inspektor Gadget not installed"
     body="Kernel-level diagnostics need IG running in this cluster."
     primaryCta={{ label: "Install IG", href: "..." }}
     secondaryCta={{ label: "Learn more", href: "..." }}
   />
   ```

   - Used **inline inside the panel** that depends on the probe
     (panel header still renders so the user sees what's missing;
     body is the empty state). No tab-level banners, no greyed-out
     panel previews.
   - Per-dep copy lives with the probe definition in the §7.1
     registry (the existing `"what's missing" CTA` field). One
     consumer, one style — every missing-dep case in the plugin
     looks the same.
   - Panels degrade independently: a Project page with IG missing
     but the backend present shows the app-metrics panel normally
     and `MissingDependency` only in the diagnostics panel.
5. **Don't re-implement Headlamp.** The plugin's job is to add what
   Headlamp doesn't know about: AI workloads, AI-specific metrics,
   kernel-level AI diagnostics, and Project-as-an-application grouping.
   Generic K8s status, events, logs, exec, YAML views, and per-resource
   aggregation are Headlamp's job — we link to them, not duplicate
   them. This shapes §5 (Project detail links to Headlamp pages for
   per-resource detail) and §6 (the overview strip only carries
   Project-specific items).
6. **Detection is explicit and overridable.** Every detector returns a
   `{ detected, confidence, source }` triple. Low-confidence
   detections (e.g., image-name regex) show an inline "override" link.
   Users can pin a definitive answer with the
   `airunway.ai/engine=<name>` label, which detectors treat as
   authoritative. Framework detection (§7) and AKS-context probes
   (§9) are entries in a single typed detection registry (§7.1).

---

## 4. Three layers + cloud-neutral data path

```
┌──────────────────────────── Headlamp (browser) ─────────────────────────┐
│                                                                          │
│  Layer A — CORE airunway plugin  (provider-neutral, runs everywhere)     │
│    • Existing: Deployments, Models, Runtimes(RO), Gateway, Settings      │
│    • NEW: Projects (list, detail [Topology | Resources | Observability], │
│           create wizard, "Add to project")                               │
│    • NEW: Project → Observability tab                                    │
│         ├─ App-metrics panel  (via AI Runway backend)                    │
│         └─ Diagnostics panel  (Inspektor Gadget, when installed)         │
│    • NEW: Detection registry (framework + cluster probes)                │
│                                                                          │
│  Layer B — AKS overlay plugin  (loads ONLY when cluster is AKS)          │
│    • augments core views via registerDetailsViewSection etc.             │
│    • Azure tab on ModelDeployment; AKS deploy-wizard step                │
│    • KAITO (SKU,model)→preset table; WI/ACR/Gateway glue                 │
│    • AKS-flavored IG enrichers (GPU-SKU fit, NCCL silent-replica)        │
└──────────────────────────────────────────────────────────────────────────┘
                                   │
                                   │  Two data paths, both K8s-only:
                                   │   (1) Headlamp's K8s API proxy
                                   │   (2) AI Runway backend (in-cluster Service,
                                   │       reached via that same K8s proxy)
                                   ▼
   Kubernetes cluster: Project CRD + controller · ModelDeployments ·
   AI Runway backend · Inspektor Gadget (optional) · KAITO/KubeRay/…
```

**Import direction:** B → A only, never A → B. Core never learns about
Azure. Splitting B out later stays a config change, not a refactor.

**Enforcement (not aspirational):**

- **Lint rule.** `eslint-plugin-import`'s `no-restricted-paths` forbids
  any file under `src/core/**` from importing `src/aks/**`. CI-failing.
  This is what makes "splitting B out later is a config change" actually
  true regardless of contributor turnover.
- **Detection registry — register-at-load.** A defines the §7.1 registry
  and exports a `registerProbe()` function. B calls `registerProbe()` at
  module load time, wired in by the plugin entrypoint (not by core
  code). Core consumers use `useDetection(probeName)` and get
  "not detected / probe not registered" when B isn't loaded. This is the
  one pattern that lets the registry hold AKS probes without core ever
  importing AKS code.

**Cloud-neutral data path (new, hard rule):** the plugin makes calls
*only* to the Kubernetes API server (through Headlamp's proxy) and to
the AI Runway backend (also a K8s Service, reached the same way). Cloud
provider SDKs (Azure ARM, AWS, GCP) are explicitly out of scope at
every version. Cloud-specific facts surface via K8s labels, CR status,
or in-cluster exporters — never via a cloud SDK in the plugin. Where a
fact is only available outside K8s (e.g., AOAI provisioned-throughput
units), the UX is a Portal deep-link, not an API call. This rule
makes the AKS overlay an AKS-*detection-and-K8s-glue* layer rather
than an Azure-SDK layer, which is what keeps it fit-for-purpose in the
kaito-project repo and keeps the future "lift it out" path open.

**Controller** (`controller/project/`): one `controller-runtime` reconciler
that watches `Project`, computes the member set from `spec.selector`,
writes `status.resourceCounts` + aggregated `status.conditions`. v1: no
ownerRefs, no cascade delete, no finalizer, no quota. **Process model:**
the Project reconciler runs in the existing AI Runway controller-manager
process (shared informers, one leader election, one RBAC bundle) — not
a second binary or second manager. Keeping it co-resident with the
ModelDeployment reconciler is what holds the "one required backend
component" property; if Projects ever need to ship standalone, the
reconciler has no ModelDeployment-specific imports and can be lifted
out cheaply.

**Disaggregated role labeling (controller addendum):** the existing
ModelDeployment reconciler — when `spec.serving.mode: disaggregated` —
sets `airunway.ai/role=prefill` / `airunway.ai/role=decode` on the
child Deployments (and propagates to Pods via the PodTemplate). This
is what the §6a topology renderer reads for lane assignment, and is
also reusable downstream (metric grouping, IG scoping). Aggregated
mode does not set the label.

**Enforced extraction-readiness (Project reconciler).** The §4 promise
that the Project reconciler can be lifted out cheaply is held by a
build-time check: the Go package containing the Project reconciler
must not import any ModelDeployment-specific package. Implemented as
a `go vet`-style depguard / forbidden-import rule (or a tiny grep
gate in CI), failing the build if a disallowed import appears. This
sits next to the §4 `no-restricted-paths` rule for core ↛ aks; same
"make the architecture promise mechanical, not aspirational" shape.
See §15 for the matching risk row.

---

## 5. Project model

### CRD (`airunway.ai/v1alpha1`, minimal)

```yaml
apiVersion: airunway.ai/v1alpha1
kind: Project
metadata: { name: my-rag-app, namespace: default }
spec:
  displayName: "Customer Support RAG"
  description: "Internal RAG over support docs"
  selector:
    matchLabels: { airunway.ai/project: my-rag-app }
status:
  resourceCounts:
    modelDeployments: { total: 1, ready: 1 }
    deployments:      { total: 2, ready: 2 }
    pods:             { total: 4, ready: 3 }
    services:         { total: 3, withEndpoints: 3 }
    pvcs:             { total: 1, bound: 1 }
  conditions:
    - type: Ready
      status: "False"            # "True" / "False" / "Unknown"
      reason: PodsNotReady       # short machine token
      message: "1 of 4 Pods not ready"   # short human string; details live on the per-resource Headlamp page per §3.5
      lastTransitionTime: "2026-05-30T12:00:00Z"
      observedGeneration: 7
```

**Status shape rationale.**

- **One `Ready` condition**, not per-check (PodsReady, PVCsBound, …).
  The only spec'd consumer is the Ready/Degraded/Empty chip (§6),
  which is tri-state; per-check conditions would add update churn
  without a consumer. Details for *why* something is not Ready live
  on the relevant member's Headlamp detail page (§3.5).
- **Structured counts** (`{ total, ready }`, `{ total, withEndpoints }`,
  `{ total, bound }`) directly feed the §6 overview strip
  ("MDs: 3/3 ready").
- **Reconcile cadence.** Event-driven on member-set changes (Project
  spec edits, label add/remove on matching kinds) plus a 30 s resync.
  Accept a small chip lag on Pod-state churn in exchange for no write-
  storm; standard controller-runtime pattern.

### Membership model

- **One label, one Project.** Label `airunway.ai/project=<name>`. The
  CRD `spec.selector` matches this label; users write exactly this in
  their YAML. A resource belongs to exactly one Project in v1.
- **Forward-compat constraints (so v1.1 multi-Project membership
  stays open).** v1.0 implementation must:
  - Treat the label value as **opaque** — no equality or parsing
    assumptions in consumers beyond what the K8s `MatchLabels`
    selector itself requires. No `value === project.name` comparisons
    scattered through UI or backend code.
  - Reserve `Project.spec.references` (cross-Project references) as
    a CRD field name. Not implemented in v1.0, not validated by the
    webhook, just kept out of bounds for any other v1.x use.
  - Webhook (§13) rejection rules must not preclude
    `.secondary`-suffixed keys under `airunway.ai/` namespace, or
    comma-containing label values — both are candidate mechanisms.

  This is purely about not painting v1.1 into a corner; the
  mechanism itself stays a v1.1+ decision based on real usage.
- **Shared resources.** A resource that is conceptually shared across
  Projects (e.g., a common embedding model serving two RAG apps) lives
  in one Project; the other Project references it as an external
  dependency in docs or via a `spec.references` field added later.
  Multi-Project membership is a v1.1+ question — we want real usage
  data before picking a mechanism (secondary labels vs.
  multi-ownerRef vs. references).

### Scope rules

- **Namespaced.** A Project is namespaced and its members are in
  *its own namespace* only. Cross-namespace membership is explicitly
  out of v1.
- **Cluster-scoped resources excluded.** ClusterRoles, CRDs, Nodes etc.
  are not Project members in v1. (Cluster-scoped context — e.g., the
  GatewayClass a Project routes through — is surfaced as a
  *reference*, not membership.)
- **Selector collisions.** Two Projects in the same namespace whose
  selectors match the same resource: v1 **allowed** (usually signals a
  label mistake). The Project detail page shows a "Also in: N other
  Projects" warning when this happens.
- **Label tampering.** Any user with patch rights on a resource can
  add or remove the label. v1 treats this as an RBAC question for
  the cluster admin; the plugin does not enforce Project-scoped ACLs.
  See [§13 Security](#13-security).

### UI (core plugin)

- **Projects list** — sidebar entry; status chips (Ready / Degraded
  / Empty — see §6 for what feeds these).
- **Project detail** — three tabs:
  - **Topology** (default, v1.0 stretch — see §6a). Visual graph of
    the Project's members with edges by relationship.
    Falls back to the Resources tab if topology is deferred to v1.1.
  - **Resources.** The kind-grouped list (ModelDeployments,
    Deployments, Services, PVCs, Secrets, HTTPRoutes). Each entry
    links to Headlamp's existing per-resource detail page (per the
    "Don't re-implement Headlamp" principle, §3.5). Resources with a
    cross-Project collision get a warning marker.
  - **Observability** — §6.
- **Project-shaped quick actions only** — "Add to project", and (in
  v1.1) "Rename". Per-resource actions (delete, edit, scale, etc.)
  are not duplicated here — operators click into the Headlamp page.
- **Create wizard** — three TS-defined templates:
  - *Chat / single-model.* `Project` CR + `ModelDeployment` + `Service`,
    all labeled with `airunway.ai/project=<name>`.
  - *Model + Storage* (the RAG-shaped scaffold). `Project` CR +
    `ModelDeployment` + `Service` + `PersistentVolumeClaim` annotated
    `airunway.ai/intended-use: rag-index` (size + storage class user-
    picked), all labeled with `airunway.ai/project=<name>`. The
    wizard's final screen is honest: "Project created. Next: deploy
    your RAG application pod and mount the `<pvc-name>` PVC" with a
    link to a docs page showing an example app Deployment. The
    plugin does **not** create a placeholder app pod — RAG apps are
    user-written and a placeholder image would falsely report Ready.
    Until the user adds their app, the chip reads Degraded (no Pods),
    which is the correct state.
  - *Empty.* Creates the `Project` CR alone.
  Templates live in TS, not in-cluster.
- **"Add to project"** affordance on existing ModelDeployment /
  Deployment detail pages — patches the `airunway.ai/project` label.
  This is the primary day-2 path; the wizard is the greenfield path.
  Three states based on the resource's current label value:
  - **No label** — button reads "Add to project…", opens a Project
    picker, patches on confirm.
  - **Already in this Project** — button reads "In this Project"
    and is disabled, tooltip explains.
  - **In a different Project** — button reads "Move to this
    Project…", opens a confirm dialog "This is currently in
    Project *<other>*. Move it to *<this>*?"; on confirm, the
    label is overwritten with a single patch. No two-step
    remove-then-add; moving between Projects is a real day-2
    operation and forcing two clicks just hides the intent.

### Not in v1

ownerRef cascade delete · Project-scoped RBAC/quota UI · in-cluster
template storage · multi-cluster Project views · resource move across
namespaces · Project rename (v1.1) · multi-Project membership for a
single resource (v1.1+, mechanism TBD).

---

## 6. Observability — the MVP

Lives as a **tab on Project detail** — always *of* a Project. Two
independent panels, two data planes.

### Data-source priority (per plane, fail soft)

| Plane | Source | Transport | If unavailable |
|---|---|---|---|
| App metrics | **AI Runway backend** (required install-time dep) | Backend Service via Headlamp K8s proxy; inherits user's token | "Install or repair AI Runway backend" CTA; panel dark, rest of tab renders |
| Kernel/eBPF | Inspektor Gadget (on-demand) | IG `GadgetManager` gRPC via Headlamp K8s proxy | "Install IG" CTA; rest works |
| K8s-native | always (pod status, restarts, Events, container resources) | Headlamp K8s client | n/a — but the plugin **does not duplicate** Headlamp's per-resource detail; see §3.5 |

> **Principle:** a missing optional source is a UI state, not a crash.
> Detection fails open → assume not-installed → show CTA. The backend
> is the one *required* source; everything else is optional.

### Panel 1 — App metrics (inference server, via backend)

Per-ModelDeployment, sourced from the AI Runway backend, which in turn
reads the serving engine's Prometheus output via a small **engine
adapter** registry. The backend schemas already standardized in AI
Runway's existing `MetricsPanel` / `useMetrics` apply.

**Engine adapters.** An adapter maps the canonical metric concepts
(TTFT, TPOT, end-to-end latency, tokens/s, requests/s, queue depth,
KV-cache utilization, error rate) to that engine's actual Prometheus
metric names and any required transform (e.g., histogram → p50/p95/p99).
Adapters are backend code (TS/Go), one file per engine, version-pinned
against engine releases.

**Adapter contract (v1.0).** An adapter is a typed module that
exports a single `EngineAdapter`:

```ts
type CanonicalMetric =
  | 'ttft' | 'tpot' | 'e2eLatency'
  | 'tokensPerSec' | 'requestsPerSec'
  | 'queueDepth' | 'kvCacheUtil' | 'errorRate';

type MetricSpec =
  | { source: string; kind: 'gauge' }
  | { source: string; kind: 'counter' | 'counter-rate' }
  | { source: string; kind: 'histogram'; quantiles: number[] };

interface EngineAdapter {
  engine: string;                              // 'vllm', 'rayserve', …
  versionRange: string;                        // semver range, informational
  metrics: Partial<Record<CanonicalMetric, MetricSpec>>;
  customScrape?: (pod: PodRef) => Promise<Partial<Record<CanonicalMetric, number>>>;
}
```

- The canonical metric set is the eight names above — fixed in
  v1.0. Adapters opt in per metric; an unset key renders as "not
  reported by this engine" on the panel (no zeros, no fake data).
- `kind` is a closed enum of four transforms the backend implements
  centrally: gauge passthrough, counter passthrough, counter rate
  over the polling interval, and histogram → requested quantiles.
- `versionRange` is informational; it powers the CI matrix in §11
  and a hover tooltip in the panel. Engine version is detected
  from a pod label or the engine's own `/version`-style endpoint
  where one exists.
- `customScrape` is the escape hatch when the declarative mapping
  cannot express the engine's exposition (e.g., metrics gated
  behind a non-Prometheus endpoint). **Unused in v1.0** — both
  in-tree adapters fit the declarative form.

v1.0 ships adapters for:

- **vLLM** (canonical metric names like
  `vllm:time_to_first_token_seconds`).
- **Ray Serve** (its native Prometheus exposition).

These are the two engines §6 / the glossary call out as the most
common; together they exercise the adapter contract end-to-end.

For other detected engines (Triton, SGLang, TRT-LLM, TorchServe,
Ollama, ONNX Runtime), the panel shows: "Engine detected: <name> · no
metric adapter available · contribute one →" linking to the adapter
contract above. This matches the graceful-degradation principle (§3.4)
and gives third-party engines a concrete extension point. Individual
metrics an adapter doesn't define render as "not reported by this
engine" rather than zeros.

**CI coverage.** §11 adds an adapter test that, for every in-tree
adapter, asserts each `CanonicalMetric` is either mapped or
explicitly omitted from `metrics` — no silent gaps allowed; a new
canonical metric added to the enum forces a per-adapter decision.

Canonical metrics the adapter exposes:

- **Latency:** TTFT (p50/p95/p99), TPOT / inter-token, end-to-end.
- **Throughput:** tokens/s, requests/s.
- **Saturation:** queue depth / pending, KV-cache utilization, error rate.
- **Time-series sparklines:** fixed window of **15 minutes**, polled
  every **15 seconds** (~60 points per series). The backend keeps an
  in-memory rolling ring buffer per ModelDeployment it knows about; no
  Prometheus dep, no on-disk persistence. Empty state "Collecting…"
  for the first 15 minutes after a new MD appears, and again after a
  backend restart (documented behaviour, acceptable for a live view in
  v1.0). **HA constraint (v1.0):** the in-memory buffer is per-replica,
  so the backend Deployment is pinned to `replicaCount: 1` in the
  Helm chart for v1.0; running multiple replicas would give different
  60-point series on consecutive page loads as the Service
  round-robins. This is a known v1.0 limitation, deleted in v1.1 when
  Prometheus-as-source replaces the ring buffer entirely (see §10);
  building session-affinity or a shared KV for a feature that's
  getting replaced is wasted work. **Post-v1.0:** when a cluster
  Prometheus is detected (added as a §7.1 probe), the panel reads
  from Prometheus instead and the backend ring buffer becomes the
  no-Prometheus fallback — see §10 v1.1.

### Panel 2 — Diagnostics (Inspektor Gadget)

On-demand, scoped to the Project's pods. See §8 for the IG client.

### Overview strip — Project-specific only

Per the "Don't re-implement Headlamp" principle (§3.5), the strip
carries only items Headlamp cannot compute because it doesn't know what
a Project or a ModelDeployment is:

`MDs: 3/3 ready · GPU pods: 4 · Engines: vLLM ×2, SGLang ×1 · Project status: Ready`

Generic K8s aggregations (Pods running, Restarts(1h), OOMs(24h),
Recent events) are not duplicated — they are one click away on any
member's Headlamp detail page.

### Ready / Degraded / Empty chip

Pure aggregation, no thresholds, no time windows, no app-metrics
signal:

- **Ready** = every member Pod is Ready, every member
  ModelDeployment has `status.ready=true`, every member PVC is
  Bound, every member Service has endpoints.
- **Degraded** = any of the above false.
- **Empty** = no members.

This stays deterministic — the chip never becomes a de-facto alert
(non-goal §1). Operators who want to see *why* something is wobbling
(CrashLoopBackOff counts, OOMs in the last hour, recent events) click
into the relevant member's Headlamp detail page, which already shows
all of that.

### Not in v1

Grafana embedding · alerting / thresholds / on-call · cost rollups ·
historical storage of gadget results · long-term metric retention
beyond the 15-minute live buffer (persistence is a v2 question, see
§10).

---

## 6a. Topology view (v1.0 stretch)

The default tab of Project detail. A real graph view of an
application's resources is the visually right answer for "what is this
Project" — a kind-grouped list is a table of contents, not a topology.
Marked **stretch** in v1.0: if the rest of v1.0 ships clean, topology
ships with it; if v1.0 runs hot, topology slides to v1.1 and Project
detail defaults to the Resources tab instead. Neither the Observability
tab nor the AKS overlay blocks on topology.

### Scope and rendering

- **Members shown:** all Project members.
- **Node kinds:** ModelDeployments, Deployments, Pods (collapsed by
  ReplicaSet when count > N, default N=3), Services, HTTPRoutes,
  Gateways, PVCs, and Secrets/ConfigMaps *only if referenced* by a
  shown resource. No generic "all resources" view.
- **Edges by relationship:** `routes-to`, `selects`, `owns`, `mounts`,
  `references`. Each edge clickable for a one-line tooltip. The
  computed edge set is fixed by this table — implementers do not
  invent new edge kinds in v1.0:

  | Source kind | Target kind | Edge | Derived from |
  |---|---|---|---|
  | HTTPRoute | Gateway | `references` | `spec.parentRefs` |
  | HTTPRoute | Service | `routes-to` | `spec.rules[].backendRefs` |
  | Service | Pod | `selects` | `spec.selector` ∩ Pod labels |
  | ModelDeployment | Deployment | `owns` | `ownerReferences` |
  | Deployment | Pod | `owns` | `ownerReferences` (via ReplicaSet, collapsed) |
  | Pod | PVC | `mounts` | `spec.volumes[].persistentVolumeClaim` |
  | Pod | Secret / ConfigMap | `references` | `spec.volumes[]` + `envFrom` + `env.valueFrom` |

  A Secret/ConfigMap node is rendered only if at least one
  `references` edge points at it (per the "shown only if referenced"
  rule above).
- **Layout:** left-to-right, oriented around request entry —
  HTTPRoute / Gateway on the left, Services / Pods / MDs in the middle,
  storage / secrets on the right. Disaggregated serving
  (`spec.serving.mode: disaggregated`) gets prefill and decode lanes;
  lane membership is read from the label
  `airunway.ai/role=prefill|decode` on child Deployments/Pods, which
  the AI Runway controller sets when reconciling a disaggregated
  ModelDeployment (see §4 controller note). The topology renderer
  stays kind-agnostic — no MD-shape knowledge in the renderer.
  The fixed direction and lane discipline kill the "graphs look
  chaotic" failure mode.
- **Renderer:** **react-flow** (~80 KB gz, BSD-3, actively maintained,
  accessible focus order, keyboard-navigable). Stays inside §12's
  1.5 MB core bundle budget with margin.
- **Node-count behavior:**
  - **Per-group Pod collapse (always on):** any Pod group with > N=3
    pods (the same N as the ReplicaSet-collapse default above)
    renders as a single "N Pods" node. Clicking expands inline; the
    graph re-flows. No side panel.
  - **50-node soft marker:** informational perf budget (§12) — no
    behavior change at this threshold beyond the per-group collapse
    that is already active.
  - **100-node hard fallback:** the topology pane is replaced with
    the Resources tab content under a **persistent** banner
    "Topology view unavailable — N nodes after collapse (limit 100).
    Showing Resources view." (N is the actual computed count.) The
    banner stays until the count drops back under the limit; no
    animation, no one-shot toast. The tab label stays "Topology" so
    the URL is stable; the fallback is per-render, not persisted.
- **Interactions:** click a node → opens that resource in Headlamp's
  existing detail page (§3.5). No editing in the topology view.
- **Keyboard navigation:** Tab walks nodes in DOM order, which
  matches the fixed left→right, top→bottom layout — predictable
  linear sweep for accessibility. From a focused node, arrow keys
  walk outgoing edges to the next node along the request path
  (power-user "trace the flow" mode). Edges themselves are
  focusable in the same Tab order for tooltip access.
- **Empty / degraded states:** a Project with one MD + one Service
  still renders meaningfully (2 nodes, 1 edge). An Empty Project
  shows the create-wizard CTA in the topology pane.

### Performance

Computed client-side from the same K8s reads the Project detail page
already does — no new API calls. First-paint target ≤ 2 s at 50
nodes (§12).

---

## 7. AI-workload detection (well-known frameworks)

Detection drives engine-specific metric schemas and per-kind icons in
the Project view. It is **independent of Project membership** — a Pod
is detected as "vLLM" purely from its image/env; that detection does
*not* add it to any Project. Membership requires the
`airunway.ai/project=<name>` label, always.

Detect by image + env + label, extensible via ConfigMap:

| Framework | Signal | Default confidence |
|---|---|---|
| vLLM | image `*vllm*` or env `VLLM_*` | low (image regex) → **high** if `airunway.ai/engine=vllm` is set |
| Triton | image `*tritonserver*` | low |
| SGLang | image `*sglang*` | low |
| TorchServe | image `*torchserve*` | low |
| Ray Serve / KubeRay | `RayService` / `RayCluster` CRs | **high** (CR presence) |
| KServe | label `serving.kserve.io/inferenceservice` | **high** (canonical label) |
| ONNX Runtime | image `*onnxruntime-server*` | low |
| Ollama | image `*ollama*` | low |
| Generic GPU (fallback) | `nvidia.com/gpu` request > 0 | informational only |

### 7.1 Detection contract

All detectors — framework detection here and the `useAksContext`
probes in §9 — return:

```ts
type Detection<T> = {
  detected: T;
  confidence: 'high' | 'low';
  source: 'crd' | 'label' | 'image' | 'env' | 'node-label' | 'oidc' | 'pull-secret';
};
```

- **High confidence** = canonical signal (CRD presence, dedicated
  label, OIDC issuer set). Rendered without an override link.
- **Low confidence** = inferred from a string match (image name, env
  prefix, pull-secret pattern). Rendered with a small "detected via
  image name — override?" link that points the user to set the
  authoritative label.
- **Override label:** `airunway.ai/engine=<name>` is the universal
  override for framework detection. When present on a Pod or its
  workload, all detectors treat it as authoritative and skip
  inference. (AKS-context overrides, if needed, follow the same
  pattern with their own well-known label keys; see §9.)

### Unified registry

Framework detection and the AKS-context probes (§9) are entries in a
single typed detection registry. Each probe declares:

- **Probe name** (e.g., `engine`, `aks.gpu-pool`, `aks.workload-identity`)
- **Signal type** (CRD / node label / pull-secret / etc.)
- **Cache TTL**
- **Fail-open default** (what to assume when the probe errors out)
- **"What's missing" CTA** (used by the `MissingDependency` renderer
  in §3.4 when the probe returns "not detected" and a Project page
  wants to surface the gap)

> A `cost` field is **not** declared in v1.0 — every current probe
> is a single API call or single label read, so there's nothing for
> a scheduler or UI to gate on. Add it back in v1.1 if a genuinely
> expensive probe (Prometheus discovery, cross-namespace label scan)
> lands and needs lazy / on-demand scheduling.

The plugin exposes a single `useDetection(probeName)` hook. The §7
framework table and the §9 AKS-context table are both views over the
same registry.

---

## 8. Inspektor Gadget integration (Layer A core; `ig-client.ts`)

> Validated against the inspektor-gadget repo (image-based gadgets era,
> post-v0.31). The legacy `gadget.kinvolk.io/v1alpha1 Trace` CRD and its
> `gadgettracermanager` controller were removed in mid-2025 (commit
> `3ba4e5500`, "treewide: Remove built-in gadgets") and must not be used
> by the plugin. Any leftover CRD-era RBAC in IG's chart is stale.

### Design

- **Surface:** the IG gadget DaemonSet exposes a **gRPC API** (proto in
  `pkg/gadget-service/api/api.proto`) reached through Headlamp's K8s
  API proxy — no extra endpoint, no extra auth. The service that
  matters in v1:
  - `GadgetManager.RunGadget` — bidi stream of `GadgetEvent`s for
    one-shot, user-scoped runs. Wrapped in `useGadgetRun(spec)` that
    cleans up on unmount.
  `GadgetInstanceManager` (named, durable runs that survive browser
  refresh) is **deferred to v1.1+** alongside gadget-result persistence
  (§10) — its ownership/naming/cleanup design needs more thought than
  v1.0 has room for, and the diagnostics use cases v1.0 targets fit
  inside a 60s `RunGadget`. There is no HTTP fallback; gRPC-through-
  the-K8s-proxy is the only supported path. (Helm-declared
  `GadgetInstance` ConfigMaps exist for cluster-admin pre-provisioning
  but are not a per-user run surface.)
- **Dynamic discovery + curated subset.** On mount, call
  `GadgetManager.GetGadgetInfo` to fetch each gadget's data sources,
  fields, and param schemas (no hardcoded list). Surface a "Recommended
  for AI workloads" group with the full catalog under "All
  gadgets". Curated list in `ig-recommended.json`, overridable in
  settings.

  **v1.0 "Recommended for AI workloads" set** (9 gadgets, one per
  signal class — verified present in the IG repo `gadgets/` tree):

  | Gadget | Why it earns a slot for AI workloads |
  |---|---|
  | `trace_dns` | DNS for HuggingFace / ACR / OpenAI — top cause of "model pull is slow" |
  | `trace_tcp` | Gateway → model and inter-replica connection visibility |
  | `trace_tcpretrans` | NCCL / inter-replica retransmits — direct signal for "silent replica" cases (§9) |
  | `profile_tcprtt` | Inter-pod latency distribution — disaggregated prefill↔decode lanes |
  | `trace_oomkill` | OOM events on model pods with container attribution |
  | `top_blockio` | Weight-loading / PVC-read I/O bottlenecks |
  | `trace_fsslower` | Slow FS ops (RAG index reads, model loading from PVC) |
  | `profile_cuda` | Stack-attributed CUDA Driver-API allocations |
  | `top_cuda_memory` | Per-process CUDA alloc/free over time — leak hunting |

  Gadgets deliberately left in "All gadgets" rather than Recommended:
  `trace_sni` / `trace_ssl` (overlap with `trace_dns` for the AI-
  traffic case), `trace_tcpdrop` (covered by `trace_tcpretrans` for
  the primary use), `profile_blockio` (better fit for v1.1 result-
  persistence), `trace_exec` (not AI-specific), `traceloop` (heavy,
  advanced/opt-in), `top_cpu_throttle` and `trace_malloc` (weaker AI-
  specific signal; defer based on feedback). Additions in v1.1+ come
  via the feedback loop already in §10.
- **Scoping:** every run auto-fills namespace = Project; user may narrow
  by pod label / container, never widen.
- **Rate limiting (two layers, v1.0 numbers hardcoded).**
  - *Plugin-side (UX hint).* The Diagnostics panel allows at most
    **2 concurrent runs per browser tab**; a third Run button is
    disabled with tooltip "Stop a running gadget first." Catches
    the obvious "click run 20 times" foot-gun before it reaches
    the backend.
  - *Backend-side (hard cap).* The AI Runway backend proxies all
    `RunGadget` calls and enforces, per authenticated user:
    **≤ 4 concurrent runs**, **≤ 20 runs/minute**. Excess returns
    HTTP `429` with `Retry-After`; the panel surfaces the wait
    inline. Numbers are intentionally generous for an interactive
    UI and intentionally low compared to "a DoS"; not load-tested,
    not user-configurable in v1.0 (the only role that could change
    them is the cluster admin, who is also the backend installer).
  - *IG-side.* `GadgetManager.RunGadget` exposes no rate-limit
    knob today; an IG-side limit would need an upstream API
    change. Tracked as a §14 upstream gap if the two layers above
    prove insufficient.
- **Run model:** on-demand only, user-picked duration (15s / 30s / 60s).
  All runs use `RunGadget` direct. No always-on streams, no durable
  (5-min+) instances in v1.0.
- **Rendering (`GadgetRunner.tsx`):** generic table from the gadget's
  column schema (from `GetGadgetInfo`); optional *enrichers* for
  curated gadgets (e.g. `trace_dns` groups by host + flags
  `huggingface.co`, `*.azurecr.io`, `openai.azure.com`; network gadgets
  annotate pod/container per PID). Absent enricher = raw table. Export
  JSON / CSV.
- **Results:** ephemeral cache in Headlamp plugin-storage, keyed
  `<project-uid>:<gadget>`. Keeps the **last 5 runs per gadget per
  Project** (not 5 total per Project — otherwise switching gadgets
  while debugging silently evicts the previous gadget's history).
  Eviction is oldest-by-start-time: the 6th run of a given gadget
  drops the 1st. UID-keying means deleting and recreating a Project
  with the same name does not resurrect stale results. Size budget
  ~2–3 MB per Project worst-case (9 gadgets × 5 × ~50 KB) — well
  inside browser localStorage limits at realistic Project counts.
  No server-side persistence.
- **Permissions:** IG needs cluster privileges; plugin never elevates.
  Reaching the gadget pod via apiserver proxy requires the user's token
  to have rights on the `gadget` namespace's pods (proxy/exec
  semantics). If the call fails, show a clear permission message (see
  [§13 Security](#13-security) for PII handling).

### Validated against the IG repo

1. **Surface choice — RESOLVED.** Use the gRPC `GadgetManager` /
   `GadgetInstanceManager` services. The `Trace` CRD is removed.
2. **GPU coverage — RESOLVED.** IG ships `profile_cuda` (CUDA Driver-
   API memory allocations: `cuMemAlloc_v2`, `cuMemAllocHost_v2`,
   `cuMemAllocManaged`, `cuMemAllocPitch_v2`, aggregated by user stack
   trace) and `top_cuda_memory` (per-process CUDA alloc/free activity
   over time). Both are uprobe-on-CUDA-runtime, not DCGM/NVML.
   **`top_gpu` does not exist** — drop from any curated set or UI copy.
   GPU **utilization %, SM occupancy, temp, power** are hardware-
   counter metrics outside IG's model (and outside eBPF in general);
   they are not in v1.0 and route to the operator's existing DCGM /
   Grafana stack outside the plugin. See §15 for the explicit
   framing. The v1.0 panel positions IG as the *primary* AI-
   diagnostics surface — allocation attribution, OOM root cause,
   inter-replica network behaviour — which is what §1 / §6 already
   call for.
3. **Curated catalog — RESOLVED.** v1.0 ships the 9-gadget
   "Recommended for AI workloads" set listed above (`trace_dns`,
   `trace_tcp`, `trace_tcpretrans`, `profile_tcprtt`, `trace_oomkill`,
   `top_blockio`, `trace_fsslower`, `profile_cuda`, `top_cuda_memory`).
   All verified present in `gadgets/`. The deferred-to-"All gadgets"
   list and the rationale for excluding each are documented above.
4. **Version floor — RESOLVED for v1.0.** Pin to the **latest stable
   IG release at v1.0 ship date**, documented as "minimum tested." A
   user on an older release sees an "Upgrade IG to ≥ vX.Y.Z" CTA; a
   user on a newer release gets forward-compatibility assumed, with
   CI smoke tests against IG-main (§11) catching breaks early. Exact
   tag is filled in at v1.0 ship. Per-gadget `GetGadgetInfo`
   degradation (probe each curated gadget individually, show "X of 8
   available") is deferred to v1.1.

---

## 9. AKS overlay

Loads only on AKS. Gate: node label `kubernetes.azure.com/cluster`.
When absent, none of this code runs — core stays clean for non-AKS
users. **No cloud-provider SDK calls at any version** (§3.5 / §4):
the overlay is an AKS-*detection-and-K8s-glue* layer.

### Detection → `useAksContext()` (all fail open, all entries in the §7.1 registry)

| Probe | Signal | Source | Used for |
|---|---|---|---|
| `aks.is-aks` | `kubernetes.azure.com/cluster` node label | node-label (high) | activate overlay |
| `aks.gpu-pool` | `agentpool` + `accelerator=nvidia` + SKU label | node-label (high) | KAITO preset / warn |
| `aks.gpu-sku` | `node.kubernetes.io/instance-type` (H100/A100/V100/T4) | node-label (high) | preset, model-fit |
| `aks.kaito` | `kaito.sh` CRDs | crd (high) | Workspace shortcuts |
| `aks.workload-identity` | OIDC issuer + `azure.workload.identity/use` | oidc + label (high) | one-click SA wiring |
| `aks.acr` | pull-secret / kubelet identity patterns | pull-secret (low → override via label) | image-pull config |
| `aks.gateway-api` | `gateway.networking.k8s.io` CRDs | crd (high) | HTTPRoute template |
| `aks.ig` | IG CRDs / gRPC reachability | crd (high) | enable AKS IG enrichers |

Each probe follows the §7.1 contract: probes whose source is `low`
confidence (`aks.acr` today) get an override affordance.

### Deploy glue — in-cluster writes only

Adds an "Azure" step to the deploy wizard + "Azure" tab on
ModelDeployment:

1. KAITO preset for detected SKU. The preset data ships as
   `kaito-presets.json` inside the AKS overlay, **generated at
   plugin-release time from KAITO's own `kaitollmconfig.json`**
   (model → minimumGpu mapping). v1.0 ships the families currently
   in KAITO: `falcon`, `mistral`, `phi-2`, `phi-3`, `qwen`, `llama3`
   — the table the wizard exposes is the inverse view
   `(SKU, family) → preset` derived from those entries. Each row
   carries the KAITO `kaitoVersion` floor; the wizard warns on
   cluster-version mismatch detected via `aks.kaito`. The generator
   script lives in the overlay repo; running it is part of cutting
   an overlay release. Out-of-band model families (not in KAITO's
   catalog) render the "report stale preset" CTA (§15).
2. Model-fit estimate (model size vs GPU mem; R/Y/G).
3. ServiceAccount with `azure.workload.identity/client-id` (user supplies
   client ID) + patch `spec.serviceAccountName`.
4. ACR image-ref validation + inline "configure pull secret".
5. One-click HTTPRoute via detected Gateway class (default AGIC's).
6. Azure OpenAI **credential helper**: writes a `Secret`
   (`api-key`, `endpoint`, `deployment-name`) and a `ConfigMap` with
   example env-var names + a code snippet showing how to mount them
   in an app pod or reference them from a gateway. The plugin does
   **not** implement routing or fallback — it stores credentials in a
   well-known shape so the user's app or gateway can consume them.
   "Fallback" routing (primary model down → AOAI) would require a
   `ModelDeployment` CRD field plus controller work in AI Runway
   proper; tracked as a §14 upstream gap.

   **Naming & re-run semantics.** Secret name is user-supplied with
   default `<project>-aoai`; the same name covers the paired
   ConfigMap. Resources the wizard creates carry the annotation
   `airunway.ai/managed-by: wizard` (shape consistent with the
   wizard-run-id annotation from the partial-failure section
   above). Re-run behaviour:
   - target name does not exist → create.
   - target name exists *and* carries the wizard annotation →
     confirm-overwrite dialog, then patch.
   - target name exists *without* the wizard annotation → wizard
     refuses with "A Secret named *X* exists but wasn't created by
     this wizard. Pick a different name or delete it manually
     first." No silent stomping on user- or other-tool-created
     secrets.

   The two-AOAI-per-Project case (e.g., GPT-4 primary + GPT-3.5
   helper) is supported by re-running the step with a different
   name — each run produces its own Secret/ConfigMap pair.

### Things the cloud-neutral rule punts to Portal deep-links

Node pool creation, ACR attach, Workload-Identity enablement, AOAI
provisioning, ARM-only infra details (pricing, quota, provisioned-
throughput units) — all of these require Azure ARM and are therefore
**permanently out of scope** for the plugin. UX surface:

- A **right-side drawer** opens when an Azure-out-of-band step is
  needed.
- Each step renders as: 1-line description, a code block with the
  exact `az` command pre-filled with detected values *from K8s*
  (cluster name from labels, etc.), a **Copy** button, and an **"Open
  in Azure Portal"** deep link as a secondary action.
- The drawer is dismissible and re-openable; nothing in the cluster
  state depends on the user having actually run the command — the
  next detection pass picks up the new state from K8s labels / CRs.

Where infra detail is genuinely missing (e.g., a fact the K8s API
doesn't surface), the right fix is **upstream**: KAITO exposes more in
CR status, AKS exposes more in node labels, or a Prometheus exporter
fills the gap. The plugin links to the gap, it does not work around it
with a cloud SDK. See §14 for the running list of such gaps.

### Partial-failure UX (no auto-rollback)

Multi-step wizards (Deploy, Add Azure glue) can leave the cluster with
some resources created and some not. v1 policy:

- Each step is a separate K8s write with its own success/failure pill in
  the wizard summary.
- A failure surfaces an inline error + **Retry this step** button.
- **Wizard-run tracking is server-side via annotation.** Every
  resource the wizard creates is annotated
  `airunway.ai/wizard-run-id: <uuid>` (one UUID per wizard run,
  minted on wizard open). A **Clean up partial resources** action
  queries by that annotation and lists what *would* be deleted,
  requires explicit confirmation, and only deletes resources that
  carry the matching run-id. Resources the wizard found
  pre-existing are never annotated, so never deleted. This survives
  browser refresh and wizard re-entry: the run-id is persisted on
  the resources themselves, not in session state, and the Cleanup
  action can be re-opened from the Project detail page as long as
  at least one annotated resource exists.
- No automatic / hidden rollback. Stakeholders should expect "Wizard
  failed at step 4" to leave steps 1–3 in place until the user chooses.

### AKS-flavored IG enrichers

GPU-SKU-aware fit overlay on GPU diagnostics; NCCL inter-pod traffic
view that flags silent replicas in multi-replica deployments. These
*decorate* the core IG panel; they don't replace it.

---

## 10. Phasing

T-shirt sizes are engineering-effort estimates from current code state,
**per engineer**, not calendar commitments. **S** ≈ days, **M** ≈ 1–2
weeks, **L** ≈ 3+ weeks per engineer. The TL;DR's 6–10 engineer-weeks
figure is the total v1.0 sum assuming one engineer working
sequentially; calendar time depends on staffing.

| Phase | Per-engineer size | Scope |
|---|---|---|
| **v0.9 (prereq)** | S–M | UX-spec items that block Project work (per §0): hard blockers P0-0 (per-cluster backend config) and P0-1 (deployments-list crash + namespace filter); soft prereqs P0-2 (single Settings location) and P0-3 (`useAutoRefresh` hook) land here or alongside early v1.0 steps. Step 1 of v1.0 cannot start until P0-0 and P0-1 are merged. |
| **v1.0** | ~6–10 eng-weeks total | Project CRD + controller (single-label membership + status aggregation); Projects list/detail-as-Resources/wizard + "Add to project"; **Observability tab — app-metrics panel (backend) + IG diagnostics panel (gRPC)** (MVP); framework detection (registry + override label); AKS overlay: `useAksContext`, Azure tab, KAITO preset step, WI SA / ACR / HTTPRoute / AOAI-credential-helper glue, AKS IG enrichers; graceful-degradation CTAs everywhere; IG smoke CI (§11). **Stretch:** Topology tab as the default Project view (§6a). |
| **v1.1** | M | **Prometheus-as-app-metrics-source when detected** (new §7.1 probe; backend ring buffer becomes the no-Prometheus fallback — removes the "blank panels for 15 min after backend restart" gap); **durable IG runs via `GadgetInstanceManager`** (5-min+ tier, with named-instance ownership/cleanup + a "Running gadgets" list in the Project Observability tab); Project rename; cascade-delete finalizer; multi-Project membership (mechanism TBD based on v1.0 user feedback); more curated gadgets + enrichers from feedback; per-gadget IG version degradation; more KAITO presets; AMD GPU in IG panel; full AKS E2E in CI; if v1.0 deferred topology, ship it here. |
| **v2.0** | L | Prometheus / Azure-Monitor-as-Prometheus historical metrics (still K8s-cluster-local — no cloud SDK); gadget-result persistence; cross-Project ops view; vector-DB / training-shaped Projects. |
| **Not planned** | — | Replacing AI Runway's deploy wizard; generic IG browser; alerting; GitOps integration; **any cloud-provider SDK use (Azure ARM, AWS, GCP)**. |

### Suggested build order

| # | Step | Per-engineer size |
|---|---|---|
| 0 | **v0.9 prereqs:** UX-spec P0-0 (per-cluster backend) + P0-1 (list crash / namespace filter); P0-2 + P0-3 land here or alongside step 2a | S–M |
| 1 | Project CRD + controller (single-label membership; unblocks UI) | M |
| 2a | Projects list / Resources tab / wizard + "Add to project" in core | M |
| 2b | *(stretch)* Topology tab (react-flow, caps, fallback) | M |
| 3 | Observability tab — app-metrics panel (reuses backend / `useMetrics`, adds sparkline ring buffer in backend), then IG diagnostics panel (gRPC `GadgetManager.RunGadget`) + IG smoke CI | M |
| 4 | AKS overlay scaffold + `useAksContext` (probes in shared §7.1 registry) + Azure tab placeholder | S |
| 5 | KAITO preset step; WI / ACR / HTTPRoute / AOAI-credential-helper glue; Portal deep-link drawer | M |
| 6 | AKS IG enrichers; polish; docs; E2E checklist | S |

Steps 1 → 2a → 3 are the critical path. Step 2b can be cut at any
point if v1.0 is running hot; steps 4–6 can fork off in parallel
after step 2a if multiple engineers are available. Step 0 gates
step 1 — no Project CRD work before P0-0 and P0-1 are merged.

---

## 11. Cross-cutting: data flow, errors, testing

- **Two data paths, both K8s-only:** Headlamp's K8s API client for the
  CRD reads, IG gRPC, ModelDeployment writes, and detection probes;
  the AI Runway backend (also a K8s Service, reached the same way) for
  app metrics. No cloud-provider SDK dep (§4). No new plugin-owned
  backend; the existing AI Runway backend is reused and gets a small
  in-memory metric ring buffer for sparklines (§6).
- **Caching:** detection + context in React context (`useRunwayContext`,
  `useAksContext`), invalidated on cluster switch. Detection registry
  TTLs live with the probe definition (§7.1).
- **Errors:** missing optional dependency = inline CTA, never a throw;
  detection fails open; missing AI Runway backend = "Install/repair"
  CTA on the app-metrics panel; K8s writes are per-resource (wizards
  surface partial-failure + "retry failed step", no auto-rollback —
  see §9); IG failures non-fatal.
- **Testing:**
  - **Unit (vitest/RTL):** the bulk — detection registry & override
    label, KAITO table, CRD transforms (label-selector matching),
    `ig-client` with mocked IG gRPC, hook lifecycles, sparkline ring
    buffer semantics.
  - **Component:** per major view against fixtures using Headlamp's
    harness — Projects list, Resources tab, Topology (if shipped),
    Observability with backend present/absent, IG panel with gRPC
    stubbed.
  - **Controller:** via controller-runtime envtest, including
    selector matching and cross-Project overlap warning.
  - **IG smoke (NEW in v1.0):** CI job spins up a `kind` cluster, Helm-
    installs IG, runs one curated gadget (`trace_dns`) end-to-end
    through the plugin's `ig-client` against the in-cluster gRPC
    endpoint. Triggered per-PR when `ig-client.ts` or
    `GadgetRunner.tsx` changes; nightly against IG-main to catch
    upstream churn.
    - **Runner.** Self-hosted runner preferred (privileged DaemonSet +
      eBPF + `/sys/kernel/debug` is more reliable there). GitHub-hosted
      runners work on current images but flake periodically; a single
      auto-retry on the IG-smoke step is allowed, a second failure
      fails the PR.
    - **Traffic generation.** Test pod issues a `curl` against a known
      hostname; assertion is "gadget output contains that hostname
      within N seconds." N tuned per runner class.
    - **Ownership.** Nightly failure triage has a named owner (track as
      §14 sub-item) — without an owner the job becomes noise.
  - **Full AKS E2E:** v1.1.
  - **Gate:** `bun run lint && bun run tsc && bun run test`. The lint
    step includes the `no-restricted-paths` rule enforcing the §4
    import-direction boundary (core must not import aks).

---

## 12. Non-functional requirements

> **Status of these targets (v1.0):** *informational, not gated.* The
> current plugin is ~84 KB gzipped, so the bundle ceilings below sit
> well above today's baseline and won't fire as regression alarms
> without real per-feature budgets behind them. Real budgets — tighter
> bundle limits with explicit per-feature lines (topology, Project
> views, Observability, IG client), a `size-limit`-style CI gate, and
> a benchmark harness for the TTI / first-paint numbers — are deferred
> to v1.1, by which point the actual shipped sizes give us something
> concrete to budget against. Until then the numbers below are
> documented intent; CI does not gate on them.

| Area | Target |
|---|---|
| Headlamp version | ≥ current LTS at v1.0 ship date; pinned in plugin manifest. Breaking-API drift treated as a release blocker. |
| Kubernetes version | ≥ 1.27 (matches AI Runway controller floor). |
| AI Runway backend | Required install-time dep; same version constraint as the controller. |
| Browser support | Latest 2 versions of Chrome, Edge, Firefox, Safari. |
| Plugin bundle size | Core plugin **≤ 1.5 MB** gzipped (includes react-flow ~80 KB gz for topology); AKS overlay **≤ 750 KB** gzipped. *Informational in v1.0; CI gating deferred to v1.1.* |
| Project-detail TTI | **≤ 2.5 s** on a cluster with 50 Projects / 500 labeled resources, on a warm Headlamp session. *Informational in v1.0; benchmark harness deferred to v1.1.* |
| Topology tab first-paint | **≤ 2 s** at 50 nodes; falls back to Resources tab beyond the 100-node cap (§6a). *Informational in v1.0.* |
| Observability tab first-paint | **≤ 1.5 s** to render the Project-specific overview strip; app-metrics and IG panels stream in independently. *Informational in v1.0.* |
| Detection latency | All §7.1 registry probes complete in **≤ 1 s** or fail open. *Informational in v1.0.* |
| Accessibility | Keyboard-navigable; respects Headlamp's existing a11y baseline. No new keyboard traps. Topology view has keyboard focus order across nodes/edges. |

---

## 13. Security

- **RBAC for Projects.** The plugin issues all calls with the
  end-user's token; it never elevates. Creating, listing, or modifying a
  `Project` CR requires standard K8s RBAC on `projects.airunway.ai` in
  the target namespace. Cluster admins are responsible for granting
  this — the plugin offers no per-Project ACL of its own in v1.
- **Validating webhook on `Project.spec.selector` (narrow).** v1.0
  ships a validating webhook that rejects only the unambiguous
  foot-guns:
  - empty `matchLabels` *and* empty `matchExpressions` (no selector
    at all → would match every resource in the namespace);
  - selector with no key under the `airunway.ai/` label namespace
    (decouples membership from the convention the rest of the
    system relies on).

  Everything else — selector collisions across Projects, wrong
  label values, typos — stays as UI warnings (§5). The webhook is
  intentionally not trying to be smart; it just blocks the two
  cases that have no legitimate use. Co-located with the existing
  ModelDeployment webhook in
  `controller/internal/webhook/v1alpha1/`; no new process.
- **Label tampering.** Any user with `patch` on a resource can add or
  remove the `airunway.ai/project` label. This is the same trust
  model as any K8s label-based grouping (Services, NetworkPolicies).
  v1 does not validate or webhook-enforce membership — cluster admins
  who care should restrict `patch` on the label key via RBAC or an
  OPA / Kyverno policy. Documented, not prevented.
- **Selector collisions** are allowed and surfaced (§5).
- **IG privileges.** IG itself runs privileged on every node; the plugin
  inherits no extra privilege. If the user's token cannot reach IG via
  the apiserver proxy, the Diagnostics panel shows a permission CTA
  rather than failing silently.
- **PII in IG output.** Kernel-level traces can leak sensitive strings:
  DNS names (`*.openai.azure.com`, internal hostnames), file paths
  (model identifiers, user-data mounts), syscall arguments. Plugin
  policy:
  - IG output is rendered **as-is** in the table. Nothing is
    auto-uploaded anywhere; the last-5 ephemeral cache lives in
    Headlamp plugin-storage (browser-local), not the cluster.
    JSON/CSV export is explicit and user-initiated.
  - The Diagnostics panel header carries a one-line PII notice the
    first time it's opened **per cluster, per browser profile**.
    Dismissal is explicit (a "Got it" button, not a passive X)
    and stored in plugin-storage keyed
    `pii-notice-acked:<cluster-name>`. Switching to a different
    cluster shows the notice again once — different cluster,
    possibly different operator, possibly different sensitivity
    context. Clearing plugin-storage or using a different browser
    profile re-shows it. Matches the kubectl-equivalent trust
    model: the acceptance scope is the cluster, not the tab.
- **Untrusted input.** Project `displayName` / `description`,
  user-supplied client IDs, override-label values, and gadget output
  are all rendered as text (React default-escapes); no
  `dangerouslySetInnerHTML`. Backend Zod validation enforced on every
  route per project security rules.
- **Secrets.** The AOAI credential-helper step writes a `Secret`; the
  plugin never logs the value, never sends it to telemetry, and
  clears form fields on navigation.

---

## 14. Open questions

These need decisions from named owners before or during v1
implementation.

1. **KAITO preset table.** *Resolved.* v1.0 ships
   `kaito-presets.json` generated from KAITO's `kaitollmconfig.json`
   at plugin-release time; covers the six families currently in
   KAITO (`falcon`, `mistral`, `phi-2`, `phi-3`, `qwen`, `llama3`)
   across the SKUs KAITO declares (predominantly A100 variants).
   Generator script lives in the AKS overlay repo. Mismatch with
   the in-cluster KAITO version surfaces a warning via `aks.kaito`.
2. **Sidebar placement.** *Resolved.* Projects sits **under the existing
   "AIRunway" sidebar group, as the first child** — above Deployments.
   One plugin = one sidebar group (per §3.5); Projects is the new
   top-of-funnel ("pick the app, then drill into pieces"), so it leads
   the list. Existing entries (Deployments, Models, Runtimes, Gateway,
   Integrations, Settings) stay where they are.
3. **Naming.** Core Project work needs no special name; AKS overlay
   working name `airunway-aks` — final name TBD.
4. **Upstream infra-metadata gaps.** With the cloud-neutral rule
   (§3/§4) holding firm, which infra facts that an operator would
   reasonably want to see in a Project are currently only available
   via ARM, and which of those should be fixed upstream (KAITO CR
   status, AKS node labels, a Prometheus exporter, etc.) rather than
   worked around in the plugin? Owner: KAITO maintainers + AI Runway.
   Track as a living list; do not block v1. Seeded entries:
   - **AOAI routing/fallback as a first-class `ModelDeployment`
     concept.** v1.0 ships a credential helper (§9.6) but no routing.
     A real fallback would need a `spec.fallback` field on
     `ModelDeployment` plus controller wiring (gateway BackendRefs or
     equivalent). AI Runway controller work, not plugin work.
5. **Topology stretch decision.** Re-evaluate mid-v1.0: is the rest of
   v1.0 on track such that §6a topology ships in v1.0, or does it slip
   to v1.1? Owner: project lead, decision needed before step 2b
   starts.
6. **IG-smoke nightly triage owner.** Who watches the nightly IG-smoke
   job (§11) and files / acts on failures? Without a named owner the
   job becomes noise. Pick before v1.0 ship.

> The IG version-floor tag (referenced in §8.4 and §15) is not an
> open question — it's a ship-time value filled in when v1.0 is cut,
> not a decision blocking design or implementation.

---

## 15. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| AI Runway backend unavailable in a user's install (misconfig, version skew, RBAC) | Low | Medium — app-metrics panel dark | Required install-time dep; clear "Install/repair AI Runway backend" CTA on the panel; backend health probe in `useRunwayContext` |
| IG's GPU coverage is allocation- and runtime-event shaped (stack-attributed CUDA allocs via `profile_cuda` / `top_cuda_memory`, NCCL-adjacent network signals via `profile_tcprtt`, `trace_tcp`, etc.); hardware-counter metrics (utilization %, SM occupancy, temp, power) are not in IG's model and won't be | Low | Low — known limit, clearly attributed | The IG diagnostics panel surfaces what IG actually does well (allocation attribution, OOM root cause, inter-replica network behavior) and labels these as such. Hardware-counter metrics are explicitly out of v1.0; operators who need them use their existing DCGM / Grafana stack outside the plugin. Revisit an in-plugin GPU-utilization panel in v1.1 only if the Prometheus integration (already v1.1) makes it cheap |
| IG image-based gadget gRPC API churns (proto in `pkg/gadget-service/api/api.proto`) between releases | Medium | Medium — plugin run/instance calls break | Pin minimum IG release in detection and CTA on mismatch; **IG smoke CI in v1.0** (§11); keep curated set's required fields narrow |
| KAITO presets churn between releases | Medium | Low — wrong preset surfaced | Keep preset table in TS, version it against KAITO release; CTA "report stale preset" |
| Inference-engine metric schemas drift (vLLM rename, SGLang adds/removes) over a 12-month horizon | High | Low — panel labels go stale | Engine-adapter registry (§6 Panel 1) is the single point of update; one adapter file per engine, version-pinned; engine-coverage matrix in tests asserts each adapter still maps every canonical concept; engines without an adapter render the "contribute one →" CTA |
| Headlamp plugin API breaks between releases | Low–Medium | High — plugin doesn't load | Pin tested Headlamp version range; CI runs plugin against Headlamp-main weekly |
| Detection false positives confuse users (e.g., a fork named `myco-vllm-patched` mis-detected) | Medium | Low | Detection contract (§7.1) surfaces confidence; low-confidence detections offer the `airunway.ai/engine=<name>` override link inline |
| AKS detection false positives on non-AKS clusters using the same node label out of habit | Low | Medium — overlay activates wrongly | Detection requires *both* the cluster-wide label and at least one Azure-specific CRD/identity signal before activating |
| Wizard partial-failure cleanup is misunderstood as auto-rollback | Medium | Medium — orphaned resources | UI is explicit: "no automatic rollback, use Clean up partial resources to remove what this wizard created" |
| Topology view becomes unreadable for medium Projects (20–50 nodes) | Medium | Low — view degrades, list still works | Fixed L→R direction + lane discipline; Pod-group collapse at 50 nodes; full fallback to Resources tab at 100 nodes (§6a) |
| Some Azure infra detail unavailable in K8s — looks like a regression vs. fully ARM-integrated tools | Medium | Low | Cloud-neutral rule is explicit and documented (§3/§4); Portal deep-links cover the "I need to see this in Azure" case; upstream-gaps list (§14.4) tracks where K8s should surface more |
| "Plugin form" itself gets reopened post-v1.0 (e.g., decision to ship Web UI standalone instead) | Low | High — most of this spec presumes Headlamp-plugin packaging (§4, §8, §9, §14.2) | v0.9 prereqs (§0) commit explicitly to "continue as a plugin"; any reopening triggers a full spec revisit, not a patch; AKS overlay's lint-enforced separation (§4) limits blast radius — the core could in principle re-target standalone, but the AKS overlay's Headlamp-integration assumptions wouldn't survive |
| Project reconciler co-residency with ModelDeployment reconciler (§4) hardens silently into shipped artifacts (single SA, single Helm value, shared metrics endpoint), making a future split-out a bigger lift than §4 implies | Medium | Low — only bites if Project reconciler ever needs to scale or ship independently | The §4 import-decoupling promise is held mechanically by a CI grep / depguard rule (no MD-specific imports in the Project reconciler package); shared state additions (e.g., a cache both reconcilers write to) get flagged at PR-review time as architecture-affecting; Helm chart keeps reconciler-feature toggles as separate values from day one so a later split is a values edit, not a chart rewrite |

---

## 16. Glossary

| Term | Meaning |
|---|---|
| **ACR** | Azure Container Registry — Azure's image registry; attached to AKS for image pulls |
| **AGIC** | Application Gateway Ingress Controller — Azure's Gateway API / Ingress implementation |
| **AKS** | Azure Kubernetes Service — Microsoft's managed Kubernetes offering |
| **AOAI** | Azure OpenAI — Azure-hosted OpenAI-compatible model endpoints. v1.0 surfaces this as a credential helper (Secret + ConfigMap), not as routing/fallback |
| **ARM** | Azure Resource Manager — Azure's control-plane API. Explicitly out of scope for this plugin at every version (§3 / §4) |
| **CTA** | Call-to-action — a button or link prompting the user to take a next step (e.g., "Install IG") |
| **DCGM** | NVIDIA Data Center GPU Manager — exporter that produces GPU utilization, memory, temperature metrics for Prometheus. Out of scope for v1.0 (operators use their existing DCGM stack outside the plugin); revisited in v1.1 alongside Prometheus integration |
| **eBPF** | extended Berkeley Packet Filter — Linux kernel mechanism for safely running sandboxed programs in kernel space; the basis for Inspektor Gadget |
| **Gateway API** | Kubernetes networking API (successor to Ingress) — `gateway.networking.k8s.io` |
| **IG / Inspektor Gadget** | A collection of eBPF-based tools for inspecting and debugging Kubernetes workloads |
| **KAITO** | Kubernetes AI Toolchain Operator — Azure-originated operator for deploying ML models; the "Workspace" CR is its deployment object |
| **KV-cache** | Key/Value cache in transformer inference — memory used to avoid recomputing attention over prior tokens; saturation kills throughput |
| **MD** | ModelDeployment — AI Runway's unified CRD for deploying ML models |
| **NCCL** | NVIDIA Collective Communications Library — used for inter-GPU / inter-pod tensor exchange in distributed inference; silent failures here cause "silent replicas" |
| **OIDC** | OpenID Connect — identity-token standard; needed for Workload Identity |
| **PII** | Personally Identifiable Information |
| **RAG** | Retrieval-Augmented Generation — LLM pattern that fetches documents and feeds them to the model as context |
| **R/Y/G** | Red / Yellow / Green status indicator |
| **react-flow** | React library for building node-based UIs; used for the topology view (§6a) |
| **SKU** | Stock-Keeping Unit — Azure's name for VM/instance types (e.g., `Standard_NC24ads_A100_v4`) |
| **TPOT** | Time Per Output Token — average latency between successive generated tokens; a key streaming-perf metric |
| **TTFT** | Time To First Token — latency from request submission to the first generated token reaching the client; a key user-experience metric |
| **TRT-LLM** | NVIDIA TensorRT-LLM — high-perf inference engine for NVIDIA GPUs |
| **vLLM** | High-throughput LLM inference engine with PagedAttention; the most common engine in AI Runway today |
| **WI** | Workload Identity — AKS feature that lets pods authenticate to Azure without long-lived secrets, via an OIDC-issued ServiceAccount token |
