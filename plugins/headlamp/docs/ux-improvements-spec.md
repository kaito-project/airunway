# AI Runway Headlamp Plugin — UX Improvements Spec

**Scope:** `plugins/headlamp/` only
**Out of scope:** `backend/`, `controller/`
**Status:** Draft for review
**Source:** Validated against current `plugins/headlamp/src/` tree.

---

## 0. Open Architectural Question (decide before P0 work lands)

Does this need to be a Headlamp plugin at all?

- The plugin never talks to `kube-apiserver` directly — every page routes through
  the AI Runway backend (`lib/api-client.ts`).
- It cannot function without the backend reachable, even for read-only browsing.
- The standalone Web UI in `frontend/` uses the same backend and has feature parity.
- The plugin does not use Headlamp's cluster connection, auth context, or namespace
  context — it's a REST client wrapped in Headlamp routing.
- The only real value of "plugin form" is that it lives in the same window as the
  rest of Headlamp.

**Decision needed:** Continue as a plugin, ship the Web UI standalone, or expose
the Web UI behind a Headlamp sidebar link. The improvements below assume "continue
as a plugin" — if that changes, P0-0 in particular goes away.

---

## What the plugin covers today

| Feature                                              | Description                                                                 |
| ---------------------------------------------------- | --------------------------------------------------------------------------- |
| Sidebar group, routes, plugin settings               | Navigation entries and settings panel in the Headlamp sidebar.              |
| Deployments — list / create / delete                 | View, add, and remove `ModelDeployment` resources.                          |
| Deployment detail (Overview / Pods / Metrics / Logs / Conditions / Storage) | Tabbed detail view for a single deployment.                                 |
| Models catalog + HuggingFace search & OAuth          | Browse models, search HF, authenticate via API key.                         |
| Runtimes status + install / uninstall / upgrade      | Manage KAITO, KubeRay, llm-d, NVIDIA Dynamo.                                |
| Gateway status & routing                             | Inspect gateway health and routes.                                          |
| Integrations (GPU Operator, HF, Gateway CRDs)        | Surface integration prerequisites.                                          |
| Plugin Settings                                      | Resolve backend endpoint from settings, cluster context, or defaults.       |

### CRDs in scope

| Resource                  | Scope       | Plugin coverage                          |
| ------------------------- | ----------- | ---------------------------------------- |
| `ModelDeployment`         | Namespaced  | List and detail views                    |
| `InferenceProviderConfig` | Cluster     | Consumed implicitly to render Runtimes   |

CRD source of truth: `controller/api/v1alpha1/`.

---

## Findings

Ordered by severity. Crashes and broken first-run paths first; cosmetic gaps last.

### F1. Backend URL is global, not per-cluster — Headlamp context switches are silently ignored

- **Where:** `lib/backend-discovery.ts:18` (`SETTINGS_KEY_BACKEND_URL = 'backendUrl'`),
  `lib/plugin-storage.ts`.
- **Issue:** The backend URL lives in a single plugin-wide setting. It is not keyed
  to the active Headlamp cluster / kubeconfig context.
- **Consequence:**
  - Switching clusters in Headlamp continues hitting the same backend, which may
    be wired to a different cluster.
  - User sees the wrong cluster's `ModelDeployment`s, runtimes, gateway status.
  - Mutations (create, delete, install runtime) hit the wrong cluster.
  - No banner, no warning, no indication anything is off.
- **Severity:** Silent correctness bug. Top priority.

### F2. Deployments list crashes intermittently

- **Where:** `pages/DeploymentsList.tsx` (`normalizeForFiltering`, lines ~55–64).
- **Issue A — `normalizeForFiltering`:** Coerces a hard-coded allow-list of fields
  to strings to work around `DeploymentStatus` payloads where strings sometimes
  arrive as objects. Any field outside the allow-list can still crash the row.
