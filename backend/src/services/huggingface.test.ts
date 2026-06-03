import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';

// Store original fetch
const originalFetch = global.fetch;

describe('HuggingFaceService', () => {
  let mockFetch: ReturnType<typeof mock>;
  let huggingFaceService: typeof import('./huggingface').huggingFaceService;

  beforeEach(async () => {
    // Create mock fetch
    mockFetch = mock(() => Promise.resolve(new Response()));
    // @ts-expect-error - Mocking global fetch for testing
    global.fetch = mockFetch;

    // Clear module cache and re-import
    delete require.cache[require.resolve('./huggingface')];
    const module = await import('./huggingface');
    huggingFaceService = module.huggingFaceService;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('getClientId', () => {
    test('returns the configured client ID', () => {
      const clientId = huggingFaceService.getClientId();
      expect(clientId).toBeDefined();
      expect(typeof clientId).toBe('string');
      expect(clientId.length).toBeGreaterThan(0);
    });
  });

  describe('exchangeCodeForToken', () => {
    test('exchanges authorization code for token successfully', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              access_token: 'hf_test_token_123',
              expires_in: 3600,
              scope: 'openid profile read-repos',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        )
      );

      const result = await huggingFaceService.exchangeCodeForToken(
        'test_auth_code',
        'test_code_verifier_1234567890123456789012345678901234567890',
        'http://localhost:3000/oauth/callback'
      );

      expect(result.accessToken).toBe('hf_test_token_123');
      expect(result.expiresIn).toBe(3600);
      expect(result.scope).toBe('openid profile read-repos');

      // Verify fetch was called with correct parameters
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://huggingface.co/oauth/token');
      expect(options.method).toBe('POST');
      expect(options.headers).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded' });
    });

    test('throws error when token exchange fails', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(
          new Response('Invalid authorization code', { status: 400 })
        )
      );

      await expect(
        huggingFaceService.exchangeCodeForToken(
          'invalid_code',
          'test_code_verifier_1234567890123456789012345678901234567890',
          'http://localhost:3000/oauth/callback'
        )
      ).rejects.toThrow('Failed to exchange authorization code');
    });
  });

  describe('getUserInfo', () => {
    test('fetches user info successfully', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'user123',
              name: 'testuser',
              fullname: 'Test User',
              email: 'test@example.com',
              avatarUrl: 'https://huggingface.co/avatars/test.png',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        )
      );

      const userInfo = await huggingFaceService.getUserInfo('hf_test_token');

      expect(userInfo.id).toBe('user123');
      expect(userInfo.name).toBe('testuser');
      expect(userInfo.fullname).toBe('Test User');
      expect(userInfo.email).toBe('test@example.com');
      expect(userInfo.avatarUrl).toBe('https://huggingface.co/avatars/test.png');
    });

    test('handles user without optional fields', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'user123',
              name: 'testuser',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        )
      );

      const userInfo = await huggingFaceService.getUserInfo('hf_test_token');

      expect(userInfo.id).toBe('user123');
      expect(userInfo.name).toBe('testuser');
      expect(userInfo.fullname).toBe('testuser'); // Falls back to name
    });

    test('throws error when user info fetch fails', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response('Unauthorized', { status: 401 }))
      );

      await expect(huggingFaceService.getUserInfo('invalid_token')).rejects.toThrow(
        'Failed to get user info'
      );
    });
  });

  describe('validateToken', () => {
    test('returns valid result for valid token', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'user123',
              name: 'testuser',
              fullname: 'Test User',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        )
      );

      const result = await huggingFaceService.validateToken('hf_valid_token');

      expect(result.valid).toBe(true);
      expect(result.user).toBeDefined();
      expect(result.user?.name).toBe('testuser');
      expect(result.error).toBeUndefined();
    });

    test('returns invalid result for invalid token', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response('Unauthorized', { status: 401 }))
      );

      const result = await huggingFaceService.validateToken('invalid_token');

      expect(result.valid).toBe(false);
      expect(result.user).toBeUndefined();
      expect(result.error).toBeDefined();
    });
  });

  describe('handleOAuthCallback', () => {
    test('completes full OAuth flow successfully', async () => {
      let callCount = 0;
      mockFetch.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // Token exchange
          return Promise.resolve(
            new Response(
              JSON.stringify({
                access_token: 'hf_oauth_token',
                expires_in: 3600,
                scope: 'openid profile read-repos',
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            )
          );
        } else {
          // User info
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 'user123',
                name: 'testuser',
                fullname: 'Test User',
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            )
          );
        }
      });

      const result = await huggingFaceService.handleOAuthCallback(
        'auth_code',
        'code_verifier_1234567890123456789012345678901234567890',
        'http://localhost:3000/oauth/callback'
      );

      expect(result.accessToken).toBe('hf_oauth_token');
      expect(result.tokenType).toBe('Bearer');
      expect(result.expiresIn).toBe(3600);
      expect(result.user.name).toBe('testuser');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    test('throws error when token exchange fails in OAuth flow', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response('Invalid code', { status: 400 }))
      );

      await expect(
        huggingFaceService.handleOAuthCallback(
          'invalid_code',
          'code_verifier_1234567890123456789012345678901234567890',
          'http://localhost:3000/oauth/callback'
        )
      ).rejects.toThrow();
    });
  });

  describe('getModelArchitecture', () => {
    const configJson = JSON.stringify({
      num_hidden_layers: 80,
      num_attention_heads: 64,
      num_key_value_heads: 8,
      head_dim: 128,
      max_position_embeddings: 8192,
      torch_dtype: 'bfloat16',
    });

    test('parses architecture from config.json', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(configJson, { status: 200 }))
      );

      const arch = await huggingFaceService.getModelArchitecture('meta-llama/Meta-Llama-3-70B');

      expect(arch).toEqual({
        numLayers: 80,
        numKvHeads: 8,
        headDim: 128,
        maxPositionEmbeddings: 8192,
        torchDtype: 'bfloat16',
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    test('serves a cached result without re-fetching while fresh', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(configJson, { status: 200 }))
      );

      await huggingFaceService.getModelArchitecture('org/model');
      await huggingFaceService.getModelArchitecture('org/model');

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    test('drops the expired entry and re-fetches after the TTL', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response(configJson, { status: 200 }))
      );

      const realNow = Date.now;
      const base = realNow();
      try {
        // First call caches with expiresAt = base + 1h.
        Date.now = () => base;
        await huggingFaceService.getModelArchitecture('org/model');
        expect(mockFetch).toHaveBeenCalledTimes(1);

        // Advance past the 1-hour TTL: entry is expired, must re-fetch.
        Date.now = () => base + 60 * 60 * 1000 + 1;
        await huggingFaceService.getModelArchitecture('org/model');
        expect(mockFetch).toHaveBeenCalledTimes(2);
      } finally {
        Date.now = realNow;
      }
    });

    test('returns undefined on a non-ok response', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response('not found', { status: 404 }))
      );

      const arch = await huggingFaceService.getModelArchitecture('org/missing');
      expect(arch).toBeUndefined();
    });
  });
});
