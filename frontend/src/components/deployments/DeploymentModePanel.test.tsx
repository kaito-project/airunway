import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { DeploymentModePanel } from './DeploymentModePanel'

describe('DeploymentModePanel', () => {
  it('renders mode choices and calls onModeChange for non-KAITO runtimes', () => {
    const onModeChange = vi.fn()

    render(
      <DeploymentModePanel
        mode="aggregated"
        selectedRuntime="dynamo"
        aiConfigRecommendedMode="disaggregated"
        onModeChange={onModeChange}
      />
    )

    expect(screen.getByText('Deployment Mode')).toBeInTheDocument()
    expect(screen.getByText('Aggregated (Standard)')).toBeInTheDocument()
    expect(screen.getByText('Disaggregated (P/D)')).toBeInTheDocument()
    expect(screen.getByText('Optimized')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: /Disaggregated/i }))
    expect(onModeChange).toHaveBeenCalledWith('disaggregated')
  })

  it('disables disaggregated mode for KAITO', () => {
    const onModeChange = vi.fn()

    render(
      <DeploymentModePanel
        mode="aggregated"
        selectedRuntime="kaito"
        aiConfigRecommendedMode={null}
        onModeChange={onModeChange}
      />
    )

    const disaggregated = screen.getByRole('radio', { name: /Disaggregated/i })
    expect(disaggregated).toBeDisabled()
    expect(screen.getByText('Separate prefill and decode workers - not supported by KAITO')).toBeInTheDocument()

    fireEvent.click(disaggregated)
    expect(onModeChange).not.toHaveBeenCalled()
  })
})
