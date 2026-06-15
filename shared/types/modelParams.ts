import type { Model } from './model';

/**
 * Canonical model parameter-count parsing — shared by the backend (catalog
 * search, throughput estimation) and the frontend (throughput-estimate query
 * builder) so the two never drift. Previously each side carried its own inline
 * regex; those copies disagreed on whitespace boundaries, the `illion`
 * long-form suffix, and the sanity guard. This module is the single source of
 * truth.
 */

/**
 * Parse a parameter count from a model name / ID / size string.
 * Handles common naming conventions like "8B", "70B", "1.5B", "0.6B", "405B",
 * "7b", "125M", "350m", etc.
 *
 * @param modelId - Model ID, name, or size string (e.g. "meta-llama/Llama-3.1-8B-Instruct", "0.6B")
 * @returns Absolute parameter count, or undefined if not parseable
 */
export function parseParameterCountFromName(modelId: string): number | undefined {
  // Match patterns like "8B", "70B", "1.5B", "0.6B", "405b", "7B", "1B" etc.
  // Must be preceded by start-of-string, hyphen, underscore, dot, or slash.
  // Case insensitive.
  const match = modelId.match(/(?:^|[-_./])(\d+(?:\.\d+)?)\s*[Bb](?:$|[-_./]|illion)?/);

  if (match) {
    const billions = parseFloat(match[1]);
    if (!isNaN(billions) && billions > 0 && billions < 10000) {
      // Convert billions to actual parameter count
      return billions * 1_000_000_000;
    }
  }

  // Also try matching "M" for millions (e.g., "125M", "350M")
  const millionMatch = modelId.match(/(?:^|[-_./])(\d+(?:\.\d+)?)\s*[Mm](?:$|[-_./]|illion)?/);

  if (millionMatch) {
    const millions = parseFloat(millionMatch[1]);
    if (!isNaN(millions) && millions > 0 && millions < 10000) {
      return millions * 1_000_000;
    }
  }

  return undefined;
}

/**
 * Resolve a numeric parameter count for a model, trying the most accurate
 * source first and falling back to parsing the name / size string.
 *
 * Precedence: explicit numeric `parameterCount` → `parameters` → parse `id` →
 * parse `size`. Returns undefined for unknown / unparseable models (e.g. MoE
 * strings like "8x7B").
 *
 * The signature is deliberately lenient (only `id` is required) so callers that
 * carry just an id + numeric count — e.g. HuggingFace search cards without a
 * `size` field — typecheck without constructing a full Model.
 */
export function resolveModelParamCount(
  model: Partial<Pick<Model, 'parameterCount' | 'parameters' | 'size'>> & Pick<Model, 'id'>
): number | undefined {
  if (typeof model.parameterCount === 'number' && model.parameterCount > 0) {
    return model.parameterCount;
  }
  if (typeof model.parameters === 'number' && model.parameters > 0) {
    return model.parameters;
  }
  if (model.id) {
    const fromId = parseParameterCountFromName(model.id);
    if (fromId) return fromId;
  }
  if (model.size) {
    const fromSize = parseParameterCountFromName(model.size);
    if (fromSize) return fromSize;
  }
  return undefined;
}
