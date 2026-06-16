import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { HTTPException } from 'hono/http-exception';
import { chatCompletionSchema, createDeploymentChatResponse } from './deployment-chat';
import {
  createDeploymentPreviewPayload,
  createDeploymentSchema,
  toDeploymentConfig,
} from './deployment-config';
import { kubernetesService } from '../services/kubernetes';
import { configService } from '../services/config';
import { metricsService } from '../services/metrics';
import { validateGpuFit, formatGpuWarnings } from '../services/gpuValidation';
import { handleK8sError } from '../lib/k8s-errors';
import models from '../data/models.json';
import logger from '../lib/logger';
import type { AppEnv } from '../types/hono';
import {
  parseFrontendService,
  type DeploymentStatus,
} from '@airunway/shared';
import {
  namespaceSchema,
  resourceNameSchema,
} from '../lib/validation';

const listDeploymentsQuerySchema = z.object({
  namespace: namespaceSchema.optional(),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : undefined))
    .pipe(z.number().int().min(1).max(100).optional()),
  offset: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : undefined))
    .pipe(z.number().int().min(0).optional()),
});

const deploymentQuerySchema = z.object({
  namespace: namespaceSchema.optional(),
});

const deploymentParamsSchema = z.object({
  name: resourceNameSchema,
});

const namespacedDeploymentParamsSchema = z.object({
  namespace: namespaceSchema,
  name: resourceNameSchema,
});

