import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { HuggingFaceTokenPanel } from './HuggingFaceTokenPanel'

function renderPanel(overrides: Partial<Parameters<typeof HuggingFaceTokenPanel>[0]> = {}) {
  const props = {
    loading: false,
    configured: false,
    user: undefined,
    connecting: false,
    disconnecting: false,
    onConnect: vi.fn(),
    onDisconnect: vi.fn(),
    ...overrides,
  }
  render(<HuggingFaceTokenPanel {...props} />)
  return props
}

describe('HuggingFaceTokenPanel', () => {
  it('renders connected user state and disconnect action', () => {
    const props = renderPanel({
      configured: true,
      user: { name: 'test-user', fullname: 'Test User', avatarUrl: 'https://example.com/avatar.png' },
    })

    expect(screen.getByText('Test User')).toBeInTheDocument()
    expect(screen.getByText('@test-user')).toBeInTheDocument()
    expect(screen.getByText('Connected')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Disconnect HuggingFace/i }))
    expect(props.onDisconnect).toHaveBeenCalled()
  })

  it('renders sign-in state with emoji and connect action', () => {
    const props = renderPanel()

    const button = screen.getByRole('button', { name: /Sign in with Hugging Face/i })
    expect(button).toHaveTextContent('🤗')
    fireEvent.click(button)
    expect(props.onConnect).toHaveBeenCalled()
  })

  it('renders configured token fallback when user info is unavailable', () => {
    renderPanel({ configured: true, user: undefined })

    expect(screen.getAllByText('HuggingFace Token').length).toBeGreaterThan(0)
    expect(screen.getByText('Token configured')).toBeInTheDocument()
    expect(screen.getByText('Token saved successfully')).toBeInTheDocument()
  })

  it('renders loading and connecting states', () => {
    const { rerender } = render(<HuggingFaceTokenPanel loading configured={false} connecting={false} disconnecting={false} onConnect={vi.fn()} onDisconnect={vi.fn()} />)
    expect(screen.getByText('Checking HuggingFace connection...')).toBeInTheDocument()

    rerender(<HuggingFaceTokenPanel loading={false} configured={false} connecting disconnecting={false} onConnect={vi.fn()} onDisconnect={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Redirecting/i })).toBeDisabled()
  })
})
