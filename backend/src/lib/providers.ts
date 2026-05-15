import type {
  HelmChart,
  HelmRepo,
  InstallationStep,
  ProviderCapabilities,
  ProviderDeploymentDefaults,
  ProviderDetails,
  ProviderHealthConfig,
  ProviderInfo,
} from '@airunway/shared';
import logger from './logger';

export type ProviderHelmChartDetails = HelmChart;

const ANNOTATIONS = {
  displayName: 'airunway.ai/display-name',
  description: 'airunway.ai/description',
  defaultNamespace: 'airunway.ai/default-namespace',
  documentationUrl: 'airunway.ai/documentation-url',
  documentation: 'airunway.ai/documentation',
  icon: 'airunway.ai/icon',
  capabilities: 'airunway.ai/capabilities',
  deploymentDefaults: 'airunway.ai/deployment-defaults',
  health: 'airunway.ai/health',
  installation: 'airunway.ai/installation',
} as const;

function displayName(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
    : [];
}

function parseCrdApiVersion(apiVersion?: string): { apiGroup: string; apiVersion: string } {
  if (apiVersion && apiVersion.includes('/')) {
    const [apiGroup, version] = apiVersion.split('/', 2);
    return {
      apiGroup: apiGroup || 'airunway.ai',
      apiVersion: version || 'v1alpha1',
    };
  }

  return {
    apiGroup: 'airunway.ai',
    apiVersion: apiVersion || 'v1alpha1',
  };
}

function parseJsonAnnotation<T>(
  config: any,
  annotationKey: string,
  warnings: string[],
): T | undefined {
  const raw = config.metadata?.annotations?.[annotationKey];
  if (!raw) return undefined;

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      warnings.push(`${annotationKey} must be a JSON object`);
      return undefined;
    }
    return parsed as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    warnings.push(`Invalid JSON in ${annotationKey}: ${message}`);
    logger.warn({
      provider: config.metadata?.name,
      annotation: annotationKey,
      error: message,
    }, 'Failed to parse provider annotation');
    return undefined;
  }
}

function normalizeCapabilities(raw: unknown, warnings: string[]): ProviderCapabilities {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    warnings.push(`Missing ${ANNOTATIONS.capabilities}; provider is listed but not deployable`);
    return {
      engines: [],
      modes: [],
      modelSources: [],
      routerModes: [],
      features: {},
    };
  }

  const value = raw as Record<string, unknown>;
  const features = value.features && typeof value.features === 'object' && !Array.isArray(value.features)
    ? Object.fromEntries(
        Object.entries(value.features as Record<string, unknown>)
          .filter(([, featureValue]) => typeof featureValue === 'boolean'),
      ) as Record<string, boolean>
    : {};

  return {
    engines: stringArray(value.engines),
    modes: stringArray(value.modes ?? value.servingModes),
    modelSources: stringArray(value.modelSources),
    routerModes: stringArray(value.routerModes),
    features,
  };
}

function normalizeDeploymentDefaults(raw: unknown, warnings: string[]): ProviderDeploymentDefaults | undefined {
  if (!raw) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    warnings.push(`${ANNOTATIONS.deploymentDefaults} must be a JSON object`);
    return undefined;
  }

  const value = raw as Record<string, unknown>;
  const defaultResources = value.defaultResources && typeof value.defaultResources === 'object' && !Array.isArray(value.defaultResources)
    ? value.defaultResources as Record<string, unknown>
    : undefined;

  if (value.defaultResources !== undefined && defaultResources === undefined) {
    warnings.push(`${ANNOTATIONS.deploymentDefaults}.defaultResources must be an object`);
  }

  return {
    defaultEngine: nonEmptyString(value.defaultEngine),
    defaultMode: nonEmptyString(value.defaultMode),
    defaultResources,
  };
}

function normalizeOperatorPods(raw: unknown, warnings: string[]): ProviderHealthConfig['operatorPods'] {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    warnings.push(`${ANNOTATIONS.health}.operatorPods must be an array; falling back to provider status.ready`);
    return undefined;
  }

  const operatorPods = raw.flatMap((probe: any): NonNullable<ProviderHealthConfig['operatorPods']> => {
    if (!probe || typeof probe !== 'object' || Array.isArray(probe)) {
      warnings.push(`Ignoring malformed operator pod probe in ${ANNOTATIONS.health}.operatorPods`);
      return [];
    }

    const selectors = stringArray(probe.selectors);
    if (selectors.length === 0) {
      warnings.push(`Ignoring operator pod probe without selectors in ${ANNOTATIONS.health}.operatorPods`);
      return [];
    }

    return [{
      namespace: nonEmptyString(probe.namespace),
      selectors,
    }];
  });

  return operatorPods.length > 0 ? operatorPods : undefined;
}

