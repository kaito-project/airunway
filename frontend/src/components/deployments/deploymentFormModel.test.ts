import { describe, expect, it } from 'vitest'
import type { DeploymentConfig } from '@/hooks/useDeployments'
import type { AIConfiguratorResult } from '@/lib/api'

import {
  PIPELINE_PARALLEL_SIZE_ARG,
  TENSOR_PARALLEL_SIZE_ARG,
  applyAIConfiguratorResultToConfig,
  applyRuntimeChangeToConfig,
  getAIConfigRecommendedValues,
  getAIConfiguratorAppliedToastDescription,
  getAvailableEnginesForRuntime,
  getDefaultEngineForRuntime,
  getDefaultRuntimeForModel,
  getNodeCountFromOverrides,
} from './deploymentFormModel'

function baseConfig(overrides: Partial<DeploymentConfig> = {}): DeploymentConfig {
  return {
    name: 'demo',
    namespace: 'dynamo-system',
    modelId: 'Qwen/Qwen3-0.6B',
    engine: 'vllm',
    mode: 'aggregated',
    provider: 'dynamo',
    routerMode: 'kv',
    replicas: 1,
    enforceEager: true,
    enablePrefixCaching: true,
    trustRemoteCode: false,
    resources: { gpu: 1 },
    ...overrides,
  }
}

describe('deploymentFormModel', () => {
  it('selects the best default runtime from installed compatible runtimes', () => {
    expect(getDefaultRuntimeForModel(['llamacpp'], undefined)).toBe('kaito')
    expect(getDefaultRuntimeForModel(['vllm'], undefined)).toBe('dynamo')
    expect(getDefaultRuntimeForModel(['vllm'], [
      { id: 'kuberay', installed: false },
      { id: 'vllm', installed: true },
      { id: 'dynamo', installed: false },
    ])).toBe('vllm')
    expect(getDefaultRuntimeForModel(['vllm'], [
      { id: 'kuberay', installed: false },
      { id: 'vllm', installed: false },
    ])).toBe('kuberay')
  })

  it('filters available engines by runtime and chooses a default engine', () => {
    expect(getAvailableEnginesForRuntime('dynamo', ['vllm', 'trtllm', 'llamacpp'])).toEqual(['vllm', 'trtllm'])
    expect(getAvailableEnginesForRuntime('kuberay', ['vllm', 'sglang'])).toEqual(['vllm'])
    expect(getDefaultEngineForRuntime('dynamo', ['llamacpp'])).toBe('llamacpp')
    expect(getDefaultEngineForRuntime('kuberay', ['sglang', 'vllm'])).toBe('vllm')
  })

  it('switches away from Dynamo by resetting runtime-specific fields and unsupported engines', () => {
    const next = applyRuntimeChangeToConfig(baseConfig({
      engine: 'sglang',
      providerOverrides: { spec: { services: { VllmWorker: { multinode: { nodeCount: 2 } } } } },
      engineArgs: {
        [TENSOR_PARALLEL_SIZE_ARG]: '4',
        [PIPELINE_PARALLEL_SIZE_ARG]: '2',
        custom: 'keep',
      },
    }), {
      runtime: 'kaito',
      modelEngines: ['vllm', 'sglang'],
      recommendedGpus: 1,
    })

    expect(next.provider).toBe('kaito')
    expect(next.namespace).toBe('kaito-workspace')
    expect(next.engine).toBe('vllm')
    expect(next.routerMode).toBe('default')
    expect(next.mode).toBe('aggregated')
    expect(next.providerOverrides).toBeUndefined()
    expect(next.engineArgs).toEqual({ custom: 'keep' })
  })

  it('recalculates Dynamo multi-node parallelism when switching to Dynamo vLLM', () => {
    const next = applyRuntimeChangeToConfig(baseConfig({
      namespace: 'kuberay-system',
      provider: 'kuberay',
      engine: 'vllm',
      resources: { gpu: 4 },
      engineArgs: { custom: 'keep' },
    }), {
      runtime: 'dynamo',
      modelEngines: ['vllm'],
      recommendedGpus: 4,
      estimatedMemoryGb: 900,
      gpuMemoryGb: 80,
    })

    expect(next.provider).toBe('dynamo')
    expect(next.namespace).toBe('dynamo-system')
    expect(getNodeCountFromOverrides(next.providerOverrides)).toBe(3)
    expect(next.engineArgs).toEqual({
      custom: 'keep',
      [TENSOR_PARALLEL_SIZE_ARG]: '4',
      [PIPELINE_PARALLEL_SIZE_ARG]: '3',
    })
  })

  it('applies aggregated AI Configurator recommendations including Dynamo parallelism', () => {
    const result: AIConfiguratorResult = {
      success: true,
      backend: 'vllm',
      supportedBackends: ['vllm'],
      mode: 'aggregated',
      replicas: 2,
      config: {
        tensorParallelDegree: 4,
        pipelineParallelDegree: 3,
        maxBatchSize: 8192,
        maxNumSeqs: 64,
        gpuMemoryUtilization: 0.92,
        maxModelLen: 16384,
      },
    }

    const next = applyAIConfiguratorResultToConfig(baseConfig({
      engine: 'sglang',
      engineArgs: { custom: 'keep' },
    }), result, 'dynamo')

    expect(next.engine).toBe('vllm')
    expect(next.mode).toBe('aggregated')
    expect(next.replicas).toBe(2)
    expect(next.contextLength).toBe(16384)
    expect(next.resources?.gpu).toBe(4)
    expect(getNodeCountFromOverrides(next.providerOverrides)).toBe(3)
    expect(next.engineArgs).toEqual({
      custom: 'keep',
      'max-num-batched-tokens': 8192,
      'gpu-memory-utilization': 0.92,
      'max-num-seqs': 64,
      [TENSOR_PARALLEL_SIZE_ARG]: '4',
      [PIPELINE_PARALLEL_SIZE_ARG]: '3',
    })
    expect(getAIConfiguratorAppliedToastDescription(result)).toBe(
      'AI Configurator recommendations applied. TP=4, PP=3, Context=16384, Engine=VLLM'
    )
  })

  it('applies disaggregated AI Configurator recommendations and exposes badge values', () => {
    const result: AIConfiguratorResult = {
      success: true,
      backend: 'sglang',
      mode: 'disaggregated',
      replicas: 1,
      config: {
        tensorParallelDegree: 2,
        maxBatchSize: 4096,
        gpuMemoryUtilization: 0.85,
        maxModelLen: 8192,
        prefillReplicas: 2,
        decodeReplicas: 3,
        prefillTensorParallel: 4,
        decodeTensorParallel: 1,
      },
    }

    const next = applyAIConfiguratorResultToConfig(baseConfig(), result, 'dynamo')

    expect(next.engine).toBe('sglang')
    expect(next.mode).toBe('disaggregated')
    expect(next.prefillReplicas).toBe(2)
    expect(next.decodeReplicas).toBe(3)
    expect(next.prefillGpus).toBe(4)
    expect(next.decodeGpus).toBe(1)
    expect(next.providerOverrides).toBeUndefined()
    expect(getAIConfigRecommendedValues(result)).toEqual({
      prefillReplicas: 2,
      decodeReplicas: 3,
      prefillGpus: 4,
      decodeGpus: 1,
      gpuPerReplica: 2,
    })
  })

})
