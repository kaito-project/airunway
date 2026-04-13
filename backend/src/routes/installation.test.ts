import { describe, test, expect, afterEach } from 'bun:test';
import app from '../hono-app';
import { kubernetesService } from '../services/kubernetes';
import { helmService } from '../services/helm';
import { mockServiceMethod } from '../test/helpers';
import { mockInferenceProviderConfig } from '../test/fixtures';

describe('Installation Provider Routes', () => {
  function createDynamoProviderConfig() {
    return {
      ...mockInferenceProviderConfig,
      metadata: { ...mockInferenceProviderConfig.metadata, name: 'dynamo' },
      spec: {
        ...mockInferenceProviderConfig.spec,
        installation: {
          ...mockInferenceProviderConfig.spec.installation,
          description: 'NVIDIA Dynamo for high-performance GPU inference',
          defaultNamespace: 'dynamo-system',
          helmRepos: [],
          helmCharts: [
            {
              name: 'dynamo-platform',
              chart: 'https://helm.ngc.nvidia.com/nvidia/ai-dynamo/charts/dynamo-platform-1.0.1.tgz',
              namespace: 'dynamo-system',
              createNamespace: true,
              values: {
                'global.grove.install': true,
              },
            },
          ],
          steps: [
            {
              title: 'Install Dynamo Platform',
              command: 'helm upgrade --install dynamo-platform https://helm.ngc.nvidia.com/nvidia/ai-dynamo/charts/dynamo-platform-1.0.1.tgz --namespace dynamo-system --create-namespace --set-json global.grove.install=true',
              description: 'Install the Dynamo platform operator v1.0.1 with bundled Grove enabled by default. This chart includes the required CRDs.',
            },
          ],
        },
      },
    };
  }

  function createDynamoProviderConfigWithNestedValues() {
    const config = createDynamoProviderConfig();
    return {
      ...config,
      spec: {
        ...config.spec,
        installation: {
          ...config.spec.installation,
          helmCharts: [
            {
              ...config.spec.installation.helmCharts[0],
              values: {
                'dynamo-operator': {
                  controllerManager: {
                    kubeRbacProxy: {
                      image: {
                        repository: 'quay.io/brancz/kube-rbac-proxy',
                        tag: 'v0.15.0',
                      },
                    },
                  },
                },
              },
            },
          ],
        },
      },
    };
  }

  const restores: Array<() => void> = [];

  afterEach(() => {
    restores.forEach((r) => r());
    restores.length = 0;
  });

  // ==========================================================================
  // GET /api/installation/providers/:providerId/status
  // ==========================================================================

  describe('GET /api/installation/providers/:providerId/status', () => {
    test('uses live KAITO installation status instead of provider config readiness', async () => {
      let kaitoStatusChecks = 0;

      restores.push(
        mockServiceMethod(kubernetesService, 'getInferenceProviderConfig', async () => mockInferenceProviderConfig),
        mockServiceMethod(kubernetesService, 'checkKaitoInstallationStatus', async () => {
          kaitoStatusChecks += 1;
          return {
            installed: true,
            crdFound: true,
            operatorRunning: false,
            message: 'KAITO workspace CRD found but no ready KAITO operator pods were detected in kaito-workspace',
          };
        }),
      );

      const res = await app.request('/api/installation/providers/kaito/status');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.providerId).toBe('kaito');
      expect(data.providerName).toBe('Kaito');
      expect(kaitoStatusChecks).toBe(1);
      expect(data.installed).toBe(true);
      expect(data.crdFound).toBe(true);
      expect(data.operatorRunning).toBe(false);
      expect(data.version).toBe('0.9.0');
      expect(data.message).toBe('KAITO workspace CRD found but no ready KAITO operator pods were detected in kaito-workspace');
      expect(data.installationSteps).toBeDefined();
      expect(data.helmCommands).toBeDefined();
      expect(data.helmCommands.some((command: string) => command.includes('helm pull kaito/workspace'))).toBe(true);
      expect(data.helmCommands.some((command: string) => command.includes('kubectl apply -f "$crd"'))).toBe(true);
      expect(data.helmCommands.some((command: string) => command.includes('--skip-crds'))).toBe(true);
    });

    test('uses live Dynamo installation status for non-KAITO providers', async () => {
      let kaitoStatusChecks = 0;
      let dynamoStatusChecks = 0;
      const nonKaitoConfig = {
        ...createDynamoProviderConfig(),
        status: {
          ready: false,
          version: '1.2.3',
        },
      };

      restores.push(
        mockServiceMethod(kubernetesService, 'getInferenceProviderConfig', async () => nonKaitoConfig),
        mockServiceMethod(kubernetesService, 'checkKaitoInstallationStatus', async () => {
          kaitoStatusChecks += 1;
          return {
            installed: true,
            crdFound: true,
            operatorRunning: true,
            message: 'should not be used',
          };
        }),
        mockServiceMethod(kubernetesService, 'checkDynamoInstallationStatus', async () => {
          dynamoStatusChecks += 1;
          return {
            installed: false,
            crdFound: false,
            operatorRunning: false,
            message: 'Dynamo CRD not found',
          };
        }),
      );

      const res = await app.request('/api/installation/providers/dynamo/status');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(kaitoStatusChecks).toBe(0);
      expect(dynamoStatusChecks).toBe(1);
      expect(data.providerId).toBe('dynamo');
      expect(data.providerName).toBe('Dynamo');
      expect(data.installed).toBe(false);
      expect(data.crdFound).toBe(false);
      expect(data.operatorRunning).toBe(false);
      expect(data.version).toBe('1.2.3');
      expect(data.message).toBe('Dynamo CRD not found');
      expect(data.helmCommands).toHaveLength(1);
      expect(data.helmCommands[0]).toContain('global.grove.install=true');
    });

    test('returns 404 for unknown provider', async () => {
      restores.push(
        mockServiceMethod(kubernetesService, 'getInferenceProviderConfig', async () => null),
      );

      const res = await app.request('/api/installation/providers/unknown/status');
      expect(res.status).toBe(404);
    });
  });

  // ==========================================================================
  // GET /api/installation/providers/:providerId/commands
  // ==========================================================================

  describe('GET /api/installation/providers/:providerId/commands', () => {
    test('returns commands when provider found', async () => {
      restores.push(
        mockServiceMethod(kubernetesService, 'getInferenceProviderConfig', async () => mockInferenceProviderConfig),
      );

      const res = await app.request('/api/installation/providers/kaito/commands');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.providerId).toBe('kaito');
      expect(data.providerName).toBe('Kaito');
      expect(data.commands).toBeDefined();
      expect(data.commands.some((command: string) => command.includes('helm pull kaito/workspace'))).toBe(true);
      expect(data.commands.some((command: string) => command.includes('kubectl apply -f "$crd"'))).toBe(true);
      expect(data.commands.some((command: string) => command.includes('--skip-crds'))).toBe(true);
      expect(data.steps).toBeDefined();
    });

    test('preserves chart values in generated commands for non-KAITO providers', async () => {
      restores.push(
        mockServiceMethod(kubernetesService, 'getInferenceProviderConfig', async () => createDynamoProviderConfigWithNestedValues()),
      );

      const res = await app.request('/api/installation/providers/dynamo/commands');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.providerId).toBe('dynamo');
      expect(data.providerName).toBe('Dynamo');
      expect(data.commands).toHaveLength(1);
      expect(data.commands[0]).toContain("--set-json 'dynamo-operator=");
      expect(data.commands[0]).toContain('"tag":"v0.15.0"');
    });

    test('includes helm values in generated commands when present', async () => {
      const configWithValues = {
        ...mockInferenceProviderConfig,
        spec: {
          ...mockInferenceProviderConfig.spec,
          installation: {
            ...mockInferenceProviderConfig.spec.installation,
            helmCharts: [
              {
                ...mockInferenceProviderConfig.spec.installation.helmCharts[0],
                values: {
                  'global.grove.install': true,
                },
              },
            ],
          },
        },
      };

      restores.push(
        mockServiceMethod(kubernetesService, 'getInferenceProviderConfig', async () => configWithValues),
      );

      const res = await app.request('/api/installation/providers/kaito/commands');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.commands.some((command: string) => command.includes('global.grove.install=true'))).toBe(true);
    });

    test('returns 404 for unknown provider', async () => {
      restores.push(
        mockServiceMethod(kubernetesService, 'getInferenceProviderConfig', async () => null),
      );

      const res = await app.request('/api/installation/providers/unknown/commands');
      expect(res.status).toBe(404);
    });
  });

  // ==========================================================================
  // POST /api/installation/providers/:providerId/install
  // ==========================================================================

  describe('POST /api/installation/providers/:providerId/install', () => {
    test('returns 404 for unknown provider', async () => {
      restores.push(
        mockServiceMethod(kubernetesService, 'getInferenceProviderConfig', async () => null),
      );

      const res = await app.request('/api/installation/providers/unknown/install', { method: 'POST' });
      expect(res.status).toBe(404);
    });

    test('returns 400 when helm is not available', async () => {
      restores.push(
        mockServiceMethod(kubernetesService, 'getInferenceProviderConfig', async () => mockInferenceProviderConfig),
        mockServiceMethod(helmService, 'checkHelmAvailable', async () => ({ available: false, error: 'not found' })),
      );

      const res = await app.request('/api/installation/providers/kaito/install', { method: 'POST' });
      expect(res.status).toBe(400);
    });

    test('returns 200 on successful install', async () => {
      let installCharts: any[] = [];

      restores.push(
        mockServiceMethod(kubernetesService, 'getInferenceProviderConfig', async () => mockInferenceProviderConfig),
        mockServiceMethod(helmService, 'checkHelmAvailable', async () => ({ available: true, version: '3.14.0' })),
        mockServiceMethod(helmService, 'installProvider', async (_repos, charts) => {
          installCharts = charts as any[];
          return {
            success: true,
            results: [{ step: 'install', result: { success: true, stdout: 'ok', stderr: '' } }],
          };
        }),
      );

      const res = await app.request('/api/installation/providers/kaito/install', { method: 'POST' });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.results).toBeDefined();
      expect(installCharts).toHaveLength(1);
      expect(installCharts[0].chart).toBe('kaito/workspace');
      expect(installCharts[0].preInstallMissingCrds).toBe(true);
      expect(installCharts[0].skipCrds).toBe(true);
    });

    test('keeps standard chart install behavior for non-KAITO providers', async () => {
      let installCharts: any[] = [];
      const nonKaitoConfig = createDynamoProviderConfig();

      restores.push(
        mockServiceMethod(kubernetesService, 'getInferenceProviderConfig', async () => nonKaitoConfig),
        mockServiceMethod(helmService, 'checkHelmAvailable', async () => ({ available: true, version: '3.14.0' })),
        mockServiceMethod(helmService, 'installProvider', async (_repos, charts) => {
          installCharts = charts as any[];
          return {
            success: true,
            results: [{ step: 'install', result: { success: true, stdout: 'ok', stderr: '' } }],
          };
        }),
      );

      const res = await app.request('/api/installation/providers/dynamo/install', { method: 'POST' });
      expect(res.status).toBe(200);

      expect(installCharts).toHaveLength(1);
      expect(installCharts[0].chart).toBe('https://helm.ngc.nvidia.com/nvidia/ai-dynamo/charts/dynamo-platform-1.0.1.tgz');
      expect(installCharts[0].preInstallMissingCrds).toBeUndefined();
      expect(installCharts[0].skipCrds).toBeUndefined();
      expect(installCharts[0].values?.['global.grove.install']).toBe(true);
    });
  });

  // ==========================================================================
  // POST /api/installation/providers/:providerId/uninstall
  // ==========================================================================

  describe('POST /api/installation/providers/:providerId/uninstall', () => {
    test('returns 404 for unknown provider', async () => {
      restores.push(
        mockServiceMethod(kubernetesService, 'getInferenceProviderConfig', async () => null),
      );

      const res = await app.request('/api/installation/providers/unknown/uninstall', { method: 'POST' });
      expect(res.status).toBe(404);
    });

    test('returns 200 on successful uninstall', async () => {
      restores.push(
        mockServiceMethod(kubernetesService, 'getInferenceProviderConfig', async () => mockInferenceProviderConfig),
        mockServiceMethod(helmService, 'checkHelmAvailable', async () => ({ available: true, version: '3.14.0' })),
        mockServiceMethod(helmService, 'uninstall', async () => ({ success: true, stdout: 'ok', stderr: '' })),
      );

      const res = await app.request('/api/installation/providers/kaito/uninstall', { method: 'POST' });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
    });
  });

  // ==========================================================================
  // POST /api/installation/providers/:providerId/uninstall-crds
  // ==========================================================================

  describe('POST /api/installation/providers/:providerId/uninstall-crds', () => {
    test('returns 404 for unknown provider', async () => {
      restores.push(
        mockServiceMethod(kubernetesService, 'getInferenceProviderConfig', async () => null),
      );

      const res = await app.request('/api/installation/providers/unknown/uninstall-crds', { method: 'POST' });
      expect(res.status).toBe(404);
    });

    test('returns 200 on successful CRD removal', async () => {
      restores.push(
        mockServiceMethod(kubernetesService, 'getInferenceProviderConfig', async () => mockInferenceProviderConfig),
        mockServiceMethod(kubernetesService, 'deleteInferenceProviderConfig', async () => undefined),
      );

      const res = await app.request('/api/installation/providers/kaito/uninstall-crds', { method: 'POST' });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
    });
  });
});

