import { describe, test, expect } from 'bun:test';
import { getProviderHealth } from './providerHealth';
import {
  mockKaitoCRNewShimHealthy,
  mockKaitoCROldShim,
  mockKaitoCRStale,
} from '../test/fixtures';

describe('getProviderHealth', () => {
  test('returns healthy for new-shim CR with UpstreamHealthy condition', () => {
    const h = getProviderHealth('kaito', mockKaitoCRNewShimHealthy);
    expect(h.healthy).toBe(true);
    expect(h.reason).toBe('UpstreamHealthy');
    expect(h.stale).toBe(false);
  });

  test('returns stale when heartbeat is older than threshold', () => {
    const h = getProviderHealth('kaito', mockKaitoCRStale);
    expect(h.healthy).toBe(false);
    expect(h.reason).toBe('ShimStale');
    expect(h.stale).toBe(true);
  });

  test('returns NotReady (not stale) when no heartbeat is reported', () => {
    const cr = {
      ...mockKaitoCRNewShimHealthy,
      status: { ...mockKaitoCRNewShimHealthy.status, lastHeartbeat: undefined, ready: false, conditions: [] },
    };
    const h = getProviderHealth('kaito', cr);
    expect(h.stale).toBe(false);
    expect(h.reason).toBe('NotReady');
  });

  test('falls back to ready/NotReady reason when no UpstreamReady condition', () => {
    const h = getProviderHealth('kaito', mockKaitoCROldShim);
    expect(h.healthy).toBe(true);
    expect(h.reason).toBe('Ready');
    expect(h.stale).toBe(false);
  });

  test('handles missing config gracefully (not stale, not ready)', () => {
    const h = getProviderHealth('kaito', null);
    expect(h.stale).toBe(false);
    expect(h.healthy).toBe(false);
  });
});
