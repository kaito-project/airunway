export type RuntimeId = string

export type RuntimeCrdMetadata = {
  id?: string | null
  name?: string | null
  requiresCRD?: boolean | null
}

export type RuntimeSelectionMetadata = RuntimeCrdMetadata & {
  installed?: boolean | null
}

const KNOWN_RUNTIME_IDS = new Set(['dynamo', 'kuberay', 'kaito', 'llmd', 'vllm'])
const CRD_LESS_RUNTIME_IDS = new Set(['llmd', 'vllm'])
const CRD_LESS_RUNTIME_DISPLAY_NAMES = new Set(['LLM-D', 'vLLM'])

export const normalizeRuntimeId = (id: string | null | undefined) => String(id ?? '').toLowerCase()
const isLlmdRuntimeId = (id: string | null | undefined) => normalizeRuntimeId(id) === 'llmd'
const isVllmRuntimeId = (id: string | null | undefined) => normalizeRuntimeId(id) === 'vllm'
const isLlmdRuntimeDisplayName = (name: string | null | undefined) => String(name ?? '').trim() === 'LLM-D'
const isVllmRuntimeDisplayName = (name: string | null | undefined) => String(name ?? '').trim() === 'vLLM'
const isCrdLessRuntimeId = (id: string | null | undefined) => CRD_LESS_RUNTIME_IDS.has(normalizeRuntimeId(id))
const isCrdLessRuntimeDisplayName = (name: string | null | undefined) => CRD_LESS_RUNTIME_DISPLAY_NAMES.has(String(name ?? '').trim())

export const canonicalizeRuntimeId = (id: string) => {
  const normalized = normalizeRuntimeId(id)
  return KNOWN_RUNTIME_IDS.has(normalized) ? normalized : id
}

export const runtimeIdsMatch = (left: string | null | undefined, right: string | null | undefined) =>
  normalizeRuntimeId(left) === normalizeRuntimeId(right)

export const runtimeRequiresCRD = (runtime: RuntimeCrdMetadata | null | undefined, fallbackId?: string | null) => {
  if (typeof runtime?.requiresCRD === 'boolean') {
    return runtime.requiresCRD
  }

  if (
    isCrdLessRuntimeId(runtime?.id) ||
    isCrdLessRuntimeDisplayName(runtime?.name) ||
    isCrdLessRuntimeId(fallbackId)
  ) {
    return false
  }

  return true
}

export const runtimeDescription = (id: string, name?: string | null) => {
  if (isLlmdRuntimeId(id) || isLlmdRuntimeDisplayName(name)) {
    return 'LLM-D for distributed inference'
  }

  if (isVllmRuntimeId(id) || isVllmRuntimeDisplayName(name)) {
    return 'vLLM for high-throughput inference'
  }

  switch (normalizeRuntimeId(id)) {
    case 'kaito':
      return 'KAITO for simplified model deployment'
    case 'dynamo':
      return 'NVIDIA Dynamo for high-performance GPU inference'
    case 'kuberay':
      return 'Ray Serve via KubeRay for distributed Ray-based model serving with vLLM'
    default:
      return 'Inference runtime provider'
  }
}

export const crdLessRuntimeReadinessMessage = (ready: boolean | null | undefined) => (
  ready ? 'Runtime is ready to use.' : 'Provider is registered but not ready yet.'
)

export const crdLessRuntimeStateLabel = (ready: boolean | null | undefined) => (
  ready ? 'Ready' : 'Registered'
)

export const selectDefaultRuntimeId = (runtimes: RuntimeSelectionMetadata[] | undefined): RuntimeId | null => {
  if (!runtimes) {
    return null
  }

  const installedRuntime = runtimes.find(r => r.installed && r.id)
  if (installedRuntime?.id) {
    return canonicalizeRuntimeId(installedRuntime.id)
  }

  const dynamoRuntime = runtimes.find(r => runtimeIdsMatch(r.id, 'dynamo') && r.id)
  if (dynamoRuntime?.id) {
    return canonicalizeRuntimeId(dynamoRuntime.id)
  }

  const firstRegisteredRuntime = runtimes.find(r => r.id)
  if (firstRegisteredRuntime?.id) {
    return canonicalizeRuntimeId(firstRegisteredRuntime.id)
  }

  return 'dynamo'
}
