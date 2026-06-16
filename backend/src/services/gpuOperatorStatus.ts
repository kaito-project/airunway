import { withRetry } from '../lib/retry';
import { type K8sApiError } from '../lib/k8s-errors';
import logger from '../lib/logger';

export interface GPUAvailability {
  available: boolean;
  totalGPUs: number;
  gpuNodes: string[];
}

export interface GPUOperatorStatus {
  installed: boolean;
  crdFound: boolean;
  operatorRunning: boolean;
  gpusAvailable: boolean;
  totalGPUs: number;
  gpuNodes: string[];
  message: string;
}

type NodeLike = {
  metadata?: { name?: string };
  status?: { allocatable?: Record<string, string | undefined> };
};

type PodLike = {
  status?: { phase?: string };
};

export interface GpuOperatorStatusAdapter {
  listNodes(): Promise<{ items: NodeLike[] }>;
  listClusterPolicies(): Promise<unknown>;
  listGpuOperatorPodsByLabel(): Promise<{ items: PodLike[] }>;
  listGpuOperatorNamespacePods(): Promise<{ items: PodLike[] }>;
}

function getK8sStatusCode(error: unknown): number | undefined {
  const e = error as K8sApiError | undefined;
  return e?.statusCode || e?.response?.statusCode;
}

function getK8sErrorMessage(error: unknown): string {
  const e = error as
    | {
        body?: { message?: string };
        response?: { body?: { message?: string } };
        message?: string;
      }
    | undefined;
  return e?.body?.message || e?.response?.body?.message || e?.message || String(error);
}

export async function checkGPUAvailability(adapter: GpuOperatorStatusAdapter): Promise<GPUAvailability> {
  try {
    const response = await withRetry(
      () => adapter.listNodes(),
      { operationName: 'checkGPUAvailability' }
    );

    let totalGPUs = 0;
    const gpuNodes: string[] = [];

    for (const node of response.items) {
      const gpuCapacity = node.status?.allocatable?.['nvidia.com/gpu'];
      if (!gpuCapacity) continue;

      const gpuCount = parseInt(gpuCapacity, 10);
      if (gpuCount > 0) {
        totalGPUs += gpuCount;
        gpuNodes.push(node.metadata?.name || 'unknown');
      }
    }

    return {
      available: totalGPUs > 0,
      totalGPUs,
      gpuNodes,
    };
  } catch (error) {
    logger.error({ error }, 'Error checking GPU availability');
    return { available: false, totalGPUs: 0, gpuNodes: [] };
  }
}

export async function checkGPUOperatorStatus(adapter: GpuOperatorStatusAdapter): Promise<GPUOperatorStatus> {
  const gpuAvailability = await checkGPUAvailability(adapter);
  const crdFound = await checkGPUOperatorCRD(adapter);
  const operatorRunning = await checkGPUOperatorPods(adapter);
  const installed = crdFound && operatorRunning;

  return {
    installed,
    crdFound,
    operatorRunning,
    gpusAvailable: gpuAvailability.available,
    totalGPUs: gpuAvailability.totalGPUs,
    gpuNodes: gpuAvailability.gpuNodes,
    message: gpuOperatorStatusMessage(gpuAvailability, installed, crdFound),
  };
}

async function checkGPUOperatorCRD(adapter: GpuOperatorStatusAdapter): Promise<boolean> {
  try {
    await withRetry(
      () => adapter.listClusterPolicies(),
      { operationName: 'checkGPUOperatorCRD', maxRetries: 1 }
    );
    return true;
  } catch (error) {
    const statusCode = getK8sStatusCode(error);
    if (statusCode !== 404) {
      logger.error({ error: getK8sErrorMessage(error) }, 'Error checking GPU Operator CRD');
    }
    return false;
  }
}

async function checkGPUOperatorPods(adapter: GpuOperatorStatusAdapter): Promise<boolean> {
  try {
    const pods = await withRetry(
      () => adapter.listGpuOperatorPodsByLabel(),
      { operationName: 'checkGPUOperatorPods', maxRetries: 1 }
    );
    const labelledPodRunning = pods.items.some((pod) => pod.status?.phase === 'Running');
    if (labelledPodRunning) {
      return true;
    }

    const allPods = await adapter.listGpuOperatorNamespacePods();
    return allPods.items.some((pod) => pod.status?.phase === 'Running');
  } catch {
    return false;
  }
}

function gpuOperatorStatusMessage(
  gpuAvailability: GPUAvailability,
  installed: boolean,
  crdFound: boolean,
): string {
  if (gpuAvailability.available) {
    return `GPUs enabled: ${gpuAvailability.totalGPUs} GPU(s) on ${gpuAvailability.gpuNodes.length} node(s)`;
  }
  if (installed) {
    return 'GPU Operator installed but no GPUs detected on nodes';
  }
  if (crdFound) {
    return 'GPU Operator CRD found but operator is not running';
  }
  return 'GPU Operator not installed';
}
