import * as k8s from '@kubernetes/client-node';

import { withRetry } from '../lib/retry';

export interface PersistentVolumeClaimInfo {
  name: string;
  status: string;
  storageClass: string;
  capacity: string;
}

export interface DeleteResult {
  success: boolean;
  message: string;
}

export interface InferenceProviderConfigResourceRef {
  group: string;
  version: string;
  plural: string;
}

export interface ClusterAdministrationAdapter {
  createNamespacedService(namespace: string, body: k8s.V1Service): Promise<unknown>;
  deleteNamespacedService(name: string, namespace: string): Promise<unknown>;
  deleteCustomResourceDefinition(name: string): Promise<unknown>;
  deleteClusterCustomObject(options: InferenceProviderConfigResourceRef & { name: string }): Promise<unknown>;
  deleteNamespace(name: string): Promise<unknown>;
  listNamespacedPersistentVolumeClaim(namespace: string): Promise<{ items?: k8s.V1PersistentVolumeClaim[] }>;
  getK8sStatusCode(error: unknown): number | undefined;
  getK8sErrorMessage(error: unknown): string;
  logInfo(context: Record<string, unknown>, message: string): void;
  logDebug(context: Record<string, unknown>, message: string): void;
  logWarn(context: Record<string, unknown>, message: string): void;
  logError(context: Record<string, unknown>, message: string): void;
}

const PROTECTED_NAMESPACES = ['default', 'kube-system', 'kube-public', 'kube-node-lease'];

export function buildVllmService(options: {
  name: string;
  namespace: string;
  port: number;
  targetPort: number;
  selector: Record<string, string>;
}): k8s.V1Service {
  return {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: {
      name: `${options.name}-vllm`,
      namespace: options.namespace,
      labels: {
        'app.kubernetes.io/name': 'airunway',
        'app.kubernetes.io/instance': options.name,
        'app.kubernetes.io/managed-by': 'airunway',
        'airunway.ai/service-type': 'vllm',
      },
    },
    spec: {
      type: 'ClusterIP',
      ports: [
        {
          port: options.port,
          targetPort: options.targetPort as unknown as k8s.IntOrString,
          protocol: 'TCP',
          name: 'http',
        },
      ],
      selector: options.selector,
    },
  };
}

export async function createService(
  adapter: ClusterAdministrationAdapter,
  options: {
    name: string;
    namespace: string;
    port: number;
    targetPort: number;
    selector: Record<string, string>;
  }
): Promise<void> {
  const service = buildVllmService(options);
  const serviceName = `${options.name}-vllm`;

  try {
    await withRetry(
      () => adapter.createNamespacedService(options.namespace, service),
      { operationName: 'createService' }
    );
    adapter.logInfo(
      { name: serviceName, namespace: options.namespace, port: options.port, targetPort: options.targetPort },
      'Created vLLM service'
    );
  } catch (error) {
    const statusCode = adapter.getK8sStatusCode(error);
    if (statusCode === 409) {
      adapter.logDebug({ name: serviceName, namespace: options.namespace }, 'Service already exists');
      return;
    }
    throw error;
  }
}

export async function deleteService(
  adapter: ClusterAdministrationAdapter,
  name: string,
  namespace: string
): Promise<void> {
  try {
    await withRetry(
      () => adapter.deleteNamespacedService(name, namespace),
      { operationName: 'deleteService' }
    );
    adapter.logInfo({ name, namespace }, 'Deleted service');
  } catch (error) {
    const statusCode = adapter.getK8sStatusCode(error);
    if (statusCode === 404) {
      adapter.logDebug({ name, namespace }, 'Service not found (already deleted)');
      return;
    }
    throw error;
  }
}

