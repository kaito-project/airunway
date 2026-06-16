import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { DeploymentConfig } from '@/hooks/useDeployments'
import type { AIConfiguratorResult } from '@/lib/api'

import { PIPELINE_PARALLEL_SIZE_ARG, TENSOR_PARALLEL_SIZE_ARG } from './deploymentFormModel'
import { useDeploymentAIConfiguratorState } from './useDeploymentAIConfiguratorState'

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

function aiResult(overrides: Partial<AIConfiguratorResult> = {}): AIConfiguratorResult {
  return {
    success: true,
    backend: 'vllm',
    supportedBackends: ['vllm', 'sglang'],
    mode: 'aggregated',
    replicas: 2,
    config: {
      tensorParallelDegree: 4,
      pipelineParallelDegree: 3,
      maxBatchSize: 8192,
      gpuMemoryUtilization: 0.9,
      maxModelLen: 16384,
    },
    ...overrides,
  }
}

describe('useDeploymentAIConfiguratorState', () => {
  it('applies recommendations to local UI state, DeploymentConfig, and toast', () => {
    const setConfig = vi.fn()
    const toast = vi.fn()
    const { result } = renderHook(() => useDeploymentAIConfiguratorState({
      selectedRuntime: 'dynamo',
      setConfig,
      toast,
    }))

    act(() => result.current.applyConfig(aiResult()))

    expect(result.current.supportedBackends).toEqual(['vllm', 'sglang'])
    expect(result.current.recommendedBackend).toBe('vllm')
    expect(result.current.recommendedMode).toBe('aggregated')
    expect(result.current.recommendedValues).toEqual({
      prefillReplicas: undefined,
      decodeReplicas: undefined,
      prefillGpus: 4,
      decodeGpus: 4,
      gpuPerReplica: 4,
    })
    expect(result.current.topologyManagedByAIConfig).toBe(true)

    expect(setConfig).toHaveBeenCalledTimes(1)
    const updated = setConfig.mock.calls[0][0](baseConfig({ engineArgs: { custom: 'keep' } }))
    expect(updated).toMatchObject({
      mode: 'aggregated',
      replicas: 2,
      contextLength: 16384,
      engine: 'vllm',
      resources: { gpu: 4 },
      engineArgs: {
        custom: 'keep',
        'max-num-batched-tokens': 8192,
        'gpu-memory-utilization': 0.9,
        [TENSOR_PARALLEL_SIZE_ARG]: '4',
        [PIPELINE_PARALLEL_SIZE_ARG]: '3',
      },
    })
    expect(toast).toHaveBeenCalledWith({
      title: 'Configuration Applied',
      description: 'AI Configurator recommendations applied. TP=4, PP=3, Context=16384, Engine=VLLM',
      variant: 'success',
    })
  })

  it('marks manual topology edits without clearing recommendation badges', () => {
    const { result } = renderHook(() => useDeploymentAIConfiguratorState({
      selectedRuntime: 'dynamo',
      setConfig: vi.fn(),
      toast: vi.fn(),
    }))

    act(() => result.current.applyConfig(aiResult()))
    act(() => result.current.markTopologyManuallyEdited())

    expect(result.current.topologyManagedByAIConfig).toBe(false)
    expect(result.current.supportedBackends).toEqual(['vllm', 'sglang'])
    expect(result.current.recommendedBackend).toBe('vllm')
  })

  it('clears AI Configurator state on discard and when switching away from Dynamo', () => {
    const { result } = renderHook(() => useDeploymentAIConfiguratorState({
      selectedRuntime: 'dynamo',
      setConfig: vi.fn(),
      toast: vi.fn(),
    }))

    act(() => result.current.applyConfig(aiResult()))
    act(() => result.current.discard())
    expect(result.current.supportedBackends).toBeNull()
    expect(result.current.recommendedBackend).toBeNull()
    expect(result.current.recommendedMode).toBeNull()
    expect(result.current.recommendedValues).toBeNull()
    expect(result.current.topologyManagedByAIConfig).toBe(false)

    act(() => result.current.applyConfig(aiResult()))
    act(() => result.current.resetForRuntime('kaito'))
    expect(result.current.supportedBackends).toBeNull()
    expect(result.current.recommendedBackend).toBeNull()
    expect(result.current.recommendedMode).toBeNull()
    expect(result.current.recommendedValues).toBeNull()
    expect(result.current.topologyManagedByAIConfig).toBe(false)
  })
})
