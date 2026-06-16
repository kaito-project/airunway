import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { GatewayCRDStatus } from '@/lib/api'

import { GatewayApiPanel } from './GatewayApiPanel'

function status(overrides: Partial<GatewayCRDStatus> = {}): GatewayCRDStatus {
  return {
    gatewayApiInstalled: false,
    inferenceExtInstalled: false,
    pinnedVersion: 'v1.5.0',
    gatewayAvailable: false,
    message: 'Gateway API and Inference Extension CRDs are not installed.',
    installCommands: ['kubectl apply -f gateway.yaml'],
    ...overrides,
  }
}

function renderPanel(overrides: Partial<Parameters<typeof GatewayApiPanel>[0]> = {}) {
  const props = {
    status: status(),
    loading: false,
    installing: false,
    clusterConnected: true,
    onRefresh: vi.fn(),
    onInstall: vi.fn(),
    onCopyCommand: vi.fn(),
    ...overrides,
  }
  render(<GatewayApiPanel {...props} />)
  return props
}

describe('GatewayApiPanel', () => {
  it('renders missing CRD state, install action, refresh, and manual commands', () => {
    const props = renderPanel()

    expect(screen.getByText('Gateway API CRDs')).toBeInTheDocument()
    expect(screen.getByText('Inference Extension')).toBeInTheDocument()
    expect(screen.getByText('Gateway API and Inference Extension CRDs are not installed.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Install CRDs/i }))
    expect(props.onInstall).toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /Copy/i }))
    expect(props.onCopyCommand).toHaveBeenCalledWith('kubectl apply -f gateway.yaml')

    fireEvent.click(screen.getByRole('button', { name: /Refresh gateway status/i }))
    expect(props.onRefresh).toHaveBeenCalled()
  })

  it('renders installed Gateway availability with endpoint and no install action', () => {
    renderPanel({
      status: status({
        gatewayApiInstalled: true,
        inferenceExtInstalled: true,
        inferenceExtVersion: 'v1.5.0',
        gatewayAvailable: true,
        gatewayEndpoint: '10.0.0.50',
        message: 'Gateway API and Inference Extension CRDs are installed. Gateway is available.',
      }),
    })

    expect(screen.getByText('(v1.5.0)')).toBeInTheDocument()
    expect(screen.getByText('Gateway')).toBeInTheDocument()
    expect(screen.getByText('10.0.0.50')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Install CRDs/i })).not.toBeInTheDocument()
  })

  it('renders loading state', () => {
    renderPanel({ loading: true })
    expect(screen.getByText('Checking gateway CRD status...')).toBeInTheDocument()
  })
})
