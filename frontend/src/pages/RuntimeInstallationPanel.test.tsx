import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { InstallationStatus } from '@/lib/api'

import { RuntimeInstallationPanel } from './RuntimeInstallationPanel'

function installation(overrides: Partial<InstallationStatus> = {}): InstallationStatus {
  return {
    installed: false,
    crdFound: false,
    operatorRunning: false,
    providerName: 'Dynamo',
    message: 'Checking installation status...',
    installCommands: [],
    ...overrides,
  } as InstallationStatus
}

function renderPanel(overrides: Partial<Parameters<typeof RuntimeInstallationPanel>[0]> = {}) {
  const props = {
    installationStatus: installation(),
    currentRuntimeName: 'Dynamo',
    requiresCRD: true,
    isInstalled: false,
    isWaitingForInstall: false,
    message: 'Dynamo is not installed',
    loading: false,
    effectiveRuntime: 'dynamo',
    isInstalling: false,
    isUninstalling: false,
    helmAvailable: true,
    clusterConnected: true,
    installationLoading: false,
    onInstall: vi.fn(),
    onShowUninstall: vi.fn(),
    onRefresh: vi.fn(),
    onCopyCommand: vi.fn(),
    ...overrides,
  }
  const view = render(<RuntimeInstallationPanel {...props} />)
  return { ...props, ...view }
}

describe('RuntimeInstallationPanel', () => {
  it('shows CRD-backed install status, install action, refresh, and manual steps', () => {
    const props = renderPanel({
      installationStatus: installation({
        providerName: 'Dynamo',
        crdFound: true,
        operatorRunning: false,
        installationSteps: [
          { title: 'Install CRD', description: 'Install the runtime API', command: 'kubectl apply -f crd.yaml' },
        ],
      }),
    })

    expect(screen.getByText('Dynamo Installation')).toBeInTheDocument()
    expect(screen.getByText('CRD Installed')).toBeInTheDocument()
    expect(screen.getByText('Operator Running')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Install Dynamo/i }))
    expect(props.onInstall).toHaveBeenCalledWith('dynamo')

    fireEvent.click(screen.getByRole('button', { name: /Refresh runtime status/i }))
    expect(props.onRefresh).toHaveBeenCalled()

    expect(screen.getByText('Manual Installation Steps')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Copy Install CRD command/i }))
    expect(props.onCopyCommand).toHaveBeenCalledWith('kubectl apply -f crd.yaml')
  })

  it('shows uninstall action for installed operator runtimes and Helm warning when Helm is missing', () => {
    const props = renderPanel({
      installationStatus: installation({ installed: true, crdFound: true, operatorRunning: true }),
      isInstalled: true,
      helmAvailable: true,
    })

    fireEvent.click(screen.getByRole('button', { name: /^Uninstall$/i }))
    expect(props.onShowUninstall).toHaveBeenCalled()

    props.rerender(<RuntimeInstallationPanel {...props} helmAvailable={false} />)
    expect(screen.getByText('Helm CLI not available')).toBeInTheDocument()
  })

  it('shows CRD-less runtime status without install controls', () => {
    const { container } = renderPanel({
      installationStatus: installation({ providerName: 'vLLM', requiresCRD: false }),
      currentRuntimeName: 'vLLM',
      requiresCRD: false,
      isInstalled: true,
      message: 'Runtime is ready to use.',
      effectiveRuntime: 'vllm',
    })

    expect(screen.getByText('vLLM Status')).toBeInTheDocument()
    expect(screen.getByText('Ready')).toBeInTheDocument()
    expect(screen.getAllByText('Runtime is ready to use.').length).toBeGreaterThan(0)
    expect(within(container).queryByRole('button')).not.toBeInTheDocument()
  })
})
