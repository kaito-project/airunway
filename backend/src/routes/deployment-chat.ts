import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';
import {
  parseFrontendService,
  type DeploymentStatus,
} from '@airunway/shared';

import logger from '../lib/logger';
import { configService } from '../services/config';
import { kubernetesService } from '../services/kubernetes';

const DEFAULT_FRONTEND_SERVICE_PORT = 8000;
const CHAT_MODEL_DISCOVERY_TIMEOUT_MS = 1000;
const CHAT_MODEL_DISCOVERY_ACCEPT_HEADER = 'application/json';
const UPSTREAM_CHAT_ERROR_DETAILS_MAX_LENGTH = 1000;
const UPSTREAM_CHAT_ERROR_STATUS_CODES = [
  400,
  401,
  403,
  404,
  408,
  409,
  410,
  413,
  415,
  422,
  429,
  500,
  501,
  502,
  503,
  504,
] as const satisfies readonly ContentfulStatusCode[];
const CHAT_STREAM_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no',
  'Content-Encoding': 'identity',
};

const chatMessageSchema = z.object({
  role: z.string().min(1),
  content: z.unknown(),
}).passthrough();

export const chatCompletionSchema = z.object({
  messages: z.array(chatMessageSchema).min(1),
  model: z.string().min(1).optional(),
  temperature: z.number().optional(),
  max_tokens: z.number().int().positive().optional(),
  max_completion_tokens: z.number().int().positive().optional(),
  top_p: z.number().optional(),
  n: z.number().int().positive().optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
  presence_penalty: z.number().optional(),
  frequency_penalty: z.number().optional(),
  user: z.string().optional(),
  tools: z.unknown().optional(),
  tool_choice: z.unknown().optional(),
  response_format: z.unknown().optional(),
  seed: z.number().int().optional(),
}).passthrough();

export type ChatCompletionBody = z.infer<typeof chatCompletionSchema>;

export interface DeploymentChatRequest {
  deploymentName: string;
  namespace?: string;
  body: ChatCompletionBody;
  requestSignal: AbortSignal;
  userToken?: string;
}

function parseJsonObject(text: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function getNestedStringValue(source: unknown, path: string[]): string | undefined {
  let current = source;
  for (const segment of path) {
    if (!current || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return typeof current === 'string' && current.trim() ? current : undefined;
}

function truncateErrorMessage(message: string, maxLength = 500): string {
  return message.length > maxLength ? `${message.slice(0, maxLength)}…` : message;
}

function toUpstreamChatErrorStatusCode(statusCode: number): ContentfulStatusCode {
  return UPSTREAM_CHAT_ERROR_STATUS_CODES.includes(
    statusCode as (typeof UPSTREAM_CHAT_ERROR_STATUS_CODES)[number]
  )
    ? statusCode as ContentfulStatusCode
    : 502;
}

function sanitizeUpstreamErrorDetails(details: string): string | undefined {
  const normalized = details
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();

  if (!normalized || normalized.startsWith('<')) {
    return undefined;
  }

  return normalized.length > UPSTREAM_CHAT_ERROR_DETAILS_MAX_LENGTH
    ? `${normalized.slice(0, UPSTREAM_CHAT_ERROR_DETAILS_MAX_LENGTH - 1)}…`
    : normalized;
}

async function readUpstreamErrorDetails(
  response: Response,
  maxBytes = UPSTREAM_CHAT_ERROR_DETAILS_MAX_LENGTH + 1
): Promise<string> {
  if (!response.body) {
    return '';
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytesRead = 0;
  let reachedLimit = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }

      const remaining = maxBytes - bytesRead;
      if (remaining <= 0) {
        reachedLimit = true;
        break;
      }

      const chunk = value.byteLength > remaining
        ? value.slice(0, remaining)
        : value;
      bytesRead += chunk.byteLength;
      chunks.push(decoder.decode(chunk, { stream: true }));

      if (value.byteLength >= remaining) {
        reachedLimit = true;
        break;
      }
    }

    chunks.push(decoder.decode());
    return chunks.join('');
  } finally {
    if (reachedLimit) {
      await reader.cancel().catch(() => undefined);
    }
    reader.releaseLock();
  }
}

function getUpstreamChatErrorMessage(
  statusCode: number,
  details: string,
  deploymentName: string
): string {
  const status = parseJsonObject(details);
  const statusMessage = getNestedStringValue(status, ['message']);
  const openAiErrorMessage = getNestedStringValue(status, ['error', 'message']);
  const detailMessage = getNestedStringValue(status, ['detail']);
  const reason = getNestedStringValue(status, ['reason']);
  const detailObject = status?.details && typeof status.details === 'object'
    ? status.details as Record<string, unknown>
    : undefined;
  const kind = getNestedStringValue(detailObject, ['kind']);

  if (statusCode === 404 && reason === 'NotFound' && kind === 'services') {
    return `The model endpoint for '${deploymentName}' is not available yet. The deployment may still be starting, or its endpoint may have changed. Try again in a moment or check the logs.`;
  }

  const parsedMessage = openAiErrorMessage || statusMessage || detailMessage;
  if (parsedMessage) {
    return truncateErrorMessage(parsedMessage);
  }

  const plainDetails = details.trim();
  if (plainDetails && !plainDetails.startsWith('<')) {
    return truncateErrorMessage(plainDetails);
  }

  return `The model did not accept the chat request (HTTP ${statusCode}). Try again in a moment.`;
}

function isMissingServiceProxyResponse(statusCode: number, details: string): boolean {
  const status = parseJsonObject(details);
  const reason = typeof status?.reason === 'string' ? status.reason : undefined;
  const detailObject = status?.details && typeof status.details === 'object'
    ? status.details as Record<string, unknown>
    : undefined;
  const kind = typeof detailObject?.kind === 'string' ? detailObject.kind : undefined;

  return statusCode === 404 && reason === 'NotFound' && kind === 'services';
}

function buildGatewayChatUrl(endpoint: string): string {
  const withScheme = endpoint.includes('://') ? endpoint : `http://${endpoint}`;
  const baseUrl = new URL(withScheme);
  const normalizedPath = baseUrl.pathname.replace(/\/+$/, '');
  baseUrl.pathname = normalizedPath.endsWith('/v1')
    ? `${normalizedPath}/chat/completions`
    : `${normalizedPath}/v1/chat/completions`;
  baseUrl.search = '';
  baseUrl.hash = '';
  return baseUrl.toString();
}

async function proxyGatewayChatPostStream(
  endpoint: string,
  body: unknown,
  modelName: string,
  signal?: AbortSignal
): Promise<Response> {
  return fetch(buildGatewayChatUrl(endpoint), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
      'X-Gateway-Model-Name': modelName,
    },
    body: JSON.stringify(body),
    signal,
  });
}

