import { describe, expect, test, vi } from 'bun:test';

import {
  buildVllmService,
  createService,
  deleteCRD,
  deleteNamespace,
  deleteService,
  listPVCs,
  type ClusterAdministrationAdapter,
} from './clusterAdministration';

function adapter(overrides: Partial<ClusterAdministrationAdapter> = {}): ClusterAdministrationAdapter {
  return {
    createNamespacedService: vi.fn(async () => ({})),
    deleteNamespacedService: vi.fn(async () => ({})),
    deleteCustomResourceDefinition: vi.fn(async () => ({})),
    deleteClusterCustomObject: vi.fn(async () => ({})),
    deleteNamespace: vi.fn(async () => ({})),
    listNamespacedPersistentVolumeClaim: vi.fn(async () => ({ items: [] })),
    getK8sStatusCode: (error) => (error as { statusCode?: number })?.statusCode,
    getK8sErrorMessage: (error) => (error as Error)?.message || String(error),
    logInfo: vi.fn(),
    logDebug: vi.fn(),
    logWarn: vi.fn(),
    logError: vi.fn(),
    ...overrides,
  };
}

describe('clusterAdministration', () => {
  test('builds the managed vLLM service manifest', () => {
    expect(buildVllmService({
      name: 'demo',
      namespace: 'models',
      port: 80,
      targetPort: 8000,
      selector: { app: 'demo' },
    })).toMatchObject({
      metadata: {
        name: 'demo-vllm',
        namespace: 'models',
        labels: {
          'app.kubernetes.io/managed-by': 'airunway',
          'airunway.ai/service-type': 'vllm',
        },
      },
      spec: {
        type: 'ClusterIP',
        selector: { app: 'demo' },
        ports: [{ port: 80, targetPort: 8000, protocol: 'TCP', name: 'http' }],
      },
    });
  });

  test('creates services and treats already-existing services as success', async () => {
    const existing = adapter({
      createNamespacedService: vi.fn(async () => { throw { statusCode: 409 }; }),
    });

    await expect(createService(existing, {
      name: 'demo',
      namespace: 'models',
      port: 80,
      targetPort: 8000,
      selector: { app: 'demo' },
    })).resolves.toBeUndefined();
    expect(existing.logDebug).toHaveBeenCalledWith({ name: 'demo-vllm', namespace: 'models' }, 'Service already exists');
  });

  test('deletes services and treats not-found services as success', async () => {
    const missing = adapter({
      deleteNamespacedService: vi.fn(async () => { throw { statusCode: 404 }; }),
    });

    await expect(deleteService(missing, 'demo-vllm', 'models')).resolves.toBeUndefined();
    expect(missing.logDebug).toHaveBeenCalledWith({ name: 'demo-vllm', namespace: 'models' }, 'Service not found (already deleted)');
  });

  test('returns delete CRD failure messages without throwing', async () => {
    const failing = adapter({
      deleteCustomResourceDefinition: vi.fn(async () => { throw new Error('forbidden'); }),
      getK8sStatusCode: () => 403,
      getK8sErrorMessage: () => 'forbidden',
    });

    await expect(deleteCRD(failing, 'workspaces.kaito.sh')).resolves.toEqual({
      success: false,
      message: 'Failed to delete CRD workspaces.kaito.sh: forbidden',
    });
  });

  test('protects critical namespaces from deletion', async () => {
    const admin = adapter();

    await expect(deleteNamespace(admin, 'kube-system')).resolves.toEqual({
      success: false,
      message: 'Cannot delete protected namespace: kube-system',
    });
    expect(admin.deleteNamespace).not.toHaveBeenCalled();
    expect(admin.logWarn).toHaveBeenCalledWith({ namespace: 'kube-system' }, 'Attempted to delete protected namespace');
  });

  test('maps PVCs and skips unnamed items', async () => {
    const admin = adapter({
      listNamespacedPersistentVolumeClaim: vi.fn(async () => ({
        items: [
          {
            metadata: { name: 'model-cache' },
            status: { phase: 'Bound', capacity: { storage: '100Gi' } },
            spec: { storageClassName: 'premium', resources: { requests: { storage: '50Gi' } } },
          },
          {
            metadata: {},
            status: { phase: 'Pending' },
            spec: {},
          },
          {
            metadata: { name: 'compile-cache' },
            status: {},
            spec: { resources: { requests: { storage: '25Gi' } } },
          },
        ],
      })),
    });

    await expect(listPVCs(admin, 'models')).resolves.toEqual([
      { name: 'model-cache', status: 'Bound', storageClass: 'premium', capacity: '100Gi' },
      { name: 'compile-cache', status: 'Unknown', storageClass: '', capacity: '25Gi' },
    ]);
  });
});
