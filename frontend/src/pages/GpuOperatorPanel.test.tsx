import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { GPUOperatorStatus } from '@/lib/api'
import { GpuOperatorPanel } from './GpuOperatorPanel'

function gpuStatus(overrides: Partial<GPUOperatorStatus> = {}): GPUOperatorStatus {
  return {
    installed: false,
    crdFound: false,
    operatorRunning: false,
    gpusAvailable: false,
    totalGPUs: 0,
    gpuNodes: [],
    message: 'GPU Operator is not installed',
    helmCommands: [],
    ...overrides,
  }
}

function renderPanel(overrides: Partial<Parameters<typeof GpuOperatorPanel>[0]> = {}) {
  const props = {
    status: gpuStatus(),
    loading: false,
    installing: false,
    clusterConnected: true,
    helmAvailable: true,
    onInstall: vi.fn(),
    onCopyCommand: vi.fn(),
    ...overrides,
  }
  render(<GpuOperatorPanel {...props} />)
  return props
}

describe('GpuOperatorPanel', () => {
  it('renders GPUs available status with node names', () => {
    renderPanel({
      status: gpuStatus({
        installed: true,
        crdFound: true,
        operatorRunning: true,
        gpusAvailable: true,
        totalGPUs: 2,
        gpuNodes: ['gpu-node-a', 'gpu-node-b'],
        message: 'GPU Operator is running',
      }),
    })

    expect(screen.getByText('GPUs Enabled')).toBeInTheDocument()
    expect(screen.getByText('GPU Operator is running')).toBeInTheDocument()
    expect(screen.getByText('Nodes: gpu-node-a, gpu-node-b')).toBeInTheDocument()
  })

  it('renders installed operator state when no GPUs are available', () => {
    renderPanel({
      status: gpuStatus({
        installed: true,
        crdFound: true,
        operatorRunning: true,
        message: 'No GPU nodes found',
      }),
    })

    expect(screen.getByText('Operator Installed')).toBeInTheDocument()
    expect(screen.getByText('No GPU nodes found')).toBeInTheDocument()
  })

  it('renders install prompt and calls install when switch is enabled', () => {
    const props = renderPanel()

    const installSwitch = screen.getByRole('switch', { name: /Enable GPU Operator/i })
    expect(installSwitch).not.toBeDisabled()

    fireEvent.click(installSwitch)
    expect(props.onInstall).toHaveBeenCalledOnce()
  })

  it('shows unmet prerequisites and disables install switch', () => {
    renderPanel({ clusterConnected: false, helmAvailable: false })

    expect(screen.getByText('Prerequisites not met')).toBeInTheDocument()
    expect(screen.getByText('Not connected')).toBeInTheDocument()
    expect(screen.getByText('Helm CLI not available')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: /Enable GPU Operator/i })).toBeDisabled()
  })

  it('renders loading, installing, and manual commands', () => {
    const { rerender } = render(
      <GpuOperatorPanel
        loading
        installing={false}
        clusterConnected
        helmAvailable
        onInstall={vi.fn()}
        onCopyCommand={vi.fn()}
      />,
    )
    expect(screen.getByText('Checking GPU status...')).toBeInTheDocument()

    const onCopyCommand = vi.fn()
    rerender(
      <GpuOperatorPanel
        status={gpuStatus({ helmCommands: ['helm repo add nvidia example', 'helm install gpu-operator'] })}
        loading={false}
        installing
        clusterConnected
        helmAvailable
        onInstall={vi.fn()}
        onCopyCommand={onCopyCommand}
      />,
    )

    expect(screen.getByText('Installing GPU Operator... This may take several minutes.')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Copy' })[0])
    expect(onCopyCommand).toHaveBeenCalledWith('helm repo add nvidia example')
  })
})
