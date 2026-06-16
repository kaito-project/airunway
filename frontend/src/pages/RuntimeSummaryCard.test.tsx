import { fireEvent, render, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { RuntimeStatus } from '@/lib/api'

import { RuntimeSummaryCard } from './RuntimeSummaryCard'

function runtime(overrides: Partial<RuntimeStatus> = {}): RuntimeStatus {
  return {
    id: 'dynamo',
    name: 'Dynamo',
    installed: false,
    healthy: false,
    ...overrides,
  } as RuntimeStatus
}

function renderCard(overrides: Partial<Parameters<typeof RuntimeSummaryCard>[0]> = {}) {
  const onSelect = vi.fn()
  const props = {
    runtime: runtime(),
    effectiveRuntime: 'dynamo',
    pendingInstallRuntime: null,
    onSelect,
    ...overrides,
  }
  const view = render(<RuntimeSummaryCard {...props} />)
  return { ...props, ...view }
}

describe('RuntimeSummaryCard', () => {
  it('shows CRD-backed runtime status and selects canonical ids', () => {
    const { container, onSelect } = renderCard({
      runtime: runtime({ id: 'DYNAMO', name: 'Dynamo', installed: true, crdFound: true, operatorRunning: true, version: '1.0.0' }),
      effectiveRuntime: 'dynamo',
    })

    expect(within(container).getByText('Installed')).toBeInTheDocument()
    expect(within(container).getByText('NVIDIA Dynamo for high-performance GPU inference')).toBeInTheDocument()
    expect(within(container).getByText('Version')).toBeInTheDocument()
    fireEvent.click(container.firstElementChild as HTMLElement)
    expect(onSelect).toHaveBeenCalledWith('dynamo')
  })

  it('shows starting state while an operator runtime install is pending', () => {
    const { container } = renderCard({
      runtime: runtime({ id: 'kaito', name: 'KAITO', installed: false }),
      effectiveRuntime: 'kaito',
      pendingInstallRuntime: 'kaito',
    })

    expect(within(container).getByText('Starting')).toBeInTheDocument()
    expect(within(container).getByText('CRD')).toBeInTheDocument()
    expect(within(container).getByText('Operator')).toBeInTheDocument()
  })

  it('shows CRD-less ready and registered states without CRD rows', () => {
    const ready = renderCard({
      runtime: runtime({ id: 'vllm', name: 'vLLM', installed: true, healthy: true, requiresCRD: false }),
      effectiveRuntime: 'vllm',
    })
    expect(within(ready.container).getByText('Ready')).toBeInTheDocument()
    expect(within(ready.container).getByText('Runtime is ready to use.')).toBeInTheDocument()
    expect(within(ready.container).queryByText('CRD')).not.toBeInTheDocument()
    ready.unmount()

    const registered = renderCard({
      runtime: runtime({ id: 'llmd', name: 'LLM-D', installed: false, healthy: false, requiresCRD: false }),
      effectiveRuntime: 'llmd',
    })
    expect(within(registered.container).getByText('Registered')).toBeInTheDocument()
    expect(within(registered.container).getByText('Provider is registered but not ready yet.')).toBeInTheDocument()
  })
})
