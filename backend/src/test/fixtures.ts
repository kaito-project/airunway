/**
 * Shared test fixtures for backend e2e tests.
 * Provides mock data for K8s resources used across route tests.
 */

import type { AutoscalerDetectionResult, AutoscalerStatusInfo } from '@airunway/shared';
import type { AIConfiguratorStatus, AIConfiguratorResult, AIConfiguratorConfig } from '@airunway/shared';
import type { DeploymentStatus, PodStatus } from '@airunway/shared';
import type { HfUserInfo, HfTokenExchangeResponse, HfSecretStatus } from '@airunway/shared';

// ============================================================================
// Autoscaler Fixtures
// ============================================================================

export const autoscalerDetectionAKS: AutoscalerDetectionResult = {
  type: 'aks-managed',
  detected: true,
  healthy: true,
  message: 'AKS managed autoscaler detected',
  nodeGroupCount: 2,
};

export const autoscalerDetectionCA: AutoscalerDetectionResult = {
  type: 'cluster-autoscaler',
  detected: true,
  healthy: true,
  message: 'Cluster Autoscaler detected',
  nodeGroupCount: 3,
  lastActivity: new Date().toISOString(),
};

export const autoscalerDetectionNone: AutoscalerDetectionResult = {
  type: 'none',
  detected: false,
  healthy: false,
  message: 'No autoscaler detected',
};

export const autoscalerStatus: AutoscalerStatusInfo = {
  health: 'Healthy',
  lastUpdateTime: new Date().toISOString(),
  nodeGroups: [
    { name: 'gpu-pool', minSize: 0, maxSize: 5, currentSize: 2 },
    { name: 'cpu-pool', minSize: 1, maxSize: 10, currentSize: 3 },
  ],
};

// ============================================================================
// AI Configurator Fixtures
// ============================================================================

export const aiConfiguratorStatusAvailable: AIConfiguratorStatus = {
  available: true,
  version: '0.4.0',
};

export const aiConfiguratorStatusUnavailable: AIConfiguratorStatus = {
  available: false,
  error: 'AI Configurator CLI not found',
};

export const aiConfiguratorDefaultConfig: AIConfiguratorConfig = {
  tensorParallelDegree: 2,
  maxBatchSize: 256,
  gpuMemoryUtilization: 0.9,
  maxModelLen: 4096,
};

export const aiConfiguratorSuccessResult: AIConfiguratorResult = {
  success: true,
  config: aiConfiguratorDefaultConfig,
  mode: 'aggregated',
  replicas: 1,
  backend: 'vllm',
  supportedBackends: ['vllm', 'sglang', 'trtllm'],
};

// ============================================================================
// Deployment Fixtures
// ============================================================================

export const mockPod: PodStatus = {
  name: 'test-deploy-abc123',
  phase: 'Running' as const,
  ready: true,
  restarts: 0,
  age: '2h',
  node: 'gpu-node-1',
};

export const mockPendingPod: PodStatus = {
  name: 'test-deploy-pending-xyz',
  phase: 'Pending' as const,
  ready: false,
  restarts: 0,
  age: '5m',
};

export const mockDeployment: DeploymentStatus = {
  name: 'test-deploy',
  namespace: 'default',
  modelId: 'meta-llama/Llama-3.1-8B-Instruct',
  engine: 'vllm',
  status: 'Running',
  replicas: 1,
  readyReplicas: 1,
  pods: [mockPod],
  createdAt: new Date().toISOString(),
  mode: 'aggregated',
};

export const mockDeploymentWithPendingPod: DeploymentStatus = {
  ...mockDeployment,
  name: 'pending-deploy',
  status: 'Pending',
  readyReplicas: 0,
  pods: [mockPendingPod],
};

export const mockDeploymentManifest = {
  apiVersion: 'airunway.ai/v1alpha1',
  kind: 'ModelDeployment',
  metadata: {
    name: 'test-deploy',
    namespace: 'default',
  },
  spec: {
    model: { id: 'meta-llama/Llama-3.1-8B-Instruct', source: 'huggingface' },
    engine: { type: 'vllm' },
    resources: { gpu: { count: 1 } },
  },
};

// ============================================================================
// InferenceProviderConfig Fixtures
// ============================================================================

export const mockInferenceProviderConfig = {
  apiVersion: 'airunway.ai/v1alpha1',
  kind: 'InferenceProviderConfig',
  metadata: { name: 'kaito' },
  spec: {
    capabilities: {
      engines: ['vllm', 'llamacpp'],
      servingModes: ['aggregated'],
    },
    installation: {
      description: 'KAITO - Kubernetes AI Toolchain Operator',
      defaultNamespace: 'kaito-workspace',
      helmRepos: [{ name: 'kaito', url: 'https://kaito-project.github.io/kaito/charts/kaito' }],
      helmCharts: [{ name: 'workspace', chart: 'kaito/workspace', version: '0.9.0', namespace: 'kaito-workspace', createNamespace: true }],
      steps: [{ title: 'Install KAITO', command: 'helm install kaito-workspace kaito/workspace', description: 'Install KAITO operator' }],
    },
  },
  status: {
    ready: true,
    version: '0.9.0',
  },
};

