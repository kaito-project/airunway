import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { Engine, RuntimeStatus } from '@/lib/api'

import { RuntimeSelectionPanel } from './RuntimeSelectionPanel'

function runtime(overrides: Partial<RuntimeStatus> = {}): RuntimeStatus {
  return {
    id: 'dynamo',
    name: 'Dynamo',
    installed: true,
    ...overrides,
  } as RuntimeStatus
}

function renderPanel(overrides: Partial<Parameters<typeof RuntimeSelectionPanel>[0]> = {}) {
  const onRuntimeChange = vi.fn()
  render(
    <MemoryRouter>
      <RuntimeSelectionPanel
        runtimes={[runtime({ id: 'dynamo', installed: true }), runtime({ id: 'vllm', installed: true })]}
        selectedRuntime="dynamo"
        modelEngines={['vllm']}
        onRuntimeChange={onRuntimeChange}
        {...overrides}
      />
    </MemoryRouter>
  )
  return { onRuntimeChange }
}

describe('RuntimeSelectionPanel', () => {
  it('renders compatible installed runtimes and emits changes', () => {
    const { onRuntimeChange } = renderPanel()

    expect(screen.getByText('NVIDIA Dynamo')).toBeInTheDocument()
    expect(screen.getByText('vLLM')).toBeInTheDocument()
    fireEvent.click(screen.getByText('vLLM'))
    expect(onRuntimeChange).toHaveBeenCalledWith('vllm')
  })

  it('shows incompatible runtime messaging and prevents selection', () => {
    const { onRuntimeChange } = renderPanel({
      runtimes: [runtime({ id: 'kuberay', installed: true })],
      selectedRuntime: 'kuberay',
      modelEngines: ['llamacpp'] as Engine[],
    })

    expect(screen.getByText('Not Compatible')).toBeInTheDocument()
    expect(screen.getByText(/This model requires llama\.cpp/i)).toBeInTheDocument()
    fireEvent.click(screen.getByText('KubeRay'))
    expect(onRuntimeChange).not.toHaveBeenCalled()
  })

  it('shows CRD-less registered and not-ready states', () => {
    renderPanel({
      runtimes: [
        runtime({ id: 'vllm', installed: true, requiresCRD: false }),
        runtime({ id: 'llmd', installed: false, requiresCRD: false }),
      ],
      selectedRuntime: 'llmd',
      modelEngines: ['vllm'],
    })

    expect(screen.getByText('Registered')).toBeInTheDocument()
    expect(screen.getByText('Not Ready')).toBeInTheDocument()
    expect(screen.getByText('Provider is registered but not ready yet.')).toBeInTheDocument()
  })

  it('links to installation for compatible operator runtimes that are not installed', () => {
    renderPanel({
      runtimes: [runtime({ id: 'dynamo', installed: false, requiresCRD: true })],
      selectedRuntime: 'dynamo',
      modelEngines: ['vllm'],
    })

    expect(screen.getByText('Not Installed')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Install NVIDIA Dynamo/i })).toHaveAttribute('href', '/installation')
  })
})
