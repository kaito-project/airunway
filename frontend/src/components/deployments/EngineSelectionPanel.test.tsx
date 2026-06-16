import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { EngineSelectionPanel } from './EngineSelectionPanel'

function renderPanel(overrides: Partial<Parameters<typeof EngineSelectionPanel>[0]> = {}) {
  const onEngineChange = vi.fn()
  render(
    <EngineSelectionPanel
      selectedRuntime="dynamo"
      isVllmModel={false}
      runtimeName="NVIDIA Dynamo"
      availableEngines={['vllm', 'sglang', 'trtllm']}
      engine="vllm"
      aiConfigSupportedBackends={null}
      aiConfigRecommendedBackend={null}
      onEngineChange={onEngineChange}
      {...overrides}
    />
  )
  return { onEngineChange }
}

describe('EngineSelectionPanel', () => {
  it('renders compatible engines and emits engine changes', () => {
    const { onEngineChange } = renderPanel()

    expect(screen.getByText('vLLM')).toBeInTheDocument()
    expect(screen.getByText('SGLang')).toBeInTheDocument()
    expect(screen.getByText('TensorRT-LLM')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('SGLang'))
    expect(onEngineChange).toHaveBeenCalledWith('sglang')
  })

  it('disables engines outside AI Configurator supported backends and marks the recommendation', () => {
    const { onEngineChange } = renderPanel({
      aiConfigSupportedBackends: ['vllm'],
      aiConfigRecommendedBackend: 'vllm',
    })

    expect(screen.getByText('Optimized')).toBeInTheDocument()
    expect(screen.getByLabelText('SGLang')).toBeDisabled()
    fireEvent.click(screen.getByLabelText('SGLang'))
    expect(onEngineChange).not.toHaveBeenCalled()
    expect(screen.getByText(/Some engines are unavailable/i)).toBeInTheDocument()
  })

  it('shows static vLLM for KAITO vLLM models', () => {
    renderPanel({
      selectedRuntime: 'kaito',
      isVllmModel: true,
      availableEngines: ['vllm'],
    })

    expect(screen.getByLabelText('vLLM')).toBeInTheDocument()
    expect(screen.queryByText('SGLang')).not.toBeInTheDocument()
  })

  it('shows an empty-state message when no compatible engines exist', () => {
    renderPanel({ availableEngines: [], runtimeName: 'KubeRay' })

    expect(screen.getByText('No compatible engines available for this model with KubeRay.')).toBeInTheDocument()
  })
})