function normalizeHealth(raw: unknown, warnings: string[]): ProviderHealthConfig | undefined {
  if (!raw) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    warnings.push(`${ANNOTATIONS.health} must be a JSON object; falling back to provider status.ready`);
    return undefined;
  }

  const value = raw as Record<string, unknown>;
  const operator = value.operator && typeof value.operator === 'object' && !Array.isArray(value.operator)
    ? value.operator as Record<string, unknown>
    : undefined;
  const status = value.status && typeof value.status === 'object' && !Array.isArray(value.status)
    ? value.status as Record<string, unknown>
    : undefined;

  if (value.crds !== undefined && !Array.isArray(value.crds)) {
    warnings.push(`${ANNOTATIONS.health}.crds must be an array; falling back to provider status.ready`);
  }
  if (value.operator !== undefined && operator === undefined) {
    warnings.push(`${ANNOTATIONS.health}.operator must be an object; falling back to provider status.ready`);
  }
  if (value.status !== undefined && status === undefined) {
    warnings.push(`${ANNOTATIONS.health}.status must be an object; falling back to provider status.ready`);
  }

  const legacyPodSelectors = stringArray(operator?.podSelectors);
  const legacyFallbackPodSelectors = stringArray(operator?.fallbackPodSelectors);
  const legacyCrossNamespacePodSelectors = stringArray(operator?.crossNamespacePodSelectors);
  const legacySelectors = Array.from(new Set([...legacyPodSelectors, ...legacyFallbackPodSelectors]));
  const legacyOperatorPods = legacySelectors.length > 0
    ? [{ namespace: nonEmptyString(operator?.namespace), selectors: legacySelectors }]
    : undefined;
  const crossNamespaceOperatorPods = legacyCrossNamespacePodSelectors.length > 0
    ? [{ selectors: legacyCrossNamespacePodSelectors }]
    : undefined;

  const operatorPods = normalizeOperatorPods(value.operatorPods, warnings)
    || (legacyOperatorPods || crossNamespaceOperatorPods
      ? [...(legacyOperatorPods || []), ...(crossNamespaceOperatorPods || [])]
      : undefined);

  return {
    crds: Array.isArray(value.crds)
      ? value.crds.filter((crd) => (
          typeof crd === 'string'
          || (crd && typeof crd === 'object' && !Array.isArray(crd) && typeof (crd as any).name === 'string')
        )) as ProviderHealthConfig['crds']
      : undefined,
    operatorPods,
    operator: operator
      ? {
          namespace: nonEmptyString(operator.namespace),
          podSelectors: legacyPodSelectors,
          fallbackPodSelectors: legacyFallbackPodSelectors,
          crossNamespacePodSelectors: legacyCrossNamespacePodSelectors,
        }
      : undefined,
    status: status
      ? {
          readyPath: nonEmptyString(status.readyPath),
          conditions: stringArray(status.conditions),
        }
      : undefined,
  };
}

/**
 * Parse the installation annotation (JSON) from an InferenceProviderConfig CRD object.
 */
export function parseInstallationAnnotation(config: any, warnings: string[] = []): any {
  return parseJsonAnnotation<any>(config, ANNOTATIONS.installation, warnings) || {};
}

function normalizeHelmRepos(providerId: string, raw: unknown, warnings: string[]): HelmRepo[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    warnings.push(`${ANNOTATIONS.installation}.helmRepos must be an array`);
    return [];
  }

  return raw.flatMap((repo: any) => {
    const name = nonEmptyString(repo?.name);
    const url = nonEmptyString(repo?.url);
    if (!name || !url) {
      warnings.push(`Ignoring malformed Helm repo in ${ANNOTATIONS.installation}`);
      logger.warn({ provider: providerId, repo }, 'Ignoring malformed Helm repo in provider installation metadata');
      return [];
    }

    return [{ name, url }];
  });
}