const deployments = new Hono<AppEnv>()
  .get('/', zValidator('query', listDeploymentsQuerySchema), async (c) => {
    try {
      const { namespace, limit, offset } = c.req.valid('query');
      const userToken = c.get('token') as string | undefined;

      let deploymentsList: DeploymentStatus[] = await kubernetesService.listDeployments(namespace, userToken);

      const total = deploymentsList.length;

      // Apply pagination
      if (offset !== undefined || limit !== undefined) {
        const start = offset || 0;
        const end = limit ? start + limit : undefined;
        deploymentsList = deploymentsList.slice(start, end);
      }

      return c.json({
        deployments: deploymentsList || [],
        pagination: {
          total,
          limit: limit || total,
          offset: offset || 0,
          hasMore: (offset || 0) + deploymentsList.length < total,
        },
      });
    } catch (error) {
      logger.error({ error }, 'Error in GET /deployments');
      return c.json({
        deployments: [],
        pagination: { total: 0, limit: 0, offset: 0, hasMore: false },
      });
    }
  })
  .post('/', zValidator('json', createDeploymentSchema), async (c) => {
    const body = c.req.valid('json');

    const config = toDeploymentConfig(
      body,
      body.namespace || (await configService.getDefaultNamespace())
    );

    // GPU fit validation
    let gpuWarnings: string[] = [];
    try {
      const capacity = await kubernetesService.getClusterGpuCapacity();

      const model = models.models.find((m) => m.id === config.modelId);
      const modelMinGpus = (model as { minGpus?: number })?.minGpus ?? 1;

      const gpuFitResult = validateGpuFit(config, capacity, modelMinGpus);
      if (!gpuFitResult.fits) {
        gpuWarnings = formatGpuWarnings(gpuFitResult);
        logger.warn(
          {
            modelId: config.modelId,
            warnings: gpuWarnings,
            capacity: {
              available: capacity.availableGpus,
              maxContiguous: capacity.maxContiguousAvailable,
            },
          },
          'GPU fit warnings for deployment'
        );
      }
    } catch (gpuError) {
      logger.warn({ error: gpuError }, 'Could not perform GPU fit validation');
    }

    // Create deployment with detailed error handling
    const userToken = c.get('token') as string | undefined;
    try {
      await kubernetesService.createDeployment(config, userToken);
    } catch (error) {
      const { message, statusCode } = handleK8sError(error, {
        operation: 'createDeployment',
        deploymentName: config.name,
        namespace: config.namespace,
        modelId: config.modelId,
      });

      throw new HTTPException(statusCode as 400 | 403 | 404 | 409 | 422 | 500, {
        message: `Failed to create deployment: ${message}`,
      });
    }

    return c.json(
      {
        message: 'Deployment created successfully',
        name: config.name,
        namespace: config.namespace,
        ...(gpuWarnings.length > 0 && { warnings: gpuWarnings }),
      },
      201
    );
  })
  .post('/preview', zValidator('json', createDeploymentSchema), async (c) => {
    const body = c.req.valid('json');
    const config = toDeploymentConfig(
      body,
      body.namespace || (await configService.getDefaultNamespace())
    );

    return c.json(createDeploymentPreviewPayload(config));
  })
  .post(
    '/:namespace/:name/chat',
    zValidator('param', namespacedDeploymentParamsSchema),
    zValidator('json', chatCompletionSchema),
    async (c) => {
      const { namespace, name } = c.req.valid('param');
      return createDeploymentChatResponse({
        deploymentName: name,
        namespace,
        body: c.req.valid('json'),
        requestSignal: c.req.raw.signal,
        userToken: c.get('token') as string | undefined,
      });
    }
  )
  .post(
    '/:name/chat',
    zValidator('param', deploymentParamsSchema),
    zValidator('query', deploymentQuerySchema),
    zValidator('json', chatCompletionSchema),
    async (c) => {
      const { name } = c.req.valid('param');
      const { namespace } = c.req.valid('query');
      return createDeploymentChatResponse({
        deploymentName: name,
        namespace,
        body: c.req.valid('json'),
        requestSignal: c.req.raw.signal,
        userToken: c.get('token') as string | undefined,
      });
    }
  )
  // List PVCs in a namespace (for storage volume selection)
  // Use a reserved segment to avoid conflicting with deployment names like "pvcs".
  .get('/-/pvcs', zValidator('query', z.object({ namespace: namespaceSchema })), async (c) => {
    const { namespace } = c.req.valid('query');
    const userToken = c.get('token') as string | undefined;
    try {
      const pvcs = await kubernetesService.listPVCs(namespace, userToken);
      return c.json({ pvcs });
    } catch (error) {
      const { message, statusCode } = handleK8sError(error, {
        operation: 'listPVCs',
        namespace,
      });

      throw new HTTPException(statusCode as 400 | 401 | 403 | 404 | 409 | 422 | 500 | 502 | 503 | 504, {
        message: `Failed to list storage disks: ${message}`,
      });
    }
  })
  .get(
    '/:name',
    zValidator('param', deploymentParamsSchema),
    zValidator('query', deploymentQuerySchema),
    async (c) => {
      const { name } = c.req.valid('param');
      const { namespace } = c.req.valid('query');
      const resolvedNamespace = namespace || (await configService.getDefaultNamespace());
      const userToken = c.get('token') as string | undefined;

      const deployment = await kubernetesService.getDeployment(name, resolvedNamespace, userToken);

      if (!deployment) {
        throw new HTTPException(404, { message: 'Deployment not found' });
      }

      return c.json(deployment);
    }
  )
  .get(
    '/:name/manifest',
    zValidator('param', deploymentParamsSchema),
    zValidator('query', deploymentQuerySchema),
    async (c) => {
      const { name } = c.req.valid('param');
      const { namespace } = c.req.valid('query');
      const resolvedNamespace = namespace || (await configService.getDefaultNamespace());
      const userToken = c.get('token') as string | undefined;

      // Get the main CR manifest
      const manifest = await kubernetesService.getDeploymentManifest(name, resolvedNamespace, userToken);

      if (!manifest) {
        throw new HTTPException(404, { message: 'Deployment manifest not found' });
      }

      const kind = (manifest.kind as string) || 'ModelDeployment';
      const apiVersion = (manifest.apiVersion as string) || 'airunway.ai/v1alpha1';

      // Build array of resources
      const resources: Array<{
        kind: string;
        apiVersion: string;
        name: string;
        manifest: Record<string, unknown>;
      }> = [];

      // Add main CR
      resources.push({
        kind,
        apiVersion,
        name,
        manifest,
      });

      return c.json({
        resources,
        primaryResource: {
          kind,
          apiVersion,
        },
      });
    }
  )
  .delete(
    '/:name',
    zValidator('param', deploymentParamsSchema),
    zValidator('query', deploymentQuerySchema),
    async (c) => {
      const { name } = c.req.valid('param');
      const { namespace } = c.req.valid('query');
      const resolvedNamespace = namespace || (await configService.getDefaultNamespace());
      const userToken = c.get('token') as string | undefined;

      try {
        await kubernetesService.deleteDeployment(name, resolvedNamespace, userToken);
      } catch (error) {
        // Check if it's a "not found" error from our own code
        if (error instanceof Error && error.message.includes('not found')) {
          throw new HTTPException(404, { message: error.message });
        }

        const { message, statusCode } = handleK8sError(error, {
          operation: 'deleteDeployment',
          deploymentName: name,
          namespace: resolvedNamespace,
        });

        throw new HTTPException(statusCode as 400 | 403 | 404 | 500, {
          message: `Failed to delete deployment: ${message}`,
        });
      }

      return c.json({ message: 'Deployment deleted successfully' });
    }
  )
  .get(
    '/:name/pods',
    zValidator('param', deploymentParamsSchema),
    zValidator('query', deploymentQuerySchema),
    async (c) => {
      const { name } = c.req.valid('param');
      const { namespace } = c.req.valid('query');
      const resolvedNamespace = namespace || (await configService.getDefaultNamespace());
      const userToken = c.get('token') as string | undefined;

      // Verify user has access to the parent ModelDeployment
      const deployment = await kubernetesService.getDeployment(name, resolvedNamespace, userToken);
      if (!deployment) {
        throw new HTTPException(404, { message: 'Deployment not found' });
      }

      const pods = await kubernetesService.getDeploymentPods(name, resolvedNamespace);
      return c.json({ pods });
    }
  )
  .get(
    '/:name/metrics',
    zValidator('param', deploymentParamsSchema),
    zValidator('query', deploymentQuerySchema),
    async (c) => {
      const { name } = c.req.valid('param');
      const { namespace } = c.req.valid('query');
      const resolvedNamespace = namespace || (await configService.getDefaultNamespace());
      const userToken = c.get('token') as string | undefined;

      // Verify user has access to the parent ModelDeployment
      const deployment = await kubernetesService.getDeployment(name, resolvedNamespace, userToken);
      if (!deployment) {
        throw new HTTPException(404, { message: 'Deployment not found' });
      }

      const frontendService = parseFrontendService(deployment.frontendService);
      const metricsResponse = await metricsService.getDeploymentMetrics(name, resolvedNamespace, {
        providerId: deployment.provider,
        serviceName: frontendService?.serviceName,
        port: frontendService?.servicePort,
      });
      return c.json(metricsResponse);
    }
)
  .get(
    '/:name/pending-reasons',
    zValidator('param', deploymentParamsSchema),
    zValidator('query', deploymentQuerySchema),
    async (c) => {
      const { name } = c.req.valid('param');
      const { namespace } = c.req.valid('query');
      const resolvedNamespace = namespace || (await configService.getDefaultNamespace());
      const userToken = c.get('token') as string | undefined;

      try {
        // Get deployment to find pending pods
        const deployment = await kubernetesService.getDeployment(name, resolvedNamespace, userToken);

        if (!deployment) {
          throw new HTTPException(404, { message: 'Deployment not found' });
        }

        // Get all pending pods
        const pendingPods = deployment.pods.filter(pod => pod.phase === 'Pending');

        if (pendingPods.length === 0) {
          return c.json({ reasons: [] });
        }

        // Get failure reasons for the first pending pod (they're typically the same)
        const podName = pendingPods[0].name;
        const reasons = await kubernetesService.getPodFailureReasons(podName, resolvedNamespace);

        return c.json({ reasons });
      } catch (error) {
        if (error instanceof HTTPException) {
          throw error;
        }
        logger.error({ error, name, namespace: resolvedNamespace }, 'Error getting pending reasons');
        return c.json(
          {
            error: {
              message: error instanceof Error ? error.message : 'Failed to get pending reasons',
              statusCode: 500,
            },
          },
          500
        );
      }
    }
  )
  .get(
    '/:name/logs',
    zValidator('param', deploymentParamsSchema),
    zValidator('query', z.object({
      namespace: namespaceSchema.optional(),
      podName: z.string().optional(),
      container: z.string().optional(),
      tailLines: z.string().optional()
        .transform((val) => (val ? parseInt(val, 10) : undefined))
        .pipe(z.number().int().min(1).max(10000).optional()),
      timestamps: z.string().optional()
        .transform((val) => val === 'true'),
    })),
    async (c) => {
      const { name } = c.req.valid('param');
      const { namespace, podName, container, tailLines, timestamps } = c.req.valid('query');
      const resolvedNamespace = namespace || (await configService.getDefaultNamespace());
      const userToken = c.get('token') as string | undefined;

      try {
        // Verify user has access to the parent ModelDeployment
        const deployment = await kubernetesService.getDeployment(name, resolvedNamespace, userToken);
        if (!deployment) {
          throw new HTTPException(404, { message: 'Deployment not found' });
        }

        // Use service account for pod listing and log fetching
        const pods = await kubernetesService.getDeploymentPods(name, resolvedNamespace);

        if (pods.length === 0) {
          logger.debug({ name, namespace: resolvedNamespace }, 'No pods found for deployment');
          return c.json({ logs: '', podName: '', message: 'No pods found for this deployment' });
        }

        // Use specified pod or default to first pod
        const targetPodName = podName || pods[0].name;

        // Verify the pod belongs to this deployment
        const podExists = pods.some(pod => pod.name === targetPodName);
        if (!podExists) {
          throw new HTTPException(400, {
            message: `Pod '${targetPodName}' is not part of deployment '${name}'`
          });
        }

        logger.debug({ name, namespace: resolvedNamespace, targetPodName }, 'Fetching logs for pod');

        const logs = await kubernetesService.getPodLogs(targetPodName, resolvedNamespace, {
          container,
          tailLines: tailLines || 100,
          timestamps: timestamps || false,
        });

        return c.json({
          logs,
          podName: targetPodName,
          container: container || undefined,
        });
      } catch (error) {
        if (error instanceof HTTPException) {
          throw error;
        }
        logger.error({ error, name, namespace: resolvedNamespace }, 'Error getting deployment logs');
        return c.json(
          {
            error: {
              message: error instanceof Error ? error.message : 'Failed to get logs',
              statusCode: 500,
            },
          },
          500
        );
      }
    }
  );

export default deployments;