- **Issue B — namespace filter:** Headlamp's namespace filter is bypassed on this
  page — the top-bar namespace selector has no effect on the deployments list.

### F3. Runtimes — install is a black box, no detail view

- **Where:** `pages/RuntimesStatus.tsx`.
- Install / upgrade / uninstall is a single button that flips to "Deploying…" and
  blocks on the backend.
- No progress, no logs, no preflight (GPU Operator present? GPU nodes available?
  CRD ownership conflicts?), no post-install verification.
- Failure surface is a raw `alert()` with the backend error string.

### F4. Backend-unreachable state is broken and assumes a dev environment

- **Where:** `components/ConnectionBanner.tsx:102,234`; `src/routes.ts:25`.
- **Broken settings link:** The banner and `ConnectionError` push
  `/c/airunway/settings`, but the registered route is `/airunway/settings`. The
  button users are most likely to click — when the plugin is broken — 404s.
- **Wrong copy for production users:** Step 1 of the troubleshooting panel tells
  the user to run `cd airunway && bun run dev`. Anyone who installed the plugin
  from Artifact Hub has no `airunway` checkout. Production guidance should be
  "install the backend in your cluster."

### F5. "Access Model" is a copyable kubectl command

- **Where:** `pages/DeploymentDetails.tsx`.
- Renders `kubectl port-forward …` and asks the user to paste it into a terminal.
- Only works if the user has `kubectl` and a matching kubeconfig on the same
  machine — defeating the point of using the dashboard.
- Headlamp owns the kubeconfig and exposes a port-forward primitive; we should
  use it.

### F6. Deployment detail doesn't use Headlamp's detail layout

- **Where:** `pages/DeploymentDetails.tsx:294–505`.
- Hand-rolled `div` cards with inline styles instead of Headlamp's
  `MainInfoSection`, `DetailsGrid`, standard back-link header, or actions menu.
- Internal inconsistency: list view uses `confirm()` (`DeploymentsList.tsx:115`),
  detail view uses a custom `DeleteDialog`.

### F7. Settings is registered twice

- **Where:** `src/index.tsx` (sidebar entry + `registerPluginSettings(...)` at
  `:176`).
- The Settings page is exposed both as an AIRunway sidebar entry and via
  `registerPluginSettings`. Two entry points for one component, and it clutters
  the AIRunway sidebar with non-resource content.

### F8. Each page rolls its own polling

- **Where:** `DeploymentsList.tsx`, `RuntimesStatus.tsx`, `GatewayStatus.tsx`,
  `Integrations.tsx`, `ModelsCatalog.tsx`.
- The same `setInterval` + manual `fetch` + cleanup pattern is reimplemented in
  ~5 places, each with its own hardcoded cadence.

---

## Proposed changes

### P0 — stability

#### P0-0. Per-cluster backend configuration

- Key the backend URL by Headlamp cluster context, not as a single global setting.
  Storage shape:

  ```ts
  // before
  backendUrl: string

  // after
  backendUrlByCluster: Record<clusterName, { url: string; namespace: string }>
  ```

- Resolve the backend through Headlamp's active-cluster API so `useApiClient()`
  rebuilds when the user switches clusters.
- Surface the active cluster + resolved backend URL in plugin settings and as a
  small affordance on every page header ("cluster X via backend Y").
- One-time migration of any existing single-value `backendUrl` setting on first
  load. No UX needed for the migration.
- `src/settings.tsx` edits the entry for the currently active cluster.

**Files touched:** `lib/backend-discovery.ts`, `lib/plugin-storage.ts`,
`lib/api-client.ts`, `src/settings.tsx`, all pages that resolve a backend URL,
plus a shared header component.

**Acceptance:**

- Switching clusters in Headlamp causes the next API call to target the new
  cluster's configured backend.
- Each page header shows the resolved cluster + backend.
- An existing global `backendUrl` is migrated into the active cluster entry on
  first load.

#### P0-1. Resolve the list crash

