# CRD Reference

## ModelDeployment
Unified API for deploying ML models.

```yaml
apiVersion: airunway.ai/v1alpha1
kind: ModelDeployment
metadata:
  name: my-model
  namespace: default
spec:
  model:
    id: "Qwen/Qwen3-0.6B"       # HuggingFace model ID
    source: huggingface          # huggingface or custom
  engine:
    type: vllm                   # vllm, sglang, trtllm, llamacpp (optional, auto-selected)
    contextLength: 32768
    trustRemoteCode: false
  provider:
    name: ""                     # Optional: explicit provider selection
  serving:
    mode: aggregated             # aggregated or disaggregated
  resources:
    gpu:
      count: 1
      type: "nvidia.com/gpu"
  scaling:
    replicas: 1
  gateway:
    enabled: true                # Optional: defaults to true when Gateway detected
    modelName: ""                # Optional: override model name for routing
  model:
    storage:
      volumes:
        - name: model-cache      # DNS label, unique per deployment
          purpose: modelCache    # modelCache, compilationCache, or custom
          # Option A: reference a pre-existing PVC
          claimName: pvc-claim
          # readOnly: false         # optional, default false
          # Option B: let the controller create a PVC (omit claimName, set size)
          # size: 100Gi
          # storageClassName: azurelustre-static   # omit to use cluster default
          # accessMode: ReadWriteMany              # default when size is set
          mountPath: /model-cache  # required when purpose is custom; defaults for cache purposes
```

> **Note:** If `gateway.enabled` is explicitly set to `true` but the Gateway API Inference Extension CRDs are not installed, the controller sets a `GatewayReady=False` condition with reason `CRDsNotAvailable`. This surfaces as a status warning on the `ModelDeployment`.

### spec.model.storage.volumes[]

Each entry is a `StorageVolume`. Maximum 8 volumes per deployment.

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Unique volume identifier. DNS label format (`[a-z0-9-]`, max 63 chars). |
| `purpose` | string | no | `modelCache`, `compilationCache`, or `custom` (default). Controls mount path defaults and engine behavior. Only one volume of each cache purpose is allowed. |
| `claimName` | string | conditional | Name of a pre-existing PVC in the same namespace. Required when `size` is not set. When `size` is set and `claimName` is empty, defaults to `<deployment-name>-<volume-name>`. |
| `mountPath` | string | conditional | Absolute path inside the container. Required when `purpose` is `custom`. Defaults: `/model-cache` for `modelCache`, `/compilation-cache` for `compilationCache`. |
| `readOnly` | bool | no | Mount the volume read-only. Default: `false`. |
| `size` | string | no | Requested storage size (e.g. `100Gi`). When set, the controller creates a PVC automatically. When omitted, `claimName` must reference a pre-existing PVC. |
| `storageClassName` | string | no | StorageClass for controller-created PVCs. Omit to use the cluster default. Set to `""` to disable dynamic provisioning. Only used when `size` is set. |
| `accessMode` | string | no | PVC access mode for controller-created PVCs. One of `ReadWriteOnce`, `ReadWriteMany`, `ReadOnlyMany`, `ReadWriteOncePod`. Default: `ReadWriteMany`. Only used when `size` is set. |

## InferenceProviderConfig
Cluster-scoped resource for provider registration. Each provider controller self-registers its `InferenceProviderConfig` at startup. Provider display metadata and capabilities are stored in `metadata.annotations`; `spec` contains only desired-state selection rules used for provider auto-selection.

