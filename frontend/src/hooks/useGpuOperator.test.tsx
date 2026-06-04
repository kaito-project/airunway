import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

// Mock the API module so getThroughput is a controllable spy: this lets us
// reject with a specific HTTP status and count how many times the query fires,
// without hitting MSW or the network.
vi.mock('@/lib/api', () => ({
  gpuOperatorApi: {
    getThroughput: vi.fn(),
  },
}))

import { useGpuThroughput } from './useGpuOperator'
import { gpuOperatorApi } from '@/lib/api'

const getThroughputMock = vi.mocked(gpuOperatorApi.getThroughput)

/**
 * Wrapper whose QueryClient has retries ENABLED (unlike the shared test-utils
 * client, which disables them globally). This is essential: it proves the
 * per-query `retry` override in useGpuThroughput actually takes effect rather
 * than being masked by a retry-disabled default.
 */
function createRetryWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: 5, // a clearly-retrying default that our per-query override must beat
        retryDelay: 0, // no backoff so retry-exercising tests stay fast
        gcTime: 0,
      },
    },
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

/** Build an error shaped like the api client's ApiError (status on `statusCode`). */
function apiError(statusCode: number, message = 'error') {
  return Object.assign(new Error(message), { name: 'ApiError', statusCode })
}

describe('useGpuThroughput retry policy', () => {
  beforeEach(() => {
    getThroughputMock.mockReset()
  })

  it('does not retry when the backend returns 404 (no known GPU spec)', async () => {
    getThroughputMock.mockRejectedValue(
      apiError(404, 'No GPU node pool with known specs found in the cluster.')
    )

    const { result } = renderHook(
      () => useGpuThroughput({ paramCount: 70_000_000_000 }),
      { wrapper: createRetryWrapper() }
    )

    await waitFor(() => expect(result.current.isError).toBe(true))

    // Exactly one request: the 4xx is deterministic, so no retries fire even
    // though the QueryClient default would otherwise retry 5×.
    expect(getThroughputMock).toHaveBeenCalledTimes(1)
  })

  it('does not retry on other 4xx client errors (e.g. 400)', async () => {
    getThroughputMock.mockRejectedValue(apiError(400, 'Invalid query params'))

    const { result } = renderHook(
      () => useGpuThroughput({ paramCount: 70_000_000_000 }),
      { wrapper: createRetryWrapper() }
    )

    await waitFor(() => expect(result.current.isError).toBe(true))

    expect(getThroughputMock).toHaveBeenCalledTimes(1)
  })

  it('still retries transient 5xx server errors (bounded budget)', async () => {
    getThroughputMock.mockRejectedValue(apiError(503, 'Service Unavailable'))

    const { result } = renderHook(
      () => useGpuThroughput({ paramCount: 70_000_000_000 }),
      { wrapper: createRetryWrapper() }
    )

    await waitFor(() => expect(result.current.isError).toBe(true))

    // More than one call proves 5xx is retried (unlike 4xx); the small upper
    // bound proves our `failureCount < 2` budget is applied rather than the
    // QueryClient's retry:5 default.
    const calls = getThroughputMock.mock.calls.length
    expect(calls).toBeGreaterThan(1)
    expect(calls).toBeLessThanOrEqual(3)
  })
})
