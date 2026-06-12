import { describe, expect, test } from 'bun:test';
import { VllmRecipesClient } from './vllmRecipesClient';

describe('VllmRecipesClient', () => {
  test('resolves relative recipe references under the configured recipe base URL', () => {
    const client = new VllmRecipesClient('https://recipes.vllm.ai/catalog');

    expect(client.resolveReference('microsoft/Phi-4-mini-instruct.json')).toBe(
      'https://recipes.vllm.ai/catalog/microsoft/Phi-4-mini-instruct.json'
    );
  });

  test('allows absolute references inside the configured recipe base URL', () => {
    const client = new VllmRecipesClient('https://recipes.vllm.ai/catalog');

    expect(client.resolveReference('https://recipes.vllm.ai/catalog/microsoft/Phi-4-mini-instruct.json')).toBe(
      'https://recipes.vllm.ai/catalog/microsoft/Phi-4-mini-instruct.json'
    );
  });

  test('rejects recipe references outside the configured recipe origin', () => {
    const client = new VllmRecipesClient('https://recipes.vllm.ai');

    expect(() => client.resolveReference('https://example.com/recipe.json')).toThrow(
      'vLLM recipe references must stay under https://recipes.vllm.ai'
    );
  });

  test('rejects recipe references outside the configured recipe path prefix', () => {
    const client = new VllmRecipesClient('https://recipes.vllm.ai/catalog');

    expect(() => client.resolveReference('/other/recipe.json')).toThrow(
      'vLLM recipe references must stay under https://recipes.vllm.ai/catalog'
    );
  });

  test('rejects non-HTTPS recipe references', () => {
    const client = new VllmRecipesClient('https://recipes.vllm.ai');

    expect(() => client.resolveReference('http://recipes.vllm.ai/recipe.json')).toThrow(
      'vLLM recipe references must use HTTPS'
    );
  });

  describe('getByModelId model ID validation', () => {
    const client = new VllmRecipesClient('https://recipes.vllm.ai');

    // These must throw synchronously from validation, before any network fetch.
    test.each([
      ['extra path segments', 'acme/foo/bar'],
      ['parent-dir traversal in model', 'acme/../bar'],
      ['parent-dir traversal in org', '../acme/model'],
      ['dot segment', './model'],
      ['trailing slash', 'acme/'],
      ['leading slash', '/model'],
      ['no slash', 'justmodel'],
    ])('rejects %s (%p)', async (_label, modelId) => {
      await expect(client.getByModelId(modelId)).rejects.toThrow(
        `Invalid Hugging Face model ID: ${modelId}`
      );
    });
  });
});
