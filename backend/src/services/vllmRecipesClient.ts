import type {
  VllmRecipeIndexEntry,
  VllmRecipeListResponse,
  VllmRecipeRawResponse,
} from '@airunway/shared';
import logger from '../lib/logger';

const DEFAULT_RECIPES_BASE_URL = 'https://recipes.vllm.ai';

// Abort recipe fetches that stall so a slow/unreachable recipes host cannot
// tie up request handlers and degrade backend availability.
const FETCH_TIMEOUT_MS = 10_000;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function splitModelId(modelId: string): { org: string; model: string } {
  // A Hugging Face model ID must be exactly "<org>/<model>": a single slash,
  // both segments non-empty, and neither segment a path-traversal token. This
  // prevents crafted IDs like "foo/a/b" or "foo/../bar" from escaping the
  // recipes base path when the segments are interpolated into a fetch URL.
  const segments = modelId.split('/');
  if (segments.length !== 2) {
    throw new Error(`Invalid Hugging Face model ID: ${modelId}`);
  }

  const [org, model] = segments;
  if (!org || !model || org === '.' || org === '..' || model === '.' || model === '..') {
    throw new Error(`Invalid Hugging Face model ID: ${modelId}`);
  }

  return { org, model };
}

export class VllmRecipesClient {
  constructor(private readonly baseUrl = process.env.VLLM_RECIPES_BASE_URL || DEFAULT_RECIPES_BASE_URL) {}

  get sourceBaseUrl(): string {
    return this.baseUrl.replace(/\/+$/, '');
  }

  async list(): Promise<VllmRecipeListResponse> {
    const source = `${this.sourceBaseUrl}/models.json`;
    const payload = await this.fetchJson<unknown>(source);

    let entries: unknown;
    if (Array.isArray(payload)) {
      entries = payload;
    } else if (isRecord(payload)) {
      entries = payload.models ?? payload.recipes;
    }

    if (!Array.isArray(entries)) {
      throw new Error('vLLM recipe index did not contain a models array');
    }

    const recipes = entries.filter(isRecord).map((entry) => ({ ...entry }) as VllmRecipeIndexEntry);

    return {
      recipes,
      total: recipes.length,
      source,
    };
  }

  async get(org: string, model: string): Promise<VllmRecipeRawResponse> {
    return this.getByModelId(`${org}/${model}`);
  }

  async getByModelId(modelId: string): Promise<VllmRecipeRawResponse> {
    const { org, model } = splitModelId(modelId);
    const source = `${this.sourceBaseUrl}/${encodeURIComponent(org)}/${encodeURIComponent(model)}.json`;
    const payload = await this.fetchJson<unknown>(source);

    if (!isRecord(payload)) {
      throw new Error(`vLLM recipe payload for ${modelId} was not a JSON object`);
    }

    return {
      modelId,
      source,
      recipe: payload,
    };
  }

  async fetchReference(reference: string): Promise<JsonRecord> {
    const source = this.resolveReference(reference);
    const payload = await this.fetchJson<unknown>(source);

    if (!isRecord(payload)) {
      throw new Error(`vLLM recipe reference ${source} was not a JSON object`);
    }

    return payload;
  }

  resolveReference(reference: string): string {
    const baseUrl = new URL(`${this.sourceBaseUrl}/`);
    const resolved = new URL(reference, baseUrl);

    if (resolved.protocol !== 'https:') {
      throw new Error(`vLLM recipe references must use HTTPS: ${reference}`);
    }

    if (resolved.origin !== baseUrl.origin) {
      throw new Error(`vLLM recipe references must stay under ${baseUrl.origin}: ${reference}`);
    }

    if (!resolved.pathname.startsWith(baseUrl.pathname)) {
      throw new Error(`vLLM recipe references must stay under ${this.sourceBaseUrl}: ${reference}`);
    }

    return resolved.toString();
  }

  private async fetchJson<T>(url: string): Promise<T> {
    logger.debug({ url }, 'Fetching vLLM recipe JSON');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Timed out fetching ${url} after ${FETCH_TIMEOUT_MS}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as T;
  }
}

export const vllmRecipesClient = new VllmRecipesClient();
