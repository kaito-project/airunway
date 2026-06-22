import type { DetailedClusterCapacity, Model } from '@airunway/shared';
import { resolveModelParamCount } from '@airunway/shared';
import type { ThroughputParams } from '@/hooks/useGpuOperator';

/**
 * Whether the cluster has any GPU pool we could estimate on. Used purely as a
 * presence gate — the backend (`selectGpuForEstimate`) is the single source of
 * truth for *which* GPU the estimate runs on, so we deliberately do not forward
 * a concrete choice from here (avoids frontend/backend selection drift on mixed
 * clusters, e.g. 8xL4 + 1xH100).
 */
export function hasEstimableGpu(capacity?: DetailedClusterCapacity): boolean {
  return (capacity?.nodePools ?? []).some((p) => p.gpuModel);
}

/** Optional precision overrides for the throughput estimate. */
export interface QuantOverrides {
  /** Weight quantization (affects model memory footprint + decode speed). */
  quantization?: 'fp8' | 'int8' | 'fp16' | 'bf16';
  /** KV-cache precision (independent of weights; affects concurrency). */
  kvCacheDtype?: 'fp8' | 'int8' | 'fp16' | 'bf16';
}

/**
 * Build throughput-estimate query params for a model.
 * Returns undefined when there's nothing useful to ask for (no GPU, no params).
 *
 * `gpuPresent` only gates *whether* to estimate; the backend chooses which GPU
 * (highest-VRAM pool) so this never forwards a concrete gpuModel — keeping a
 * single source of truth for GPU selection.
 *
 * tpSize defaults to the model's minimum GPUs (bounded server-side); the Deploy
 * summary card and catalog cards use this default since they're outside the
 * deployment form where an explicit GPU-per-replica count would be chosen.
 *
 * `overrides` lets the Deploy page pass user-selected weight / KV-cache
 * precision; catalog cards omit it and use server defaults (fp16 / fp16 KV).
 */
export function buildThroughputParamsForGpu(
  model: Partial<Pick<Model, 'size' | 'parameterCount' | 'parameters' | 'contextLength' | 'minGpus'>> &
    Pick<Model, 'id'>,
  gpuPresent?: boolean,
  overrides?: QuantOverrides
): ThroughputParams | undefined {
  const paramCount = resolveModelParamCount(model);
  if (!paramCount || !gpuPresent) {
    return undefined;
  }
  return {
    modelId: model.id,
    paramCount,
    contextLen: model.contextLength,
    // gpuModel intentionally omitted — backend selects the highest-VRAM pool.
    tpSize: model.minGpus && model.minGpus > 0 ? model.minGpus : undefined,
    quantization: overrides?.quantization,
    kvCacheDtype: overrides?.kvCacheDtype,
  };
}

/**
 * Convenience for the Deploy page, which has detailed capacity (with node pools).
 */
export function buildThroughputParams(
  model: Pick<Model, 'id' | 'size' | 'parameterCount' | 'parameters' | 'contextLength' | 'minGpus'>,
  capacity?: DetailedClusterCapacity,
  overrides?: QuantOverrides
): ThroughputParams | undefined {
  return buildThroughputParamsForGpu(model, hasEstimableGpu(capacity), overrides);
}
