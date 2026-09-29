import { describe, it, expect, vi } from 'vitest';
import { TrelloBaseAdapter, StepError } from '../src/index.js';

describe('packages/tool-adapters (Task 4a: Trello Base Adapter & Error Normalization)', () => {
  it('injects apiKey and token query params and executes successful request', async () => {
    let capturedUrl = '';
    const mockFetch = vi.fn().mockImplementation(async (url: string | URL) => {
      capturedUrl = url.toString();
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'mem1', fullName: 'Test Member' }),
      };
    });

    const adapter = new TrelloBaseAdapter({
      credentials: { apiKey: 'my-api-key', token: 'my-token' },
      fetchFn: mockFetch as any,
    });

    const data = await adapter.request('/members/me');
    expect(data).toEqual({ id: 'mem1', fullName: 'Test Member' });
    expect(capturedUrl).toContain('key=my-api-key');
    expect(capturedUrl).toContain('token=my-token');
  });

  it('normalizes HTTP 401 and 403 to AUTH_ERROR with retryable=false', async () => {
    const mockFetch401 = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => 'invalid key',
    });

    const adapter401 = new TrelloBaseAdapter({
      credentials: { apiKey: 'bad-key', token: 'bad-token' },
      fetchFn: mockFetch401 as any,
    });

    await expect(adapter401.request('/members/me')).rejects.toMatchObject({
      category: 'AUTH_ERROR',
      statusCode: 401,
      retryable: false,
    });

    const mockFetch403 = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      text: async () => 'unauthorized permission',
    });

    const adapter403 = new TrelloBaseAdapter({
      credentials: { apiKey: 'key', token: 'token' },
      fetchFn: mockFetch403 as any,
    });

    await expect(adapter403.request('/boards/b1')).rejects.toMatchObject({
      category: 'AUTH_ERROR',
      statusCode: 403,
      retryable: false,
    });
  });

  it('normalizes HTTP 404 to NOT_FOUND', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: async () => 'The requested resource was not found',
    });

    const adapter = new TrelloBaseAdapter({
      credentials: { apiKey: 'key', token: 'token' },
      fetchFn: mockFetch as any,
    });

    await expect(adapter.request('/cards/c_nonexistent')).rejects.toMatchObject({
      category: 'NOT_FOUND',
      statusCode: 404,
      retryable: false,
    });
  });

  it('normalizes HTTP 429 to RATE_LIMIT with retryable=true', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      text: async () => 'Rate limit exceeded',
    });

    const adapter = new TrelloBaseAdapter({
      credentials: { apiKey: 'key', token: 'token' },
      fetchFn: mockFetch as any,
    });

    await expect(adapter.request('/cards/c1')).rejects.toMatchObject({
      category: 'RATE_LIMIT',
      statusCode: 429,
      retryable: true,
    });
  });

  it('normalizes HTTP 500 to SERVER_ERROR and network failure to NETWORK', async () => {
    const mockFetch500 = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => 'Server error',
    });

    const adapter500 = new TrelloBaseAdapter({
      credentials: { apiKey: 'key', token: 'token' },
      fetchFn: mockFetch500 as any,
    });

    await expect(adapter500.request('/cards/c1')).rejects.toMatchObject({
      category: 'SERVER_ERROR',
      statusCode: 500,
    });

    const mockFetchNetwork = vi.fn().mockRejectedValue(new Error('fetch failed: ECONNRESET'));
    const adapterNetwork = new TrelloBaseAdapter({
      credentials: { apiKey: 'key', token: 'token' },
      fetchFn: mockFetchNetwork as any,
    });

    await expect(adapterNetwork.request('/cards/c1')).rejects.toMatchObject({
      category: 'NETWORK',
      retryable: true,
    });
  });
});
