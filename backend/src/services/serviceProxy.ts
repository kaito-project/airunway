import type * as https from 'node:https';
import type * as k8s from '@kubernetes/client-node';

import { kubeConfigToBunTls, type BunTlsOptions } from '../lib/kubeconfig';

export type ProxyServiceOptions = {
  signal?: AbortSignal;
  userToken?: string;
};

export type ProxyServiceGetOptions = ProxyServiceOptions & {
  accept?: string;
};

type ProxyServiceRequestInit = RequestInit & {
  userToken?: string;
};

export interface ServiceProxyAdapter {
  getKubeConfig(userToken?: string): k8s.KubeConfig;
  fetch(input: RequestInfo | URL, init?: RequestInit & { tls?: BunTlsOptions }): Promise<Response>;
}

/**
 * Proxy a GET request to a Kubernetes service through the API server.
 * This allows fetching service endpoints (e.g. /metrics) even when running off-cluster.
 * Uses raw fetch instead of the generated client to support text/plain responses.
 */
export async function proxyServiceGet(
  adapter: ServiceProxyAdapter,
  serviceName: string,
  namespace: string,
  port: number,
  path: string,
  options: ProxyServiceGetOptions = {},
): Promise<string> {
  const response = await proxyServiceRequest(adapter, serviceName, namespace, port, path, {
    method: 'GET',
    headers: {
      'Accept': options.accept ?? 'text/plain',
    },
    signal: options.signal,
    userToken: options.userToken,
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return await response.text();
}

/**
 * Proxy a POST request to a Kubernetes service and return the raw response.
 * Used for streaming OpenAI-compatible responses where the route must pipe bytes.
 */
export async function proxyServicePostStream(
  adapter: ServiceProxyAdapter,
  serviceName: string,
  namespace: string,
  port: number,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
  options: ProxyServiceOptions = {}
): Promise<Response> {
  return await proxyServiceRequest(adapter, serviceName, namespace, port, path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
      ...headers,
    },
    body: JSON.stringify(body),
    signal: options.signal,
    userToken: options.userToken,
  });
}

async function proxyServiceRequest(
  adapter: ServiceProxyAdapter,
  serviceName: string,
  namespace: string,
  port: number,
  path: string,
  init: ProxyServiceRequestInit
): Promise<Response> {
  const { userToken, ...requestInit } = init;
  const kubeConfig = adapter.getKubeConfig(userToken);
  const cluster = kubeConfig.getCurrentCluster();
  if (!cluster) {
    throw new Error('No active Kubernetes cluster configured');
  }

  // Build proxy URL: /api/v1/namespaces/{ns}/services/{name}:{port}/proxy/{path}
  const proxyUrl = `${cluster.server}/api/v1/namespaces/${encodeURIComponent(namespace)}/services/${encodeURIComponent(serviceName)}:${port}/proxy/${path}`;

  // Extract auth headers from KubeConfig
  const authOpts = await kubeConfig.applyToFetchOptions({ headers: {} } as https.RequestOptions);

  // Extract TLS material (CA, client cert/key, SNI, verification mode) via the
  // shared kubeconfig→Bun mapping, so this raw-`fetch` path and the typed-API
  // path (`BunTlsHttpLibrary`) stay in lockstep and cannot drift.
  const tlsOpts = await kubeConfigToBunTls(kubeConfig);

  const headers = new Headers((authOpts.headers as HeadersInit) || {});
  if (requestInit.headers) {
    new Headers(requestInit.headers).forEach((value, key) => headers.set(key, value));
  }

  const fetchOpts: RequestInit & { tls?: BunTlsOptions } = {
    ...requestInit,
    headers,
  };

  if (tlsOpts) {
    fetchOpts.tls = tlsOpts;
  }

  return await adapter.fetch(proxyUrl, fetchOpts);
}