describe('Gateway Installation Routes', () => {
  const restores: Array<() => void> = [];

  afterEach(() => {
    restores.forEach((r) => r());
    restores.length = 0;
  });

  // ==========================================================================
  // GET /api/installation/gateway/status
  // ==========================================================================

  describe('GET /api/installation/gateway/status', () => {
    test('returns gateway CRD status when CRDs are installed', async () => {
      restores.push(
        mockServiceMethod(kubernetesService, 'checkGatewayCRDStatus', async () => ({
          gatewayApiInstalled: true,
          inferenceExtInstalled: true,
          pinnedVersion: 'v1.3.1',
          gatewayAvailable: true,
          gatewayEndpoint: '10.0.0.50',
          message: 'Gateway API and Inference Extension CRDs are installed. Gateway is available.',
          installCommands: [
            'kubectl apply -f https://github.com/kubernetes-sigs/gateway-api/releases/latest/download/standard-install.yaml',
            'kubectl apply -f https://github.com/kubernetes-sigs/gateway-api-inference-extension/releases/download/v1.3.1/manifests.yaml',
          ],
        })),
      );

      const res = await app.request('/api/installation/gateway/status');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.gatewayApiInstalled).toBe(true);
      expect(data.inferenceExtInstalled).toBe(true);
      expect(data.pinnedVersion).toBe('v1.3.1');
      expect(data.gatewayAvailable).toBe(true);
      expect(data.gatewayEndpoint).toBe('10.0.0.50');
      expect(data.installCommands).toHaveLength(2);
    });

    test('returns status when CRDs are not installed', async () => {
      restores.push(
        mockServiceMethod(kubernetesService, 'checkGatewayCRDStatus', async () => ({
          gatewayApiInstalled: false,
          inferenceExtInstalled: false,
          pinnedVersion: 'v1.3.1',
          gatewayAvailable: false,
          message: 'Gateway API and Inference Extension CRDs are not installed.',
          installCommands: [
            'kubectl apply -f https://github.com/kubernetes-sigs/gateway-api/releases/latest/download/standard-install.yaml',
            'kubectl apply -f https://github.com/kubernetes-sigs/gateway-api-inference-extension/releases/download/v1.3.1/manifests.yaml',
          ],
        })),
      );

      const res = await app.request('/api/installation/gateway/status');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.gatewayApiInstalled).toBe(false);
      expect(data.inferenceExtInstalled).toBe(false);
      expect(data.gatewayAvailable).toBe(false);
    });
  });

  // ==========================================================================
  // POST /api/installation/gateway/install-crds
  // ==========================================================================

  describe('POST /api/installation/gateway/install-crds', () => {
    test('returns 200 on successful CRD installation', async () => {
      restores.push(
        mockServiceMethod(helmService, 'applyManifestUrl', async () => ({
          success: true,
          stdout: 'customresourcedefinition.apiextensions.k8s.io/gateways.gateway.networking.k8s.io created',
          stderr: '',
          exitCode: 0,
        })),
      );

      const res = await app.request('/api/installation/gateway/install-crds', { method: 'POST' });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.results).toHaveLength(2);
      expect(data.results[0].step).toBe('gateway-api-crds');
      expect(data.results[1].step).toBe('inference-extension-crds');
    });

    test('returns 500 when Gateway API CRD installation fails', async () => {
      let callCount = 0;
      restores.push(
        mockServiceMethod(helmService, 'applyManifestUrl', async () => {
          callCount++;
          if (callCount === 1) {
            return {
              success: false,
              stdout: '',
              stderr: 'connection refused',
              exitCode: 1,
            };
          }
          return { success: true, stdout: 'ok', stderr: '', exitCode: 0 };
        }),
      );

      const res = await app.request('/api/installation/gateway/install-crds', { method: 'POST' });
      expect(res.status).toBe(500);
    });
  });
});