function extractFirstModelId(modelsResponse: unknown): string | undefined {
  if (!modelsResponse || typeof modelsResponse !== 'object') {
    return undefined;
  }

  const data = (modelsResponse as { data?: unknown }).data;
  if (!Array.isArray(data) || data.length === 0) {
    return undefined;
  }

  const firstModel = data[0];
  if (!firstModel || typeof firstModel !== 'object') {
    return undefined;
  }

  const id = (firstModel as { id?: unknown }).id;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

function isKaitoLlamaCppDeployment(deployment: DeploymentStatus): boolean {
  return deployment.provider === 'kaito' && deployment.engine === 'llamacpp';
}

// Returns the name the underlying model server is serving on its /v1/* API,
// or undefined when we should ask the server (or fall back to modelId).
// Excludes deployment.gateway.modelName on purpose — that's the HTTPRoute alias
// used by the gateway and is unrelated to what the frontend service responds to.
function getServedChatModelName(deployment: DeploymentStatus): string | undefined {
  if (deployment.servedModelName && !isKaitoLlamaCppDeployment(deployment)) {
    return deployment.servedModelName;
  }
  return undefined;
}

function createRequestScopedTimeoutSignal(
  requestSignal: AbortSignal,
  timeoutMs: number
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const abort = () => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
  };

  if (requestSignal.aborted) {
    abort();
  } else {
    requestSignal.addEventListener('abort', abort, { once: true });
    timeout = setTimeout(abort, timeoutMs);

    if (requestSignal.aborted) {
      abort();
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      if (timeout) {
        clearTimeout(timeout);
      }
      requestSignal.removeEventListener('abort', abort);
    },
  };
}

async function discoverUpstreamChatModel(
  deployment: DeploymentStatus,
  serviceName: string,
  namespace: string,
  servicePort: number,
  requestSignal: AbortSignal,
  userToken?: string
): Promise<string | undefined> {
  const scopedSignal = createRequestScopedTimeoutSignal(
    requestSignal,
    CHAT_MODEL_DISCOVERY_TIMEOUT_MS
  );

  try {
    const modelsText = await kubernetesService.proxyServiceGet(
      serviceName,
      namespace,
      servicePort,
      'v1/models',
      { accept: CHAT_MODEL_DISCOVERY_ACCEPT_HEADER, signal: scopedSignal.signal, userToken }
    );
    return extractFirstModelId(JSON.parse(modelsText));
  } catch (error) {
    logger.debug(
      { error, deploymentName: deployment.name, namespace, serviceName, servicePort },
      'Could not resolve model from upstream /v1/models; falling back to deployment model ID'
    );
    return undefined;
  } finally {
    scopedSignal.cleanup();
  }
}

async function resolveServedChatModel(
  deployment: DeploymentStatus,
  serviceName: string,
  namespace: string,
  servicePort: number,
  requestSignal: AbortSignal,
  userToken?: string
): Promise<string> {
  const served = getServedChatModelName(deployment);
  if (served) {
    return served;
  }

  return (await discoverUpstreamChatModel(
    deployment,
    serviceName,
    namespace,
    servicePort,
    requestSignal,
    userToken
  )) || deployment.modelId;
}

