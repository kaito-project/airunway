import { describe, it, expect } from 'vitest';
import { createCostsApi, type NodePoolCostsResponse } from './costs';
import { mockRequest } from './test-helpers';
import type { CostEstimateRequest, CostEstimateResponse } from '../types';

describe('createCostsApi', () => {
  describe('estimate', () => {
    it('POSTs to /costs/estimate with the request body and returns the resolved value', async () => {
      const mockResponse: CostEstimateResponse = {
        success: true,
        breakdown: {
          estimate: {
            hourly: 1.0,
            monthly: 730,
            currency: 'USD',
            source: 'static',
            confidence: 'medium',
          },
          perGpu: { hourly: 1.0, monthly: 730 },
          totalGpus: 1,
          gpuModel: 'A100',
          normalizedGpuModel: 'A100',
          notes: [],
        },
      };
      const request = mockRequest(mockResponse);

      const input: CostEstimateRequest = {
        gpuType: 'A100',
        gpuCount: 1,
        replicas: 1,
      };

      const api = createCostsApi(request);
      const result = await api.estimate(input);

      expect(request).toHaveBeenCalledTimes(1);
      expect(request).toHaveBeenCalledWith('/costs/estimate', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      expect(result).toEqual(mockResponse);
    });
  });

  describe('getNodePoolCosts', () => {
    it('builds the query string with provided gpuCount/replicas/computeType', async () => {
      const mockResponse: NodePoolCostsResponse = {
        success: true,
        nodePoolCosts: [],
        pricingSource: 'static',
        cacheStats: { size: 0, ttlMs: 60_000, maxEntries: 100 },
      };
      const request = mockRequest(mockResponse);

      const api = createCostsApi(request);
      const result = await api.getNodePoolCosts(2, 3, 'gpu');

      expect(request).toHaveBeenCalledWith('/costs/node-pools?gpuCount=2&replicas=3&computeType=gpu');
      expect(result).toEqual(mockResponse);
    });

    it('uses default values (gpuCount=1, replicas=1, computeType=gpu) when called with no args', async () => {
      const mockResponse: NodePoolCostsResponse = {
        success: true,
        nodePoolCosts: [],
        pricingSource: 'realtime-with-fallback',
        cacheStats: { size: 0, ttlMs: 60_000, maxEntries: 100 },
      };
      const request = mockRequest(mockResponse);

      const api = createCostsApi(request);
      await api.getNodePoolCosts();

      expect(request).toHaveBeenCalledWith('/costs/node-pools?gpuCount=1&replicas=1&computeType=gpu');
    });
  });
});