// ============================================================================
// Pod Failure Reasons Fixtures
// ============================================================================

export const mockPodFailureReasons = [
  {
    reason: 'Insufficient nvidia.com/gpu',
    message: 'No GPU resources available',
    isResourceConstraint: true,
    resourceType: 'gpu' as const,
    canAutoscalerHelp: true,
  },
];

// ============================================================================
// HuggingFace OAuth Fixtures
// ============================================================================

export const mockHfUser: HfUserInfo = {
  id: 'user-123',
  name: 'testuser',
  fullname: 'Test User',
  email: 'test@example.com',
  avatarUrl: 'https://huggingface.co/avatars/testuser.png',
};

export const mockHfTokenExchange: HfTokenExchangeResponse = {
  accessToken: 'hf_test_token_abc123',
  tokenType: 'Bearer',
  expiresIn: 3600,
  scope: 'openid profile read-repos',
  user: mockHfUser,
};

export const mockHfTokenValidation = {
  valid: true as const,
  user: mockHfUser,
};

export const mockHfTokenValidationInvalid = {
  valid: false as const,
  error: 'Invalid or expired token',
};

// ============================================================================
// HuggingFace Secrets Fixtures
// ============================================================================

export const mockHfSecretStatusConfigured: HfSecretStatus = {
  configured: true,
  namespaces: [
    { name: 'dynamo-system', exists: true },
    { name: 'kuberay-system', exists: true },
    { name: 'kaito-workspace', exists: true },
    { name: 'default', exists: true },
  ],
  user: mockHfUser,
};

export const mockHfSecretStatusEmpty: HfSecretStatus = {
  configured: false,
  namespaces: [
    { name: 'dynamo-system', exists: false },
    { name: 'kuberay-system', exists: false },
    { name: 'kaito-workspace', exists: false },
    { name: 'default', exists: false },
  ],
};

export const mockHfDistributeResult = {
  success: true,
  results: [
    { namespace: 'dynamo-system', success: true },
    { namespace: 'kuberay-system', success: true },
    { namespace: 'kaito-workspace', success: true },
    { namespace: 'default', success: true },
  ],
};

export const mockHfDeleteResult = {
  success: true,
  results: [
    { namespace: 'dynamo-system', success: true },
    { namespace: 'kuberay-system', success: true },
    { namespace: 'kaito-workspace', success: true },
    { namespace: 'default', success: true },
  ],
};

// ============================================================================
// GPU & Installation Fixtures
// ============================================================================

export const mockGpuCapacity = {
  totalGpus: 4,
  allocatedGpus: 0,
  availableGpus: 4,
  maxContiguousAvailable: 4,
  maxNodeGpuCapacity: 4,
  gpuNodeCount: 1,
  nodes: [],
};

export const mockGpuCapacityEmpty = {
  totalGpus: 0,
  allocatedGpus: 0,
  availableGpus: 0,
  maxContiguousAvailable: 0,
  maxNodeGpuCapacity: 0,
  gpuNodeCount: 0,
  nodes: [],
};

export const mockDetailedGpuCapacity = {
  totalGpus: 4,
  allocatedGpus: 1,
  availableGpus: 3,
  nodes: [
    {
      name: 'gpu-node-1',
      gpuType: 'nvidia.com/gpu',
      totalGpus: 4,
      allocatedGpus: 1,
      availableGpus: 3,
      labels: { 'apps': 'ai-model' },
    },
  ],
};

export const mockGpuOperatorStatus = {
  installed: true,
  healthy: true,
  message: 'NVIDIA GPU Operator is running',
  pods: [{ name: 'gpu-operator-abc123', status: 'Running', ready: true }],
};

export const mockHelmAvailable = {
  available: true,
  version: '3.14.0',
};

export const mockHelmUnavailable = {
  available: false,
  error: 'Helm CLI not found in PATH',
};

export const mockProviderInstallResult = {
  success: true,
  results: [
    { step: 'repo-add-kaito', result: { success: true, stdout: 'repo added', stderr: '' } },
    { step: 'repo-update', result: { success: true, stdout: 'updated', stderr: '' } },
    { step: 'install-workspace', result: { success: true, stdout: 'installed', stderr: '' } },
  ],
};

export const mockProviderUninstallResult = {
  success: true,
  stdout: 'release "workspace" uninstalled',
  stderr: '',
  exitCode: 0,
};

export const mockInferenceProviderConfigNotReady = {
  ...mockInferenceProviderConfig,
  status: {
    ready: false,
    version: '0.9.0',
  },
};