async function resolveDirectChatModel(
  deployment: DeploymentStatus,
  serviceName: string,
  namespace: string,
  servicePort: number,
  requestSignal: AbortSignal,
  userToken?: string,
  requestedModel?: string
): Promise<string> {
  if (requestedModel) {
    return requestedModel;
  }

  // Direct service-proxy path: ignore deployment.gateway.modelName (that's the
  // HTTPRoute alias the gateway routes by; the frontend service doesn't know it
  // and would return a model-not-found error).
  return resolveServedChatModel(
    deployment,
    serviceName,
    namespace,
    servicePort,
    requestSignal,
    userToken
  );
}

async function resolveGatewayChatModel(
  deployment: DeploymentStatus,
  serviceName: string,
  namespace: string,
  servicePort: number,
  requestSignal: AbortSignal,
  userToken?: string
): Promise<string> {
  // Gateway path: the HTTPRoute alias is exactly what the gateway routes by.
  if (deployment.gateway?.modelName) {
    return deployment.gateway.modelName;
  }

  return resolveServedChatModel(
    deployment,
    serviceName,
    namespace,
    servicePort,
    requestSignal,
    userToken
  );
}

function jsonChatErrorResponse(
  message: string,
  statusCode: ContentfulStatusCode,
  details?: string
): Response {
  return new Response(
    JSON.stringify({
      error: {
        message,
        statusCode,
        ...(details ? { details } : {}),
      },
    }),
    {
      status: statusCode,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

function streamChatResponse(body: ReadableStream<Uint8Array>): Response {
  return new Response(body, {
    status: 200,
    headers: CHAT_STREAM_HEADERS,
  });
}

function upstreamChatErrorResponse(
  upstreamResponse: Response,
  details: string,
  deploymentName: string
): Response {
  const statusCode = toUpstreamChatErrorStatusCode(upstreamResponse.status);
  const sanitizedDetails = sanitizeUpstreamErrorDetails(details);

  return jsonChatErrorResponse(
    getUpstreamChatErrorMessage(upstreamResponse.status, details, deploymentName),
    statusCode,
    sanitizedDetails
  );
}

export async function createDeploymentChatResponse({
  deploymentName,
  namespace,
  body,
  requestSignal,
  userToken,
}: DeploymentChatRequest): Promise<Response> {
  const resolvedNamespace = namespace || (await configService.getDefaultNamespace());

  const deployment = await kubernetesService.getDeployment(deploymentName, resolvedNamespace, userToken);
  if (!deployment) {
    throw new HTTPException(404, { message: 'Deployment not found' });
  }

  if (deployment.phase !== 'Running') {
    throw new HTTPException(409, {
      message: `Deployment '${deploymentName}' is not running (current phase: ${deployment.phase})`,
    });
  }

  const frontendService = parseFrontendService(deployment.frontendService);
  if (!frontendService?.serviceName) {
    throw new HTTPException(409, {
      message: `Deployment '${deploymentName}' does not expose a frontend service for chat`,
    });
  }

  const frontendServicePort = frontendService.servicePort || DEFAULT_FRONTEND_SERVICE_PORT;

  const directModel = await resolveDirectChatModel(
    deployment,
    frontendService.serviceName,
    resolvedNamespace,
    frontendServicePort,
    requestSignal,
    userToken,
    body.model
  );

  const upstreamResponse = await kubernetesService.proxyServicePostStream(
    frontendService.serviceName,
    resolvedNamespace,
    frontendServicePort,
    'v1/chat/completions',
    {
      ...body,
      model: directModel,
      stream: true,
    },
    {},
    { signal: requestSignal, userToken }
  );

  if (!upstreamResponse.ok) {
    const details = await readUpstreamErrorDetails(upstreamResponse);

    if (deployment.gateway?.endpoint && isMissingServiceProxyResponse(upstreamResponse.status, details)) {
      const gatewayModel = await resolveGatewayChatModel(
        deployment,
        frontendService.serviceName,
        resolvedNamespace,
        frontendServicePort,
        requestSignal,
        userToken
      );
      const gatewayResponse = await proxyGatewayChatPostStream(
        deployment.gateway.endpoint,
        {
          ...body,
          model: gatewayModel,
          stream: true,
        },
        gatewayModel,
        requestSignal
      );

      if (gatewayResponse.ok) {
        if (!gatewayResponse.body) {
          return jsonChatErrorResponse('Gateway chat response did not include a stream body', 502);
        }

        return streamChatResponse(gatewayResponse.body);
      }

      const gatewayDetails = await readUpstreamErrorDetails(gatewayResponse);
      return upstreamChatErrorResponse(gatewayResponse, gatewayDetails, deploymentName);
    }

    return upstreamChatErrorResponse(upstreamResponse, details, deploymentName);
  }

  if (!upstreamResponse.body) {
    return jsonChatErrorResponse('Upstream chat completion response did not include a stream body', 502);
  }

  return streamChatResponse(upstreamResponse.body);
}