```yaml
apiVersion: airunway.ai/v1alpha1
kind: InferenceProviderConfig
metadata:
  name: dynamo
  annotations:
    airunway.ai/display-name: Dynamo
    airunway.ai/description: NVIDIA Dynamo for high-performance GPU inference
    airunway.ai/default-namespace: dynamo-system
    airunway.ai/documentation-url: "https://github.com/kaito-project/dynamo-provider"
    # Backward-compatible documentation fallback for older backends.
    airunway.ai/documentation: "https://github.com/kaito-project/dynamo-provider"
    airunway.ai/capabilities: |
      {
        "engines": ["vllm", "sglang", "trtllm"],
        "servingModes": ["aggregated", "disaggregated"],
        "gpuSupport": true,
        "cpuSupport": false,
        "gateway": {
          "inferencePoolNamePattern": "{namespace}-{name}-pool",
          "inferencePoolNamespace": "dynamo-system"
        }
      }
    airunway.ai/installation: |
      {
        "description": "NVIDIA Dynamo for high-performance GPU inference",
        "defaultNamespace": "dynamo-system",
        "helmRepos": [
          { "name": "nvidia-ai-dynamo", "url": "https://helm.ngc.nvidia.com/nvidia/ai-dynamo" }
        ],
        "helmCharts": [
          {
            "name": "dynamo-platform",
            "chart": "https://helm.ngc.nvidia.com/nvidia/ai-dynamo/charts/dynamo-platform-1.0.2.tgz",
            "namespace": "dynamo-system",
            "createNamespace": true,
            "values": { "global.grove.install": true }
          }
        ],
        "steps": [
          {
            "title": "Install Dynamo Platform",
            "command": "helm upgrade --install dynamo-platform https://helm.ngc.nvidia.com/nvidia/ai-dynamo/charts/dynamo-platform-1.0.2.tgz --namespace dynamo-system --create-namespace --set-json global.grove.install=true",
            "description": "Install the Dynamo platform operator with bundled Grove and CRDs"
          }
        ]
      }
spec:
  selectionRules:
    - condition: "spec.serving.mode == 'disaggregated'"
      priority: 100
status:
  ready: true
  version: "dynamo-provider:v0.2.0"
```

### Spec

| Field | Type | Description |
|---|---|---|
| `selectionRules` | `SelectionRule[]` | Optional CEL expressions for auto-selecting this provider. |

`InferenceProviderConfig.spec` is limited to desired state. Do not put display metadata, default namespace, documentation URL, or capabilities under `spec`.

### Provider metadata and capabilities annotations

| Annotation | Type | Description |
|---|---|---|
| `airunway.ai/display-name` | string | Human-readable provider name for UI display. |
| `airunway.ai/description` | string | Human-readable provider description. |
| `airunway.ai/default-namespace` | string | Default namespace for the provider's workloads or upstream components. |
| `airunway.ai/documentation-url` | string | Canonical URL to provider documentation. |
| `airunway.ai/documentation` | string | Legacy URL to provider documentation; keep as a backward-compatible fallback when registering providers. |
| `airunway.ai/capabilities` | JSON string | Provider capabilities metadata. The controller uses this annotation for engine auto-selection, provider selection, and gateway delegation. |
| `airunway.ai/installation` | JSON string | Installation metadata (description, defaultNamespace, helmRepos, helmCharts, steps). The backend parses this JSON to show installation commands and steps in the UI. |

The `airunway.ai/capabilities` JSON object supports:

| Field | Type | Description |
|---|---|---|
| `engines` | string[] | Supported inference engines, such as `vllm`, `sglang`, `trtllm`, or `llamacpp`. |
| `servingModes` | string[] | Supported serving modes, such as `aggregated` or `disaggregated`. |
| `cpuSupport` | bool | Whether the provider supports CPU-only inference. |
| `gpuSupport` | bool | Whether the provider supports GPU inference. |
| `gateway` | object | Optional provider-managed gateway settings. |
| `gateway.inferencePoolNamePattern` | string | Naming pattern for the provider-created `InferencePool`; supports `{name}` and `{namespace}` placeholders. |
| `gateway.inferencePoolNamespace` | string | Namespace for the provider-created `InferencePool`; supports `{name}` and `{namespace}` placeholders. |

### Installation metadata

`metadata.annotations["airunway.ai/installation"]` is a JSON-encoded object. It can contain `description`, `defaultNamespace`, Helm repository/chart data, and manual installation steps. Display metadata and capabilities should use the dedicated annotations listed above.

Helm chart entries support:

| Field | Type | Description |
|---|---|---|
| `name` | string | Helm release name. |
| `chart` | string | Chart reference, URL, or local chart path. |
| `version` | string | Optional chart version. |
| `namespace` | string | Namespace to install into. |
| `createNamespace` | bool | Whether to create the namespace. |
| `skipCrds` | bool | Whether Helm should skip installing CRDs from the chart. |
| `fetchUrl` | string | Optional URL to fetch the chart from before installation. |
| `preCrdUrls` | string[] | CRD manifest URLs to apply before chart installation. |
| `preInstallMissingCrds` | bool | Whether missing CRDs should be applied from the chart before installing it. |
| `values` | object | JSON object of Helm `--set-json` overrides. |

## See also

- [Architecture Overview](architecture.md)
- [Controller Architecture](controller-architecture.md)
