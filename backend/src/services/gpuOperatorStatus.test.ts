import { describe, expect, test } from 'bun:test';
import {
  checkGPUAvailability,
  checkGPUOperatorStatus,
  type GpuOperatorStatusAdapter,
} from './gpuOperatorStatus';

function adapter(overrides: Partial<GpuOperatorStatusAdapter> = {}): GpuOperatorStatusAdapter {
  return {
    listNodes: async () => ({ items: [] }),
    listClusterPolicies: async () => ({}),
    listGpuOperatorPodsByLabel: async () => ({ items: [] }),
    listGpuOperatorNamespacePods: async () => ({ items: [] }),
    ...overrides,
  };
}

describe('gpuOperatorStatus', () => {
  test('detects allocatable NVIDIA GPUs across nodes', async () => {
    const result = await checkGPUAvailability(adapter({
      listNodes: async () => ({
        items: [
          { metadata: { name: 'gpu-node-a' }, status: { allocatable: { 'nvidia.com/gpu': '2' } } },
          { metadata: { name: 'gpu-node-b' }, status: { allocatable: { 'nvidia.com/gpu': '4' } } },
          { metadata: { name: 'cpu-node' }, status: { allocatable: { 'nvidia.com/gpu': '0' } } },
          { metadata: { name: 'bad-node' }, status: { allocatable: { 'nvidia.com/gpu': 'not-a-number' } } },
        ],
      }),
    }));

    expect(result).toEqual({
      available: true,
      totalGPUs: 6,
      gpuNodes: ['gpu-node-a', 'gpu-node-b'],
    });
  });

  test('falls back to unavailable GPU status when node listing fails', async () => {
    const result = await checkGPUAvailability(adapter({
      listNodes: async () => {
        throw new Error('cluster unavailable');
      },
    }));

    expect(result).toEqual({ available: false, totalGPUs: 0, gpuNodes: [] });
  });

  test('reports installed and GPU-enabled when CRD, operator pod, and GPUs are present', async () => {
    const result = await checkGPUOperatorStatus(adapter({
      listNodes: async () => ({
        items: [
          { metadata: { name: 'gpu-node-a' }, status: { allocatable: { 'nvidia.com/gpu': '8' } } },
        ],
      }),
      listClusterPolicies: async () => ({ items: [{}] }),
      listGpuOperatorPodsByLabel: async () => ({ items: [{ status: { phase: 'Running' } }] }),
    }));

    expect(result).toEqual({
      installed: true,
      crdFound: true,
      operatorRunning: true,
      gpusAvailable: true,
      totalGPUs: 8,
      gpuNodes: ['gpu-node-a'],
      message: 'GPUs enabled: 8 GPU(s) on 1 node(s)',
    });
  });

  test('falls back to any running pod in gpu-operator namespace when the label selector misses', async () => {
    const result = await checkGPUOperatorStatus(adapter({
      listClusterPolicies: async () => ({ items: [{}] }),
      listGpuOperatorPodsByLabel: async () => ({ items: [{ status: { phase: 'Pending' } }] }),
      listGpuOperatorNamespacePods: async () => ({ items: [{ status: { phase: 'Running' } }] }),
    }));

    expect(result.installed).toBe(true);
    expect(result.operatorRunning).toBe(true);
    expect(result.message).toBe('GPU Operator installed but no GPUs detected on nodes');
  });

  test('treats missing ClusterPolicy CRD as not installed', async () => {
    const result = await checkGPUOperatorStatus(adapter({
      listClusterPolicies: async () => {
        throw { statusCode: 404, message: 'not found' };
      },
      listGpuOperatorPodsByLabel: async () => ({ items: [{ status: { phase: 'Running' } }] }),
    }));

    expect(result.crdFound).toBe(false);
    expect(result.operatorRunning).toBe(true);
    expect(result.installed).toBe(false);
    expect(result.message).toBe('GPU Operator not installed');
  });

  test('reports partial installation when CRD exists but operator pods are not running', async () => {
    const result = await checkGPUOperatorStatus(adapter({
      listClusterPolicies: async () => ({ items: [{}] }),
      listGpuOperatorPodsByLabel: async () => ({ items: [{ status: { phase: 'Pending' } }] }),
      listGpuOperatorNamespacePods: async () => ({ items: [] }),
    }));

    expect(result).toMatchObject({
      installed: false,
      crdFound: true,
      operatorRunning: false,
      gpusAvailable: false,
      message: 'GPU Operator CRD found but operator is not running',
    });
  });
});
