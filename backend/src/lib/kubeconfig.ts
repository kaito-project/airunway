import * as k8s from '@kubernetes/client-node';
import logger from './logger';

/**
 * Load a KubeConfig from the default location.
 *
 * When AUTH_ENABLED=true, client certificates are stripped from the current
 * user BEFORE any API client is created.  This is critical because Bun shares
 * TLS sessions process-wide: if *any* HTTP client establishes a connection
 * with admin client certificates, all subsequent requests to the same K8s API
 * server (including native `fetch`) inherit that TLS identity, causing the API
 * server to authenticate them as admin and ignore Bearer tokens.
 */
export function loadKubeConfig(): k8s.KubeConfig {
  const kc = new k8s.KubeConfig();

  try {
    kc.loadFromDefault();
  } catch {
    logger.warn('No kubeconfig found, using mock mode');
  }

  if (process.env.AUTH_ENABLED?.toLowerCase() === 'true' || process.env.AUTH_ENABLED === '1') {
    const currentUser = kc.getCurrentUser();
    if (currentUser) {
      (currentUser as any).certData = undefined;
      (currentUser as any).certFile = undefined;
      (currentUser as any).keyData = undefined;
      (currentUser as any).keyFile = undefined;
      logger.debug('Stripped client certificates from kubeconfig (AUTH_ENABLED)');
    }
  }

  return kc;
}

/**
 * Bun-compatible HTTP library for `@kubernetes/client-node`.
 *
 * WHY THIS EXISTS:
 * The client's default `IsomorphicFetchHttpLibrary` imports `node-fetch` and
 * passes the kubeconfig CA (and client cert/key) as a Node.js `https.Agent`
 * (`request.getAgent()`). Bun's runtime resolves `node-fetch` to its native
 * `fetch`, which **ignores** the Node `https.Agent` entirely — it only honours
 * TLS material supplied via the per-request `tls` option. The CA therefore never
 * reaches the TLS stack, so every request to a cluster whose API server uses a
 * private CA (e.g. AKS) fails with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`.
 *
 * This subclass overrides `send()` to call Bun's native `fetch` directly,
 * translating the kubeconfig's TLS material into the `tls` option Bun
 * understands. Auth headers (Bearer tokens, etc.) are still applied by the
 * generated client via `authMethods` before `send()` runs, so we only need to
 * re-inject the TLS material here. It mirrors the working pattern already used
 * by `proxyServiceRequest` in `kubernetes.ts`.
 *
 * The response is wrapped exactly as the upstream library does: an `Observable`
 * constructed from a `Promise<ResponseContext>` (see `rxjsStub`), with a
 * `ResponseBody` exposing `text()` and `binary()`.
 */
export class BunTlsHttpLibrary extends k8s.IsomorphicFetchHttpLibrary {
  constructor(private readonly kc: k8s.KubeConfig) {
    super();
  }

  send(request: k8s.RequestContext): k8s.Observable<k8s.ResponseContext> {
    const responsePromise = (async (): Promise<k8s.ResponseContext> => {
      // Extract TLS material (CA, client cert/key, verification mode) from the
      // kubeconfig the same way the SDK's Node path would, then hand it to Bun
      // via the `tls` option instead of a Node https.Agent.
      const httpsOptions: {
        ca?: Buffer;
        cert?: Buffer;
        key?: Buffer;
        rejectUnauthorized?: boolean;
      } = {};
      await this.kc.applyToHTTPSOptions(httpsOptions as any);

      const tls: Record<string, unknown> = {};
      if (httpsOptions.ca) tls.ca = httpsOptions.ca;
      if (httpsOptions.cert) tls.cert = httpsOptions.cert;
      if (httpsOptions.key) tls.key = httpsOptions.key;
      if (this.kc.getCurrentCluster()?.skipTLSVerify || httpsOptions.rejectUnauthorized === false) {
        tls.rejectUnauthorized = false;
      }

      const fetchOptions: RequestInit & { tls?: Record<string, unknown> } = {
        method: request.getHttpMethod().toString(),
        body: request.getBody() as BodyInit | undefined,
        headers: request.getHeaders(),
        signal: request.getSignal(),
      };
      if (Object.keys(tls).length > 0) {
        fetchOptions.tls = tls;
      }

      const response = await fetch(request.getUrl(), fetchOptions);

      const headers: Record<string, string> = {};
      response.headers.forEach((value, name) => {
        headers[name] = value;
      });

      return new k8s.ResponseContext(response.status, headers, {
        text: () => response.text(),
        binary: async () => Buffer.from(await response.arrayBuffer()),
      });
    })();

    return new k8s.Observable<k8s.ResponseContext>(responsePromise);
  }
}

/**
 * Build a Kubernetes API client that works under Bun.
 *
 * Drop-in replacement for `kc.makeApiClient(ApiClass)`. It reproduces the SDK's
 * own `makeApiClient` wiring (`createConfiguration` with the kubeconfig as the
 * `default` auth method and a `ServerConfiguration` for the current cluster) but
 * swaps in {@link BunTlsHttpLibrary} so the kubeconfig CA is honoured on Bun's
 * native `fetch`.
 *
 * All backend services must construct their clients through this helper rather
 * than calling `kc.makeApiClient(...)` directly; otherwise requests to clusters
 * with a private CA fail with `UNABLE_TO_VERIFY_LEAF_SIGNATURE` under Bun.
 */
export function makeApiClient<T extends k8s.ApiType>(
  kc: k8s.KubeConfig,
  apiClientType: k8s.ApiConstructor<T>
): T {
  const cluster = kc.getCurrentCluster();
  if (!cluster) {
    throw new Error('No active cluster!');
  }

  const configuration = k8s.createConfiguration({
    baseServer: new k8s.ServerConfiguration(cluster.server, {}),
    authMethods: { default: kc },
    httpApi: new BunTlsHttpLibrary(kc),
  });

  return new apiClientType(configuration);
}