- Strengthen `pages/DeploymentsList.tsx` column getters with defensive property
  access and narrow types at the API client boundary (`lib/api-client.ts`).
- Restore the namespace filter so the top-bar selector actually filters the list.

**Acceptance:**

- Loading the deployments list with a non-uniform `DeploymentStatus` payload
  cannot crash the row render.
- Selecting a namespace in the Headlamp top bar narrows the list.

#### P0-2. Settings — pick one location

- Remove the sidebar entry for Settings in `src/index.tsx`.
- Keep `registerPluginSettings(...)` (`src/index.tsx:176`).
- Fix the broken `/c/airunway/settings` links to the correct registered path
  (`/airunway/settings`) or, preferably, route via Headlamp's settings API so the
  link can't drift again. (Closes F4 settings-link half.)

**Acceptance:**

- The AIRunway sidebar group contains only resource pages.
- The "Open settings" button in `ConnectionBanner` lands on the Settings page,
  not a 404.

#### P0-3. One auto-refresh hook

- Introduce `useAutoRefresh(intervalMs, fn)` and use it everywhere instead of
  ad-hoc `setInterval` blocks.
- Cadence configurable in plugin settings: **15s / 30s / off**.

**Acceptance:**

- Grep for `setInterval` in `src/pages/` returns no matches for polling use.
- Changing the cadence in Settings affects all pages without reload.

---

### P1 — UX

#### P1-1. Rebuild deployment detail on Headlamp's detail layout

- Replace hand-rolled cards in `pages/DeploymentDetails.tsx:294–505` with
  Headlamp's standard `MainInfoSection`, `DetailsGrid`, back-link header, and
  actions menu so the page matches other Headlamp resource detail views.
- Standardize delete: use `DeleteDialog` in both list and detail; drop
  `confirm()` from `DeploymentsList.tsx:115`.

**Acceptance:**

- Deployment detail visually matches a stock Headlamp resource detail (header,
  metadata grid, actions menu).
- Delete UX is identical from list and detail.

#### P1-2. In-plugin port-forward (closes F5)

- Replace the copyable `kubectl port-forward …` block in
  `pages/DeploymentDetails.tsx` with a button that uses Headlamp's port-forward
  primitive against the deployment's frontend `Service` (or a representative
  `Pod`).
- After forwarding, show the resulting `localhost` URL inline and a "stop"
  control.

**Acceptance:**

- A user with no `kubectl` on their machine can open the model endpoint from the
  deployment detail page.

#### P1-3. Fix `ConnectionBanner` troubleshooting copy (closes F4 copy half)

- Rewrite step 1 to describe installing the backend in-cluster (Helm / kustomize
  pointer), with the dev-checkout instructions as a secondary "developing the
  plugin" note.

---

### P2 — polish

- Surface cost estimation in the Create flow (already present in the standalone
  Web UI).
- Replace inline styles with MUI / Headlamp theme primitives so dark mode renders
  correctly.
- Replace remaining `alert()` calls (e.g. `DeploymentsList.tsx:97`) with
  Headlamp snackbars.
- Runtimes install detail view (closes F3): per-runtime drawer with progress,
  preflight checks, recent install logs, and post-install verification, instead
  of a single "Deploying…" button. (Could move to P1 if the runtime install
  failure rate is high in practice.)

---

## Out-of-scope notes

- Anything in `backend/` or `controller/` (CRDs, reconcilers, REST routes).
- The standalone Web UI in `frontend/` — even where it has features the plugin
  lacks (e.g. cost estimation), implementation there is not in this spec.

## Open questions

1. Architectural question in §0 — plugin vs. sidebar link vs. standalone — block
   before P0-0?
2. P0-0: does Headlamp's plugin-settings store give us a per-cluster scope
   natively, or do we shape the value ourselves under one key?
3. P1-2: confirm Headlamp's port-forward primitive surface area matches what we
   need (lifetime, multi-port, auth).
