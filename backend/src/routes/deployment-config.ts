import { z } from 'zod';
import {
  toModelDeploymentManifest,
  type DeploymentConfig,
} from '@airunway/shared';

import { aikitService, GGUF_RUNNER_IMAGE } from '../services/aikit';
import {
  namespaceSchema,
  resourceNameSchema,
} from '../lib/validation';

const DNS_LABEL_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

const SYSTEM_PATHS = ['/dev', '/proc', '/sys', '/etc', '/var/run'];
// Matches Kubernetes resource.Quantity: a valid decimal number with optional
// binary (Ki, Mi, Gi, Ti, Pi, Ei) or decimal (n, u, m, k, M, G, T, P, E) suffix.
// Requires at least one digit; rejects bare dots, multiple dots, etc.
const K8S_QUANTITY_REGEX = /^[+-]?(\d+\.?\d*|\d*\.?\d+)([eE][+-]?\d+|[KMGTPE]i?|[numkMGTPE])?$/;

const storageVolumeSchema = z.object({
  name: z.string()
    .min(1, 'Volume name is required')
    .max(63, 'Volume name must be 63 characters or less')
    .regex(DNS_LABEL_REGEX, 'Volume name must be a valid DNS label (lowercase alphanumeric with hyphens)'),
  purpose: z.enum(['modelCache', 'compilationCache', 'custom']).optional().default('custom'),
  mountPath: z.string().optional(),
  readOnly: z.boolean().optional().default(false),
  size: z.string()
    .regex(K8S_QUANTITY_REGEX, 'Size must be a valid Kubernetes quantity (e.g. 100Gi, 500Mi, 1Ti)')
    .optional(),
  claimName: z.string().optional(),
  storageClassName: z.string().optional(),
  accessMode: z.enum(['ReadWriteOnce', 'ReadWriteMany', 'ReadOnlyMany', 'ReadWriteOncePod']).optional(),
});

const storageSchema = z.object({
  volumes: z.array(storageVolumeSchema).max(8, 'Maximum 8 storage volumes allowed').optional(),
}).optional();

