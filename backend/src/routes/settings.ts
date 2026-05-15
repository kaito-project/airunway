import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { configService } from '../services/config';
import { authService } from '../services/auth';
import { kubernetesService } from '../services/kubernetes';
import { extractProviderDetails, extractProviderInfo } from '../lib/providers';
import logger from '../lib/logger';

const updateSettingsSchema = z.object({
  defaultNamespace: z.string().optional(),
});

const settings = new Hono()
  .get('/', async (c) => {
    logger.debug('Fetching settings');
    const config = await configService.getConfig();
    const providerConfigs = await kubernetesService.listInferenceProviderConfigs();

    return c.json({
      config,
      providers: providerConfigs.map(extractProviderInfo),
      auth: {
        enabled: authService.isAuthEnabled(),
      },
    });
  })
  .get('/providers', async (c) => {
    logger.debug('Fetching provider list');
    const providerConfigs = await kubernetesService.listInferenceProviderConfigs();

    return c.json({
      providers: providerConfigs.map(extractProviderInfo),
    });
  })
  .get('/providers/:id', async (c) => {
    const id = c.req.param('id');
    logger.debug({ id }, 'Fetching provider details');

    const config = await kubernetesService.getInferenceProviderConfig(id);
    if (!config) {
      throw new HTTPException(404, { message: `Provider not found: ${id}` });
    }

    return c.json(extractProviderDetails(config));
  })
  .put('/', zValidator('json', updateSettingsSchema), async (c) => {
    // Settings PUT requires authentication when auth is enabled
    if (authService.isAuthEnabled()) {
      const authHeader = c.req.header('Authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new HTTPException(401, { message: 'Authentication required' });
      }
      const token = authHeader.slice(7);
      const result = await authService.validateToken(token);
      if (!result.valid) {
        throw new HTTPException(401, { message: result.error || 'Invalid token' });
      }
    }

    const data = c.req.valid('json');
    logger.info({ updates: data }, 'Updating settings');

    const updatedConfig = await configService.setConfig(data);
    logger.info({ config: updatedConfig }, 'Settings updated successfully');

    return c.json({
      message: 'Settings updated successfully',
      config: updatedConfig,
    });
  });

export default settings;
