import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { apiClient } from '../../src/services/api-client';
import { authStorage } from '../../src/services/auth-storage';

describe('ApiClient', () => {
  it.each([503, 'network'])('preserves credentials after a temporary refresh failure (%s)', async failure => {
    authStorage.setStoredTokens({accessToken:'old',refreshToken:'valid'});
    vi.stubGlobal('fetch', vi.fn(async url => {
      if (url === '/api/auth/refresh') {
        if (failure === 'network') throw new TypeError('Failed to fetch');
        return new Response('{}', {status:503});
      }
      return new Response('{}', {status:401});
    }));
    await expect(apiClient.getMe()).rejects.toThrow();
    expect(authStorage.getStoredTokens()).toMatchObject({accessToken:'old',refreshToken:'valid'});
  });
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    { service: 'slack', allowedScope: ['C01', 'C02'] },
    { service: 'jira', allowedScope: { projects: ['ATI'], issueTypes: ['Task'] } },
  ])('saves $service scope with an authenticated PUT containing only allowedScope', async ({ service, allowedScope }) => {
    authStorage.setStoredTokens({ accessToken: 'scope_access', refreshToken: 'scope_refresh' });
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(`/api/services/${service}/scope`);
      expect(init?.method).toBe('PUT');
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer scope_access');
      expect(headers.get('Content-Type')).toBe('application/json');
      expect(JSON.parse(init?.body as string)).toEqual({ allowedScope });
      return new Response(JSON.stringify({ success: true, message: 'Scope saved' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiClient.saveServiceScope(service, allowedScope)).resolves.toEqual({
      success: true, message: 'Scope saved',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('encodes the service as one scope endpoint path segment', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe('/api/services/slack%2Fteam%3Fother%3D1/scope');
      return new Response(JSON.stringify({ success: true, message: 'Scope saved' }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiClient.saveServiceScope('slack/team?other=1', ['C01'])).resolves.toMatchObject({ success: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    { status: 403, data: { error: 'Admin access required' } },
    { status: 409, data: { error: 'Service credentials missing' } },
  ])('preserves HTTP $status scope save errors without refreshing or clearing the session', async ({ status, data }) => {
    authStorage.setStoredTokens({ accessToken: 'scope_access', refreshToken: 'scope_refresh' });
    const response = new Response(JSON.stringify(data), {
      status, headers: { 'Content-Type': 'application/json' },
    });
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe('/api/services/slack/scope');
      return response;
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiClient.saveServiceScope('slack', ['C01'])).rejects.toMatchObject({
      message: data.error, status, data, response,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(authStorage.getStoredTokens()).toMatchObject({ accessToken: 'scope_access', refreshToken: 'scope_refresh' });
  });

  it('refreshes an expired scope save session once and retries the same scope body', async () => {
    authStorage.setStoredTokens({ accessToken: 'scope_expired', refreshToken: 'scope_refresh' });
    let scopeAttempts = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/auth/refresh') {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(init?.body as string)).toEqual({ refreshToken: 'scope_refresh' });
        return new Response(JSON.stringify({ accessToken: 'scope_fresh', refreshToken: 'scope_rotated' }), { status: 200 });
      }
      expect(url).toBe('/api/services/slack/scope');
      expect(init?.method).toBe('PUT');
      expect(JSON.parse(init?.body as string)).toEqual({ allowedScope: ['C01'] });
      scopeAttempts++;
      expect(new Headers(init?.headers).get('Authorization')).toBe(
        scopeAttempts === 1 ? 'Bearer scope_expired' : 'Bearer scope_fresh',
      );
      return scopeAttempts === 1
        ? new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
        : new Response(JSON.stringify({ success: true, message: 'Scope saved' }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiClient.saveServiceScope('slack', ['C01'])).resolves.toEqual({ success: true, message: 'Scope saved' });
    expect(scopeAttempts).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(authStorage.getStoredTokens()).toMatchObject({ accessToken: 'scope_fresh', refreshToken: 'scope_rotated' });
  });

  it('rejects a scope save response belonging to a previous login session', async () => {
    authStorage.setStoredTokens({ accessToken: 'scope_old', refreshToken: 'scope_old_refresh' });
    const fetchMock = vi.fn(async () => {
      authStorage.setStoredTokens({ accessToken: 'scope_new', refreshToken: 'scope_new_refresh' });
      return new Response(JSON.stringify({ success: true, message: 'Scope saved' }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiClient.saveServiceScope('slack', ['C01'])).rejects.toThrow('Phiên đăng nhập đã thay đổi.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(authStorage.getStoredTokens()).toMatchObject({ accessToken: 'scope_new', refreshToken: 'scope_new_refresh' });
  });

  it('performs login, saves tokens into authStorage, and returns data', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('/api/auth/login');
      expect(init?.method).toBe('POST');
      expect(JSON.parse(init?.body as string)).toEqual({
        email: 'user@test.com',
        password: 'password123',
      });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          accessToken: 'jwt_access',
          refreshToken: 'jwt_refresh',
          user: { id: 'u1', email: 'user@test.com', name: 'Tester' },
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await apiClient.login('user@test.com', 'password123');
    expect(result.accessToken).toBe('jwt_access');
    expect(authStorage.getStoredTokens().accessToken).toBe('jwt_access');
    expect(authStorage.getStoredTokens().refreshToken).toBe('jwt_refresh');
    expect(authStorage.getStoredTokens().user?.email).toBe('user@test.com');
  });

  it('automatically attaches Authorization Bearer header when token is stored', async () => {
    authStorage.setStoredTokens({ accessToken: 'test_token_123' });

    let capturedHeaders: Headers | undefined;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedHeaders = new Headers(init?.headers);
      return {
        ok: true,
        status: 200,
        json: async () => ({ conversations: [] }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    await apiClient.getConversations();
    expect(capturedHeaders?.get('Authorization')).toBe('Bearer test_token_123');
  });

  it('intercepts 401, refreshes token, and retries original request once', async () => {
    authStorage.setStoredTokens({
      accessToken: 'old_expired_token',
      refreshToken: 'valid_refresh_token',
    });

    let attemptCount = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/conversations') {
        attemptCount++;
        const auth = new Headers(init?.headers).get('Authorization');
        if (attemptCount === 1) {
          expect(auth).toBe('Bearer old_expired_token');
          return { ok: false, status: 401, json: async () => ({ error: 'Unauthorized' }) };
        }
        expect(auth).toBe('Bearer new_fresh_token');
        return {
          ok: true,
          status: 200,
          json: async () => ({ conversations: [{ id: 'c1', title: 'Conv 1', updatedAt: '2026-10-01' }] }),
        };
      }

      if (url === '/api/auth/refresh') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            accessToken: 'new_fresh_token',
            refreshToken: 'new_refresh_token',
          }),
        };
      }

      throw new Error(`Unexpected url: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await apiClient.getConversations();
    expect(result.conversations).toHaveLength(1);
    expect(attemptCount).toBe(2);
    expect(authStorage.getStoredTokens().accessToken).toBe('new_fresh_token');
  });

  it('clears stored tokens and throws when 401 refresh fails', async () => {
    authStorage.setStoredTokens({
      accessToken: 'expired_token',
      refreshToken: 'bad_refresh_token',
    });

    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/conversations') {
        return { ok: false, status: 401, json: async () => ({ error: 'Token expired' }) };
      }
      if (url === '/api/auth/refresh') {
        return { ok: false, status: 401, json: async () => ({ error: 'Invalid refresh token' }) };
      }
      throw new Error(`Unexpected url: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiClient.getConversations()).rejects.toThrow();
    expect(authStorage.getStoredTokens().accessToken).toBeNull();
    expect(authStorage.getStoredTokens().refreshToken).toBeNull();
  });

  it('returns null for getActivePlan when receiving 404', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({ error: 'No active plan found' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const plan = await apiClient.getActivePlan('conv-nonexistent');
    expect(plan).toBeNull();
  });

  it('calls approval, rejection, and execution control endpoints properly', async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url === '/api/plans/p1/approve') {
        return { ok: true, status: 200, json: async () => ({ status: 'approved' }) };
      }
      if (url === '/api/plans/p1/reject') {
        return { ok: true, status: 200, json: async () => ({ success: true }) };
      }
      if (url === '/api/executions/p1/steps/s1/retry') {
        return { ok: true, status: 200, json: async () => ({ success: true }) };
      }
      if (url === '/api/executions/p1/steps/s1/skip') {
        return { ok: true, status: 200, json: async () => ({ success: true }) };
      }
      if (url === '/api/executions/p1/stop') {
        return { ok: true, status: 200, json: async () => ({ success: true }) };
      }
      throw new Error(`Unexpected url: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiClient.approvePlan('p1')).resolves.toEqual({ status: 'approved' });
    await expect(apiClient.rejectPlan('p1')).resolves.toEqual({ success: true });
    await expect(apiClient.retryStep('p1', 's1')).resolves.toEqual({ success: true });
    await expect(apiClient.skipStep('p1', 's1')).resolves.toEqual({ success: true });
    await expect(apiClient.stopExecution('p1')).resolves.toEqual({ success: true });
  });

  it('clears stored tokens and throws when retried request also receives 401', async () => {
    authStorage.setStoredTokens({
      accessToken: 'old_token',
      refreshToken: 'valid_refresh',
    });

    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/conversations') {
        return { ok: false, status: 401, json: async () => ({ error: 'Unauthorized' }) };
      }
      if (url === '/api/auth/refresh') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ accessToken: 'new_token', refreshToken: 'valid_refresh' }),
        };
      }
      throw new Error(`Unexpected url: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiClient.getConversations()).rejects.toThrow();
    expect(authStorage.getStoredTokens().accessToken).toBeNull();
    expect(authStorage.getStoredTokens().refreshToken).toBeNull();
  });

  it('deduplicates concurrent refresh token calls', async () => {
    authStorage.setStoredTokens({
      accessToken: 'stale_token',
      refreshToken: 'good_refresh',
    });

    let refreshCalls = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/auth/refresh') {
        refreshCalls++;
        await new Promise((r) => setTimeout(r, 20));
        return {
          ok: true,
          status: 200,
          json: async () => ({ accessToken: 'brand_new_token' }),
        };
      }
      if (url === '/api/conversations' || url === '/api/auth/me') {
        const auth = (authStorage.getStoredTokens().accessToken);
        if (auth === 'stale_token') {
          return { ok: false, status: 401, json: async () => ({ error: 'Unauthorized' }) };
        }
        return { ok: true, status: 200, json: async () => ({ success: true }) };
      }
      throw new Error(`Unexpected url: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const [res1, res2] = await Promise.all([
      apiClient.getConversations(),
      apiClient.getMe(),
    ]);

    expect(refreshCalls).toBe(1);
    expect(res1).toBeDefined();
    expect(res2).toBeDefined();
  });

  it('overwrites any existing Authorization header with new accessToken on retry', async () => {
    authStorage.setStoredTokens({
      accessToken: 'token_attempt_1',
      refreshToken: 'valid_refresh',
    });

    let sentHeaders: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/auth/refresh') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ accessToken: 'token_attempt_2' }),
        };
      }
      const auth = new Headers(init?.headers).get('Authorization') || '';
      sentHeaders.push(auth);
      if (sentHeaders.length === 1) {
        return { ok: false, status: 401, json: async () => ({ error: 'Unauthorized' }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    await apiClient.requestRaw('/api/test-custom', {
      headers: { Authorization: 'Bearer token_attempt_1' },
    });

    expect(sentHeaders).toEqual(['Bearer token_attempt_1', 'Bearer token_attempt_2']);
  });
});