function normalizeHelmCharts(providerId: string, raw: unknown, warnings: string[]): HelmChart[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    warnings.push(`${ANNOTATIONS.installation}.helmCharts must be an array`);
    return [];
  }

  return raw.flatMap((chart: any): HelmChart[] => {
    const name = nonEmptyString(chart?.name);
    const chartRef = nonEmptyString(chart?.chart);
    const namespace = nonEmptyString(chart?.namespace);

    if (!name || !chartRef || !namespace) {
      warnings.push(`Ignoring malformed Helm chart in ${ANNOTATIONS.installation}`);
      logger.warn({ provider: providerId, chart }, 'Ignoring malformed Helm chart in provider installation metadata');
      return [];
    }

    const values = chart.values && typeof chart.values === 'object' && !Array.isArray(chart.values)
      ? chart.values as Record<string, unknown>
      : undefined;

    if (chart.values !== undefined && values === undefined) {
      warnings.push(`Ignoring malformed values for Helm chart ${name}`);
      logger.warn(
        { provider: providerId, chart: name },
        'Ignoring malformed Helm chart values in provider installation metadata',
      );
    }

    return [{
      name,
      chart: chartRef,
      version: nonEmptyString(chart.version),
      namespace,
      createNamespace: typeof chart.createNamespace === 'boolean' ? chart.createNamespace : undefined,
      values,
      skipCrds: typeof chart.skipCrds === 'boolean' ? chart.skipCrds : undefined,
      fetchUrl: nonEmptyString(chart.fetchUrl),
      preCrdUrls: Array.isArray(chart.preCrdUrls) ? stringArray(chart.preCrdUrls) : undefined,
      preInstallMissingCrds: typeof chart.preInstallMissingCrds === 'boolean' ? chart.preInstallMissingCrds : undefined,
    }];
  });
}

function normalizeInstallationSteps(raw: unknown, warnings: string[]): InstallationStep[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    warnings.push(`${ANNOTATIONS.installation}.steps must be an array`);
    return [];
  }

  return raw.flatMap((step: any): InstallationStep[] => {
    const title = nonEmptyString(step?.title);
    const description = nonEmptyString(step?.description);

    if (!title || !description) {
      warnings.push(`Ignoring malformed installation step in ${ANNOTATIONS.installation}`);
      return [];
    }

    return [{
      title,
      command: nonEmptyString(step.command),
      description,
    }];
  });
}

function normalizeProvider(config: any): ProviderDetails {
  const id = nonEmptyString(config.metadata?.name) || 'unknown';
  const annotations = config.metadata?.annotations || {};
  const warnings: string[] = [];

  const installation = parseInstallationAnnotation(config, warnings);
  const capabilities = normalizeCapabilities(
    parseJsonAnnotation<unknown>(config, ANNOTATIONS.capabilities, warnings),
    warnings,
  );
  const deploymentDefaults = normalizeDeploymentDefaults(
    parseJsonAnnotation<unknown>(config, ANNOTATIONS.deploymentDefaults, warnings),
    warnings,
  );
  const health = normalizeHealth(
    parseJsonAnnotation<unknown>(config, ANNOTATIONS.health, warnings),
    warnings,
  );

  const helmRepos = normalizeHelmRepos(id, installation.helmRepos, warnings);
  const helmCharts = normalizeHelmCharts(id, installation.helmCharts, warnings);
  const installationSteps = normalizeInstallationSteps(installation.steps, warnings);
  const crdApiVersion = parseCrdApiVersion(config.apiVersion);

  return {
    id,
    name: nonEmptyString(annotations[ANNOTATIONS.displayName]) || displayName(id),
    description: nonEmptyString(annotations[ANNOTATIONS.description]) || nonEmptyString(installation.description) || 'No description available',
    defaultNamespace: nonEmptyString(annotations[ANNOTATIONS.defaultNamespace]) || nonEmptyString(installation.defaultNamespace) || 'default',
    documentationUrl: nonEmptyString(annotations[ANNOTATIONS.documentationUrl]) || nonEmptyString(annotations[ANNOTATIONS.documentation]),
    icon: nonEmptyString(annotations[ANNOTATIONS.icon]),
    warnings,
    installable: helmCharts.length > 0 || helmRepos.length > 0 || installationSteps.length > 0,
    capabilities,
    deploymentDefaults,
    health,
    crdConfig: {
      apiGroup: crdApiVersion.apiGroup,
      apiVersion: crdApiVersion.apiVersion,
      plural: 'inferenceproviderconfigs',
      kind: config.kind || 'InferenceProviderConfig',
    },
    helmRepos,
    helmCharts,
    installationSteps,
  };
}

/**
 * Extract concise provider list metadata from an InferenceProviderConfig CRD object.
 */
export function extractProviderInfo(config: any): ProviderInfo {
  const provider = normalizeProvider(config);
  return {
    id: provider.id,
    name: provider.name,
    description: provider.description,
    defaultNamespace: provider.defaultNamespace,
    documentationUrl: provider.documentationUrl,
    icon: provider.icon,
    warnings: provider.warnings,
    installable: provider.installable,
    capabilities: provider.capabilities,
    deploymentDefaults: provider.deploymentDefaults,
    health: provider.health,
  };
}

/**
 * Extract full provider details from an InferenceProviderConfig CRD object.
 */
export function extractProviderDetails(config: any): ProviderDetails {
  return normalizeProvider(config);
}
