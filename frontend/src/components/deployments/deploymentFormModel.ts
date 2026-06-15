import type { DeploymentConfig } from '@/hooks/useDeployments'
import type { Engine } from '@/lib/api'
import type { MultiNodeRecommendation } from '@/lib/gpu-recommendations'

// Subset of Engine type for traditional GPU inference engines (excludes llamacpp which is KAITO-only)
export type TraditionalEngine = 'vllm' | 'sglang' | 'trtllm'
export type RouterMode = 'default' | 'kv' | 'round-robin'
export type DeploymentMode = 'aggregated' | 'disaggregated'
export type RuntimeId = 'dynamo' | 'kuberay' | 'kaito' | 'llmd' | 'vllm'
export type KaitoComputeType = 'cpu' | 'gpu'
export type GgufRunMode = 'build' | 'direct'

export const TENSOR_PARALLEL_SIZE_ARG = 'tensor-parallel-size'
export const PIPELINE_PARALLEL_SIZE_ARG = 'pipeline-parallel-size'

// FP8 precision engine flags (vLLM / SGLang). Only emitted when FP8 is selected
// on FP8-capable hardware; FP16/BF16 is the engine default and needs no flag.
export const QUANTIZATION_ARG = 'quantization'
export const KV_CACHE_DTYPE_ARG = 'kv-cache-dtype'

// Runtime metadata for display
export const RUNTIME_INFO: Record<RuntimeId, { name: string; description: string; defaultNamespace: string }> = {
  dynamo: {
    name: 'NVIDIA Dynamo',
    description: 'High-performance inference with KV-cache routing and disaggregated serving',
    defaultNamespace: 'dynamo-system',
  },
  kuberay: {
    name: 'KubeRay',
    description: 'Ray-based serving with autoscaling and distributed inference',
    defaultNamespace: 'kuberay-system',
  },
  kaito: {
    name: 'KAITO',
    description: 'Flexible inference with GGUF (llama.cpp) and vLLM support',
    defaultNamespace: 'kaito-workspace',
  },
  llmd: {
    name: 'llm-d',
    description: 'GPU-accelerated vLLM inference with disaggregated prefill/decode support',
    defaultNamespace: 'default',
  },
  vllm: {
    name: 'vLLM',
    description: 'High-throughput inference with the native vLLM provider',
    defaultNamespace: 'default',
  },
}

// Engine support by runtime (only traditional GPU engines, not llamacpp)
export const RUNTIME_ENGINES: Record<RuntimeId, TraditionalEngine[]> = {
  dynamo: ['vllm', 'sglang', 'trtllm'],
  kuberay: ['vllm'], // KubeRay only supports vLLM currently
  kaito: ['vllm'], // KAITO exposes vLLM in the engine picker; single-engine llama.cpp models bypass it
  llmd: ['vllm'], // llm-d uses vLLM exclusively
  vllm: ['vllm'], // Native vLLM provider uses vLLM exclusively
}

// Engines that accept the generic --quantization / --kv-cache-dtype flags.
// TRT-LLM uses a different mechanism and KAITO ignores generic engine args.
export const FP8_ARG_ENGINES: TraditionalEngine[] = ['vllm', 'sglang']

export function normalizeGatewayAvailability(
  config: DeploymentConfig,
  gatewayAvailable: boolean | undefined
): DeploymentConfig {
  if (gatewayAvailable !== false || !('gatewayEnabled' in config)) {
    return config
  }

  const nextConfig = { ...config }
  delete nextConfig.gatewayEnabled
  return nextConfig
}

// Check if a runtime is compatible with a model based on engine support
export function isRuntimeCompatible(runtimeId: RuntimeId, modelEngines: Engine[]): boolean {
  // KAITO supports llamacpp (GGUF) AND vllm models
  if (runtimeId === 'kaito') {
    return modelEngines.includes('llamacpp') || modelEngines.includes('vllm')
  }
  // Other models need at least one matching engine with the runtime
  const runtimeEngines = RUNTIME_ENGINES[runtimeId]
  return modelEngines.some(e => runtimeEngines.includes(e as TraditionalEngine))
}

// Extract nodeCount from providerOverrides structure
export function getNodeCountFromOverrides(overrides?: Record<string, unknown>): number {
  if (!overrides) return 1
  const spec = overrides.spec as Record<string, unknown> | undefined
  const services = spec?.services as Record<string, unknown> | undefined
  const vllmWorker = services?.VllmWorker as Record<string, unknown> | undefined
  const multinode = vllmWorker?.multinode as Record<string, unknown> | undefined
  const nodeCount = multinode?.nodeCount as number | undefined
  return nodeCount && nodeCount > 1 ? nodeCount : 1
}

export function getNumericEngineArg(engineArgs: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = engineArgs?.[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

export function buildDynamoMultiNodeOverrides(nodeCount: number): Record<string, unknown> {
  return {
    spec: {
      services: {
        VllmWorker: {
          multinode: {
            nodeCount,
          },
        },
      },
    },
  }
}

export function setDynamoParallelismEngineArgs(
  engineArgs: Record<string, unknown> | undefined,
  multiNode: MultiNodeRecommendation | null
): Record<string, unknown> | undefined {
  const nextEngineArgs = { ...(engineArgs || {}) }

  if (multiNode) {
    nextEngineArgs[TENSOR_PARALLEL_SIZE_ARG] = String(multiNode.gpusPerNode)
    nextEngineArgs[PIPELINE_PARALLEL_SIZE_ARG] = String(multiNode.pipelineParallelSize)
  } else {
    delete nextEngineArgs[TENSOR_PARALLEL_SIZE_ARG]
    delete nextEngineArgs[PIPELINE_PARALLEL_SIZE_ARG]
  }

  return Object.keys(nextEngineArgs).length > 0 ? nextEngineArgs : undefined
}

/**
 * Merge or strip the FP8 precision engine args (`quantization`,
 * `kv-cache-dtype`) without clobbering other args. Sets a key to `fp8` when the
 * corresponding precision is FP8 and the engine supports the flag; otherwise
 * removes ONLY a value this control owns (`fp8`). A user-provided non-fp8 value
 * (e.g. `awq`/`gptq` typed into the advanced engine-args editor) is preserved,
 * since FP16/BF16 is merely the engine default and shouldn't override an
 * explicit user choice.
 */
export function setFp8PrecisionEngineArgs(
  engineArgs: Record<string, unknown> | undefined,
  opts: { weightFp8: boolean; kvFp8: boolean }
): Record<string, unknown> | undefined {
  const nextEngineArgs = { ...(engineArgs || {}) }

  if (opts.weightFp8) {
    nextEngineArgs[QUANTIZATION_ARG] = 'fp8'
  } else if (nextEngineArgs[QUANTIZATION_ARG] === 'fp8') {
    // Only strip the value WE set. A user-provided non-fp8 quantization
    // (e.g. awq, gptq) from the advanced engine-args editor is preserved.
    delete nextEngineArgs[QUANTIZATION_ARG]
  }

  if (opts.kvFp8) {
    nextEngineArgs[KV_CACHE_DTYPE_ARG] = 'fp8'
  } else if (nextEngineArgs[KV_CACHE_DTYPE_ARG] === 'fp8') {
    delete nextEngineArgs[KV_CACHE_DTYPE_ARG]
  }

  return Object.keys(nextEngineArgs).length > 0 ? nextEngineArgs : undefined
}