export async function deleteCRD(
  adapter: ClusterAdministrationAdapter,
  crdName: string
): Promise<DeleteResult> {
  try {
    adapter.logInfo({ crdName }, 'Deleting CRD');
    await withRetry(
      () => adapter.deleteCustomResourceDefinition(crdName),
      { operationName: 'deleteCRD', maxRetries: 2 }
    );
    adapter.logInfo({ crdName }, 'CRD deleted successfully');
    return { success: true, message: `CRD ${crdName} deleted` };
  } catch (error) {
    const statusCode = adapter.getK8sStatusCode(error);
    if (statusCode === 404) {
      adapter.logDebug({ crdName }, 'CRD not found (already deleted)');
      return { success: true, message: `CRD ${crdName} not found (already deleted)` };
    }
    adapter.logError({ error, crdName }, 'Error deleting CRD');
    return { success: false, message: `Failed to delete CRD ${crdName}: ${adapter.getK8sErrorMessage(error)}` };
  }
}

export async function deleteInferenceProviderConfig(
  adapter: ClusterAdministrationAdapter,
  resource: InferenceProviderConfigResourceRef,
  name: string
): Promise<DeleteResult> {
  try {
    adapter.logInfo({ name }, 'Deleting InferenceProviderConfig');
    await withRetry(
      () => adapter.deleteClusterCustomObject({ ...resource, name }),
      { operationName: `deleteInferenceProviderConfig:${name}`, maxRetries: 2 }
    );
    adapter.logInfo({ name }, 'InferenceProviderConfig deleted successfully');
    return { success: true, message: `InferenceProviderConfig ${name} deleted` };
  } catch (error) {
    const statusCode = adapter.getK8sStatusCode(error);
    if (statusCode === 404) {
      adapter.logDebug({ name }, 'InferenceProviderConfig not found (already deleted)');
      return { success: true, message: `InferenceProviderConfig ${name} not found (already deleted)` };
    }
    adapter.logError({ error, name }, 'Error deleting InferenceProviderConfig');
    return { success: false, message: `Failed to delete InferenceProviderConfig ${name}: ${adapter.getK8sErrorMessage(error)}` };
  }
}

export async function deleteNamespace(
  adapter: ClusterAdministrationAdapter,
  namespace: string
): Promise<DeleteResult> {
  if (PROTECTED_NAMESPACES.includes(namespace)) {
    adapter.logWarn({ namespace }, 'Attempted to delete protected namespace');
    return { success: false, message: `Cannot delete protected namespace: ${namespace}` };
  }

  try {
    adapter.logInfo({ namespace }, 'Deleting namespace');
    await withRetry(
      () => adapter.deleteNamespace(namespace),
      { operationName: 'deleteNamespace', maxRetries: 2 }
    );
    adapter.logInfo({ namespace }, 'Namespace deletion initiated');
    return { success: true, message: `Namespace ${namespace} deletion initiated` };
  } catch (error) {
    const statusCode = adapter.getK8sStatusCode(error);
    if (statusCode === 404) {
      adapter.logDebug({ namespace }, 'Namespace not found (already deleted)');
      return { success: true, message: `Namespace ${namespace} not found (already deleted)` };
    }
    adapter.logError({ error, namespace }, 'Error deleting namespace');
    return { success: false, message: `Failed to delete namespace ${namespace}: ${adapter.getK8sErrorMessage(error)}` };
  }
}

export async function listPVCs(
  adapter: ClusterAdministrationAdapter,
  namespace: string
): Promise<PersistentVolumeClaimInfo[]> {
  const response = await withRetry(
    () => adapter.listNamespacedPersistentVolumeClaim(namespace),
    { operationName: 'listPVCs', maxRetries: 1 }
  );

  return (response.items || []).flatMap((pvc) => {
    const name = pvc.metadata?.name;
    if (!name) {
      return [];
    }

    return [{
      name,
      status: pvc.status?.phase || 'Unknown',
      storageClass: pvc.spec?.storageClassName || '',
      capacity: pvc.status?.capacity?.['storage'] || pvc.spec?.resources?.requests?.['storage'] || '',
    }];
  });
}
