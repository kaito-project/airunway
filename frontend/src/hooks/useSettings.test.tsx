import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useSettings, useUpdateSettings, useProviders, useProviderDetails } from './useSettings'
import { createWrapper, createTestQueryClient } from '@/test/test-utils'
import { QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

describe('useSettings', () => {
  it('fetches settings', async () => {
    const { result } = renderHook(() => useSettings(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toBeDefined()
    expect(result.current.data?.config).toBeDefined()
    expect(result.current.data?.providers).toBeDefined()
  })

  it('returns the settings catalog list', async () => {
    const { result } = renderHook(() => useSettings(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data?.providers).toBeDefined()
    expect(Array.isArray(result.current.data?.providers)).toBe(true)
  })
})

describe('useUpdateSettings', () => {
  it('updates settings and invalidates queries', async () => {
    const queryClient = createTestQueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    )

    const { result } = renderHook(() => useUpdateSettings(), { wrapper })

    result.current.mutate({ defaultNamespace: 'custom-namespace' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toBeDefined()
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['settings'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['cluster-status'] })
  })
})

describe('useProviders', () => {
  it('fetches the runtime catalog list', async () => {
    const { result } = renderHook(() => useProviders(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data?.providers).toBeDefined()
    expect(Array.isArray(result.current.data?.providers)).toBe(true)
    expect(result.current.data!.providers.length).toBeGreaterThan(0)
  })

  it('returns catalog entries with required fields', async () => {
    const { result } = renderHook(() => useProviders(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const entry = result.current.data!.providers[0]
    expect(entry.id).toBeDefined()
    expect(entry.name).toBeDefined()
    expect(entry.description).toBeDefined()
  })
})

describe('useProviderDetails', () => {
  it('fetches catalog details by id', async () => {
    const { result } = renderHook(() => useProviderDetails('runtime-a'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toBeDefined()
    expect(result.current.data?.id).toBe('runtime-a')
    expect(result.current.data?.name).toBeDefined()
    expect(result.current.data?.crdConfig).toBeDefined()
  })

  it('does not fetch when id is empty', async () => {
    const { result } = renderHook(() => useProviderDetails(''), {
      wrapper: createWrapper(),
    })

    expect(result.current.fetchStatus).toBe('idle')
  })
})
