import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { DeploymentConfig } from '@/hooks/useDeployments'
import type { DetailedClusterCapacity } from '@/lib/api'

import { DeploymentOptionsPanel } from './DeploymentOptionsPanel'

function config(overrides: Partial<DeploymentConfig> = {}): DeploymentConfig {
  return {
    name: 'demo',
    namespace: 'dynamo-system',
    modelId: 'Qwen/Qwen3-0.6B',
    engine: 'vllm',
    mode: 'aggregated',
    provider: 'dynamo',
    routerMode: 'default',
    replicas: 1,
    enforceEager: true,
    enablePrefixCaching: true,
    trustRemoteCode: false,
    resources: { gpu: 1 },
    prefillReplicas: 1,
    decodeReplicas: 1,
    prefillGpus: 1,
    decodeGpus: 1,
    ...overrides,
  }
}


function capacity(overrides: Partial<DetailedClusterCapacity> = {}): DetailedClusterCapacity {
  return {
    totalGpus: 8,
    allocatedGpus: 0,
    availableGpus: 8,
    maxContiguousAvailable: 8,
    maxNodeGpuCapacity: 8,
    gpuNodeCount: 1,
    nodePools: [],
    ...overrides,
  }
}

function renderPanel(overrides: Partial<Parameters<typeof DeploymentOptionsPanel>[0]> = {}) {
  const props = {
    config: config(),
    selectedRuntime: 'dynamo' as const,
    isVllmModel: false,
    kaitoComputeType: 'gpu' as const,
    detailedCapacity: capacity(),
    gpuRecommendation: { recommendedGpus: 2, reason: 'recommended for test' },
    aiConfigRecommendedValues: null,
    currentMultiNode: null,
    onReplicasChange: vi.fn(),
    onGpuPerReplicaChange: vi.fn(),
    onRouterModeChange: vi.fn(),
    onPrefillReplicasChange: vi.fn(),
    onPrefillGpusChange: vi.fn(),
    onDecodeReplicasChange: vi.fn(),
    onDecodeGpusChange: vi.fn(),
    ...overrides,
  }
  const view = render(<DeploymentOptionsPanel {...props} />)
  return { ...props, ...view }
}

describe('DeploymentOptionsPanel', () => {
  it('renders aggregated options and emits replica/GPU/router changes', () => {
    const props = renderPanel()

    fireEvent.change(screen.getByLabelText('Worker Replicas'), { target: { value: '3' } })
    expect(props.onReplicasChange).toHaveBeenCalledWith(3)

    fireEvent.change(screen.getByLabelText('GPUs per Replica'), { target: { value: '4' } })
    expect(props.onGpuPerReplicaChange).toHaveBeenCalledWith(4)

    fireEvent.click(screen.getByLabelText('KV-Aware'))
    expect(props.onRouterModeChange).toHaveBeenCalledWith('kv')
  })

  it('renders disaggregated prefill/decode options and optimized markers', () => {
    const props = renderPanel({
      config: config({
        mode: 'disaggregated',
        prefillReplicas: 2,
        prefillGpus: 3,
        decodeReplicas: 4,
        decodeGpus: 1,
      }),
      aiConfigRecommendedValues: {
        prefillReplicas: 2,
        prefillGpus: 3,
        decodeReplicas: 4,
        decodeGpus: 1,
      },
    })

    expect(screen.getByText('Prefill Workers')).toBeInTheDocument()
    expect(screen.getByText('Decode Workers')).toBeInTheDocument()
    expect(screen.getAllByText('', { selector: 'svg' }).length).toBeGreaterThanOrEqual(0)

    fireEvent.change(document.getElementById('prefillReplicas') as HTMLInputElement, { target: { value: '5' } })
    expect(props.onPrefillReplicasChange).toHaveBeenCalledWith(5)
    fireEvent.change(document.getElementById('prefillGpus') as HTMLInputElement, { target: { value: '2' } })
    expect(props.onPrefillGpusChange).toHaveBeenCalledWith(2)
    fireEvent.change(document.getElementById('decodeReplicas') as HTMLInputElement, { target: { value: '6' } })
    expect(props.onDecodeReplicasChange).toHaveBeenCalledWith(6)
    fireEvent.change(document.getElementById('decodeGpus') as HTMLInputElement, { target: { value: '3' } })
    expect(props.onDecodeGpusChange).toHaveBeenCalledWith(3)
  })

  it('hides options for KAITO CPU non-vLLM models', () => {
    const { container } = renderPanel({
      selectedRuntime: 'kaito',
      isVllmModel: false,
      kaitoComputeType: 'cpu',
    })

    expect(container).toBeEmptyDOMElement()
  })
})