export const createDeploymentSchema = z.object({
  name: resourceNameSchema,
  modelId: z.string().min(1, 'Model ID is required'),
  engine: z.enum(['vllm', 'sglang', 'trtllm', 'llamacpp']),
  namespace: namespaceSchema.optional(),
  mode: z.enum(['aggregated', 'disaggregated']).optional().default('aggregated'),
  provider: resourceNameSchema.optional(),
  servedModelName: z.string().optional(),
  routerMode: z.enum(['default', 'kv', 'round-robin']).optional().default('default'),
  replicas: z.number().int().min(0).optional().default(1),
  hfTokenSecret: z.string().optional().default(''),
  contextLength: z.number().int().positive().optional(),
  enforceEager: z.boolean().optional().default(false),
  enablePrefixCaching: z.boolean().optional().default(true),
  trustRemoteCode: z.boolean().optional().default(false),
  resources: z.object({
    gpu: z.number().int().min(0),
    memory: z.string().optional(),
  }).optional(),
  engineArgs: z.record(z.string(), z.unknown()).optional(),
  providerOverrides: z.record(z.string(), z.unknown()).optional(),
  prefillReplicas: z.number().int().min(0).optional(),
  decodeReplicas: z.number().int().min(0).optional(),
  prefillGpus: z.number().int().min(0).optional(),
  decodeGpus: z.number().int().min(0).optional(),
  modelSource: z.enum(['premade', 'huggingface', 'vllm']).optional(),
  premadeModel: z.string().optional(),
  ggufFile: z.string().optional(),
  ggufRunMode: z.enum(['build', 'direct']).optional(),
  imageRef: z.string().optional(),
  computeType: z.enum(['cpu', 'gpu']).optional(),
  maxModelLen: z.number().int().positive().optional(),
  gatewayEnabled: z.boolean().optional(),
  storage: storageSchema,
}).superRefine((data, ctx) => {
  const volumes = data.storage?.volumes;
  if (!volumes || volumes.length === 0) return;

  // Default mount path map (mirrors webhook defaults)
  const DEFAULT_MOUNT_PATHS: Record<string, string> = {
    modelCache: '/model-cache',
    compilationCache: '/compilation-cache',
  };

  // Resolve effective values that the webhook would default,
  // so uniqueness checks match what the cluster will actually see.
  const resolvedMountPaths = volumes.map(
    (vol) => vol.mountPath || DEFAULT_MOUNT_PATHS[vol.purpose || ''] || ''
  );
  const resolvedClaimNames = volumes.map(
    (vol) => vol.claimName || (vol.size ? `${data.name}-${vol.name}` : '')
  );

  // Rule 1: Unique volume names
  const names = new Set<string>();
  for (let i = 0; i < volumes.length; i++) {
    if (names.has(volumes[i].name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate volume name: "${volumes[i].name}"`,
        path: ['storage', 'volumes', i, 'name'],
      });
    }
    names.add(volumes[i].name);
  }

  // Rule 2: Unique mount paths (using resolved defaults)
  const mountPaths = new Set<string>();
  for (let i = 0; i < volumes.length; i++) {
    const mp = resolvedMountPaths[i];
    if (mp) {
      if (mountPaths.has(mp)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate mount path: "${mp}"`,
          path: ['storage', 'volumes', i, 'mountPath'],
        });
      }
      mountPaths.add(mp);
    }
  }

  // Rule 3: Unique claim names (using resolved defaults)
  const claimNames = new Set<string>();
  for (let i = 0; i < volumes.length; i++) {
    const cn = resolvedClaimNames[i];
    if (cn) {
      if (claimNames.has(cn)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate claim name: "${cn}"`,
          path: ['storage', 'volumes', i, 'claimName'],
        });
      }
      claimNames.add(cn);
    }
  }

  // Count purpose occurrences for Rule 7
  let modelCacheCount = 0;
  let compilationCacheCount = 0;

  for (let i = 0; i < volumes.length; i++) {
    const vol = volumes[i];

    // Rule 4: mountPath must be absolute when set
    if (vol.mountPath && !vol.mountPath.startsWith('/')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Mount path must be an absolute path (start with /)',
        path: ['storage', 'volumes', i, 'mountPath'],
      });
    }

    // Rule 5: mountPath required when purpose is custom
    if (vol.purpose === 'custom' && !vol.mountPath) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Mount path is required for custom purpose volumes',
        path: ['storage', 'volumes', i, 'mountPath'],
      });
    }

    // Rule 6: Reject system paths
    if (vol.mountPath) {
      for (const sysPath of SYSTEM_PATHS) {
        if (vol.mountPath === sysPath || vol.mountPath.startsWith(sysPath + '/')) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Mount path "${vol.mountPath}" conflicts with system path "${sysPath}"`,
            path: ['storage', 'volumes', i, 'mountPath'],
          });
          break;
        }
      }
    }

    // Rule 7: Count purposes
    if (vol.purpose === 'modelCache') modelCacheCount++;
    if (vol.purpose === 'compilationCache') compilationCacheCount++;

    // Rule 8: When size is NOT set, claimName is required
    if (!vol.size && !vol.claimName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Claim name is required when size is not specified (existing PVC)',
        path: ['storage', 'volumes', i, 'claimName'],
      });
    }

    // Rule 9: When size IS set, readOnly must be false
    if (vol.size && vol.readOnly) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Read-only is not allowed for controller-created PVCs (size is set)',
        path: ['storage', 'volumes', i, 'readOnly'],
      });
    }

    // Rule 10: When size IS set, claimName must be empty or match <deploymentName>-<volumeName>
    if (vol.size && vol.claimName) {
      const expectedClaimName = `${data.name}-${vol.name}`;
      if (vol.claimName !== expectedClaimName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `When size is set, claim name must be empty or match "${expectedClaimName}"`,
          path: ['storage', 'volumes', i, 'claimName'],
        });
      }
    }

    // Rule 11: accessMode only valid when size is set
    if (vol.accessMode && !vol.size) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Access mode is only valid when size is specified (new PVC)',
        path: ['storage', 'volumes', i, 'accessMode'],
      });
    }

    // Rule 12: storageClassName only valid when size is set
    if (vol.storageClassName !== undefined && !vol.size) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Storage class name is only valid when size is specified (new PVC)',
        path: ['storage', 'volumes', i, 'storageClassName'],
      });
    }

    // Rule 13: Auto-generated claim name must be <=253 chars
    if (vol.size && !vol.claimName) {
      const autoClaimName = `${data.name}-${vol.name}`;
      if (autoClaimName.length > 253) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Auto-generated claim name "${autoClaimName}" exceeds 253 character limit`,
          path: ['storage', 'volumes', i, 'name'],
        });
      }
    }
  }

  // Rule 7: Max 1 of each singleton purpose
  if (modelCacheCount > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Only one volume with purpose "modelCache" is allowed',
      path: ['storage', 'volumes'],
    });
  }
  if (compilationCacheCount > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Only one volume with purpose "compilationCache" is allowed',
      path: ['storage', 'volumes'],
    });
  }
});



export type CreateDeploymentBody = z.infer<typeof createDeploymentSchema>;

export function toDeploymentConfig(
  body: CreateDeploymentBody,
  defaultNamespace: string
): DeploymentConfig {
  return resolveDeploymentImages({
    ...body,
    namespace: body.namespace || defaultNamespace,
  });
}

export function createDeploymentPreviewPayload(config: DeploymentConfig): {
  resources: Array<{
    kind: 'ModelDeployment';
    apiVersion: 'airunway.ai/v1alpha1';
    name: string;
    manifest: Record<string, unknown>;
  }>;
  primaryResource: { kind: 'ModelDeployment'; apiVersion: 'airunway.ai/v1alpha1' };
} {
  const previewConfig = applyDeploymentPreviewDefaults(config);
  const manifest = toModelDeploymentManifest(previewConfig);

  return {
    resources: [{
      kind: 'ModelDeployment',
      apiVersion: 'airunway.ai/v1alpha1',
      name: previewConfig.name,
      manifest: manifest as unknown as Record<string, unknown>,
    }],
    primaryResource: { kind: 'ModelDeployment', apiVersion: 'airunway.ai/v1alpha1' },
  };
}

function applyDeploymentPreviewDefaults(config: DeploymentConfig): DeploymentConfig {
  if (!config.storage?.volumes) {
    return config;
  }

  // Apply storage defaults that the mutating webhook would add,
  // so the preview manifest matches what Kubernetes will persist.
  return {
    ...config,
    storage: {
      ...config.storage,
      volumes: config.storage.volumes.map((vol) => {
        const defaulted = { ...vol };
        // Default purpose
        if (!defaulted.purpose) {
          defaulted.purpose = 'custom';
        }
        // Default mountPath based on purpose
        if (!defaulted.mountPath) {
          if (defaulted.purpose === 'modelCache') defaulted.mountPath = '/model-cache';
          if (defaulted.purpose === 'compilationCache') defaulted.mountPath = '/compilation-cache';
        }
        // When size is set (controller-created PVC mode):
        if (defaulted.size) {
          // Default claimName to <deploymentName>-<volumeName>
          if (!defaulted.claimName) {
            defaulted.claimName = `${config.name}-${defaulted.name}`;
          }
          // Default accessMode to ReadWriteMany
          if (!defaulted.accessMode) {
            defaulted.accessMode = 'ReadWriteMany';
          }
        }
        return defaulted;
      }),
    },
  };
}

function resolveDeploymentImages(config: DeploymentConfig): DeploymentConfig {
  if (config.provider !== 'kaito') {
    return config;
  }

  if (config.modelSource === 'premade' && config.premadeModel) {
    if (config.imageRef) {
      return config;
    }

    const imageRef = aikitService.getImageRef({
      modelSource: 'premade',
      premadeModel: config.premadeModel,
    });
    return imageRef ? { ...config, imageRef } : config;
  }

  if (config.modelSource === 'huggingface' && config.ggufRunMode === 'direct') {
    const resolvedConfig: DeploymentConfig = {
      ...config,
      imageRef: config.imageRef || GGUF_RUNNER_IMAGE,
    };

    if (config.ggufFile) {
      resolvedConfig.engineArgs = {
        ...(config.engineArgs || {}),
        ggufUrl: aikitService.buildHuggingFaceUrl(config.modelId, config.ggufFile),
      };
    }

    return resolvedConfig;
  }

  return config;
}

