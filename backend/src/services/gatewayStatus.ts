import type {
  GatewayCRDStatus,
  GatewayInfo,
  GatewayModelInfo,
  ModelDeployment,
} from '@airunway/shared';
import { INFERENCE_GATEWAY_LABEL } from '@airunway/shared';

const GATEWAY_API_CRD_NAME = 'gateways.gateway.networking.k8s.io';
const HTTP_ROUTE_CRD_NAME = 'httproutes.gateway.networking.k8s.io';
const INFERENCE_POOL_CRD_NAME = 'inferencepools.inference.networking.k8s.io';

const GATEWAY_API_VERSION_ANNOTATIONS = [
  'gateway.networking.k8s.io/bundle-version',
  'app.kubernetes.io/version',
];

const INFERENCE_EXTENSION_VERSION_ANNOTATIONS = [
  'inference.networking.k8s.io/bundle-version',
  'app.kubernetes.io/version',
];

export interface GatewayItem {
  metadata?: { name?: string; namespace?: string; labels?: Record<string, string> };
  status?: { addresses?: Array<{ value?: string }> };
}

export interface GatewayStatusAdapter {
  checkCRDExists(crdName: string): Promise<boolean>;
  listGateways(): Promise<GatewayItem[]>;
  getDefaultNamespace(): Promise<string>;
  listModelDeployments(namespace: string): Promise<ModelDeployment[]>;
  getGatewayStatus(): Promise<GatewayInfo>;
  getCRDStatusFromAnnotations(
    crdName: string,
    annotationKeys: string[]
  ): Promise<{ installed: boolean; version?: string }>;
  logDebug(context: Record<string, unknown>, message: string): void;
}

export async function getGatewayStatus(adapter: GatewayStatusAdapter): Promise<GatewayInfo> {
  // Check if InferencePool CRD exists - without it, gateway integration is not supported.
  const inferencePoolCrdExists = await adapter.checkCRDExists(INFERENCE_POOL_CRD_NAME);
  if (!inferencePoolCrdExists) {
    return { available: false };
  }

  // The controller creates HTTPRoutes, so the HTTPRoute CRD must be present.
  const httpRouteCrdExists = await adapter.checkCRDExists(HTTP_ROUTE_CRD_NAME);
  if (!httpRouteCrdExists) {
    return { available: false };
  }

  // The Gateway CRD must exist before the backend can list Gateway resources.
  const gatewayCrdExists = await adapter.checkCRDExists(GATEWAY_API_CRD_NAME);
  if (!gatewayCrdExists) {
    return { available: false };
  }

  // "Available" means the controller auto-detection can select a Gateway -
  // mirror that path so the UI matches what it will actually pick when
  // reconciling a ModelDeployment with gateway.enabled=true and no explicit
  // gateway override.
  let items: GatewayItem[] = [];
  try {
    items = await adapter.listGateways();
  } catch (error) {
    adapter.logDebug({ error: getErrorMessage(error) }, 'Could not list Gateway resources');
    return { available: false };
  }

  const selected = selectGateway(items);
  if (!selected) {
    return { available: false };
  }

  const endpoint = selected.status?.addresses?.[0]?.value;
  return { available: true, endpoint };
}

export async function getGatewayModels(adapter: GatewayStatusAdapter): Promise<GatewayModelInfo[]> {
  const namespace = await adapter.getDefaultNamespace();
  const models: GatewayModelInfo[] = [];

  try {
    const items = await adapter.listModelDeployments(namespace);
    for (const md of items) {
      const gw = md.status?.gateway;
      if (gw?.modelName) {
        models.push({
          name: gw.modelName,
          deploymentName: md.metadata.name,
          provider: md.status?.provider?.name || md.spec.provider?.name,
          ready: md.status?.conditions?.some(
            (c: { type: string; status: string }) => c.type === 'GatewayReady' && c.status === 'True'
          ) ?? false,
        });
      }
    }
  } catch (error) {
    adapter.logDebug({ error: getErrorMessage(error) }, 'Could not list ModelDeployments for gateway models');
  }

  return models;
}

export async function checkGatewayCRDStatus(adapter: GatewayStatusAdapter): Promise<GatewayCRDStatus> {
  const { PINNED_GAIE_VERSION, GAIE_CRD_URL, GATEWAY_API_CRD_URL } = await import('@airunway/shared');

  const [gatewayApiStatus, inferenceExtStatus] = await Promise.all([
    adapter.getCRDStatusFromAnnotations(GATEWAY_API_CRD_NAME, GATEWAY_API_VERSION_ANNOTATIONS),
    adapter.getCRDStatusFromAnnotations(INFERENCE_POOL_CRD_NAME, INFERENCE_EXTENSION_VERSION_ANNOTATIONS),
  ]);

  const gatewayApiInstalled = gatewayApiStatus.installed;
  const inferenceExtInstalled = inferenceExtStatus.installed;
  const gatewayApiVersion = gatewayApiStatus.version;
  const inferenceExtVersion = inferenceExtStatus.version;

  // Get live gateway status
  let gatewayAvailable = false;
  let gatewayEndpoint: string | undefined;
  if (gatewayApiInstalled && inferenceExtInstalled) {
    try {
      const gwStatus = await adapter.getGatewayStatus();
      gatewayAvailable = gwStatus.available;
      gatewayEndpoint = gwStatus.endpoint;
    } catch {
      // Gateway status check failed, not critical
    }
  }

  const allInstalled = gatewayApiInstalled && inferenceExtInstalled;
  let message: string;
  if (allInstalled && gatewayAvailable) {
    message = 'Gateway API and Inference Extension CRDs are installed. Gateway is available.';
  } else if (allInstalled) {
    message = 'Gateway API and Inference Extension CRDs are installed. No active gateway detected.';
  } else if (!gatewayApiInstalled && !inferenceExtInstalled) {
    message = 'Gateway API and Inference Extension CRDs are not installed.';
  } else if (!gatewayApiInstalled) {
    message = 'Gateway API CRDs are not installed.';
  } else {
    message = 'Inference Extension CRDs are not installed.';
  }

  return {
    gatewayApiInstalled,
    inferenceExtInstalled,
    gatewayApiVersion,
    inferenceExtVersion,
    pinnedVersion: PINNED_GAIE_VERSION,
    gatewayAvailable,
    gatewayEndpoint,
    message,
    installCommands: [
      `kubectl apply -f ${GATEWAY_API_CRD_URL}`,
      `kubectl apply -f ${GAIE_CRD_URL}`,
    ],
  };
}

function selectGateway(items: GatewayItem[]): GatewayItem | undefined {
  if (items.length === 0) {
    return undefined;
  }

  if (items.length === 1) {
    return items[0];
  }

  // Multiple Gateways: require the controller's inference-gateway label to disambiguate.
  const labeled = items.filter((gw) => gw.metadata?.labels?.[INFERENCE_GATEWAY_LABEL] === 'true');
  return labeled[0];
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
