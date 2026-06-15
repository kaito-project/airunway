import { describe, expect, test } from 'bun:test';
import type * as k8s from '@kubernetes/client-node';
import type { BunTlsOptions } from '../lib/kubeconfig';

import {
  proxyServiceGet,
  proxyServicePostStream,
  type ServiceProxyAdapter,
} from './serviceProxy';

function fakeKubeConfig(authHeader: string): k8s.KubeConfig {
  return {
    getCurrentCluster: () => ({ server: 'https://cluster.example', skipTLSVerify: false }),
    applyToFetchOptions: async (requestOptions: { headers?: Record<string, string> }) => ({
      ...requestOptions,
      headers: {
        ...(requestOptions.headers ?? {}),
        Authorization: authHeader,
      },
    }),
    applyToHTTPSOptions: async () => undefined,
  } as unknown as k8s.KubeConfig;
}

describe('serviceProxy Module', () => {
  test('uses caller token kubeconfig and strips userToken before fetch for GET and streaming POST', async () => {
    const userTokens: Array<string | undefined> = [];
    const fetchCalls: Array<{ url: string; init: RequestInit & { tls?: BunTlsOptions; userToken?: string } }> = [];
    const adapter: ServiceProxyAdapter = {
      getKubeConfig: (userToken) => {
        userTokens.push(userToken);
        return fakeKubeConfig(`Bearer ${userToken ?? 'service-account'}`);
      },
      fetch: async (input, init) => {
        fetchCalls.push({ url: String(input), init: init as RequestInit & { tls?: BunTlsOptions; userToken?: string } });
        return new Response(fetchCalls.length === 1 ? 'models' : 'stream', {
          status: 200,
          statusText: 'OK',
        });
      },
    };

    const getBody = await proxyServiceGet(
      adapter,
      'model-svc',
      'tenant-ns',
      8000,
      'v1/models',
      { accept: 'application/json', userToken: 'user-token' },
    );
    const postResponse = await proxyServicePostStream(
      adapter,
      'model-svc',
      'tenant-ns',
      8000,
      'v1/chat/completions',
      { messages: [{ role: 'user', content: 'Hello' }] },
      { 'X-Trace-Id': 'trace-1' },
      { userToken: 'user-token' },
    );

    expect(getBody).toBe('models');
    expect(await postResponse.text()).toBe('stream');
    expect(userTokens).toEqual(['user-token', 'user-token']);
    expect(fetchCalls.map((call) => call.url)).toEqual([
      'https://cluster.example/api/v1/namespaces/tenant-ns/services/model-svc:8000/proxy/v1/models',
      'https://cluster.example/api/v1/namespaces/tenant-ns/services/model-svc:8000/proxy/v1/chat/completions',
    ]);

    const getHeaders = new Headers(fetchCalls[0].init.headers);
    expect(fetchCalls[0].init.method).toBe('GET');
    expect(getHeaders.get('authorization')).toBe('Bearer user-token');
    expect(getHeaders.get('accept')).toBe('application/json');
    expect(fetchCalls[0].init.userToken).toBeUndefined();

    const postHeaders = new Headers(fetchCalls[1].init.headers);
    expect(fetchCalls[1].init.method).toBe('POST');
    expect(postHeaders.get('authorization')).toBe('Bearer user-token');
    expect(postHeaders.get('accept')).toBe('text/event-stream');
    expect(postHeaders.get('content-type')).toBe('application/json');
    expect(postHeaders.get('x-trace-id')).toBe('trace-1');
    expect(fetchCalls[1].init.body).toBe(JSON.stringify({
      messages: [{ role: 'user', content: 'Hello' }],
    }));
    expect(fetchCalls[1].init.userToken).toBeUndefined();
  });

  test('throws readable errors for non-OK proxied GET responses', async () => {
    const adapter: ServiceProxyAdapter = {
      getKubeConfig: () => fakeKubeConfig('Bearer service-account'),
      fetch: async () => new Response('nope', { status: 503, statusText: 'Service Unavailable' }),
    };

    await expect(proxyServiceGet(adapter, 'svc', 'ns', 80, 'metrics')).rejects.toThrow(
      'HTTP 503: Service Unavailable'
    );
  });
});
