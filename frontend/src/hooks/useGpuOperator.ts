import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { gpuOperatorApi, type GPUOperatorStatus, type GPUOperatorInstallResult, type ClusterGpuCapacity } from '@/lib/api'
import type { GpuThroughputEstimate } from '@airunway/shared'
import { getHfAccessToken } from './useHuggingFace'

export function useGpuOperatorStatus() {
  return useQuery<GPUOperatorStatus>({
    queryKey: ['gpu-operator-status'],
    queryFn: () => gpuOperatorApi.getStatus(),
    refetchInterval: 30000, // Refetch every 30 seconds
  })
}

export function useGpuCapacity() {
  return useQuery<ClusterGpuCapacity>({
    queryKey: ['gpu-capacity'],
    queryFn: () => gpuOperatorApi.getCapacity(),
    refetchInterval: 30000, // Refetch every 30 seconds
    staleTime: 10000, // Consider data stale after 10 seconds
  })
}

export interface ThroughputParams {
  modelId?: string
  paramCount?: number
  contextLen?: number
  quantization?: 'fp8' | 'int8' | 'fp16' | 'bf16'
  kvCacheDtype?: 'fp8' | 'int8' | 'fp16' | 'bf16'
  gpuModel?: string
  tpSize?: number
}

/**
 * Estimate inference throughput for a model on the cluster's GPUs.
 *
 * Pass `enabled: false` to defer the fetch (e.g. until a catalog card scrolls
 * into view) — this avoids firing an HF config.json lookup for every rendered
 * card. The query is also disabled until `paramCount` is known; the GPU model
 * is chosen server-side, so callers no longer need to supply one.
 */
export function useGpuThroughput(params: ThroughputParams, options?: { enabled?: boolean }) {
  const hfToken = getHfAccessToken()
  // Discriminate the cache by auth state (never the token itself) so that
  // switching between logged-in and logged-out recomputes the estimate: a gated
  // model yields a high-confidence result with a token but a low-confidence one
  // without, and the two must not share a cache entry.
  const authState = hfToken ? 'auth' : 'anon'
  // gpuModel is no longer sent by callers (the backend selects the GPU), so the
  // enable-gate keys off paramCount only. Callers still pass `enabled: false`
  // (or omit params entirely) when there's no GPU pool to estimate on.
  const enabled =
    (options?.enabled ?? true) && !!params.paramCount

  return useQuery<GpuThroughputEstimate>({
    queryKey: [
      'gpu-throughput',
      authState,
      params.modelId,
      params.gpuModel,
      params.paramCount,
      params.contextLen,
      params.tpSize,
      params.quantization,
      params.kvCacheDtype,
    ],
    queryFn: () => gpuOperatorApi.getThroughput(params, hfToken ?? undefined),
    enabled,
    staleTime: 5 * 60 * 1000, // estimates are stable; cache for 5 minutes
    // A 404 means no cluster GPU pool maps to a known spec — a deterministic
    // "no estimate" state, not a transient error. Don't retry any client error
    // (4xx); keep a small retry budget for transient server/network failures.
    retry: (failureCount, error) => {
      const statusCode = (error as { statusCode?: number }).statusCode
      if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
        return false
      }
      return failureCount < 2
    },
  })
}

export function useInstallGpuOperator() {
  const queryClient = useQueryClient()

  return useMutation<GPUOperatorInstallResult, Error>({
    mutationFn: () => gpuOperatorApi.install(),
    onSuccess: () => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ['gpu-operator-status'] })
      queryClient.invalidateQueries({ queryKey: ['gpu-capacity'] })
      queryClient.invalidateQueries({ queryKey: ['cluster-status'] })
    },
  })
}
