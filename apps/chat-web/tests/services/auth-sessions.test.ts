import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../src/services/api-client';
import { authStorage } from '../../src/services/auth-storage';
import { userErrorMessage } from '../../src/services/user-error';

const client = new ApiClient();
beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
afterEach(() => vi.unstubAllGlobals());
describe('AUTH-01 browser session client', () => {
  it('adopts another tab token pair on REFRESH_ROTATED and retries with that access token', async () => {
    authStorage.setStoredTokens({ accessToken: 'expired', refreshToken: 'old' });
    const requests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      if (url === '/api/auth/refresh') {
        localStorage.setItem('wap_access_token', 'other-tab-access');
        localStorage.setItem('wap_refresh_token', 'other-tab-refresh');
        return new Response(JSON.stringify({ code: 'REFRESH_ROTATED' }), { status: 409 });
      }
      const token = new Headers(init?.headers).get('Authorization')!; requests.push(token);
      return new Response(JSON.stringify({ user: { id: 'owner' } }), { status: token === 'Bearer expired' ? 401 : 200 });
    }));
    await expect(client.getMe()).resolves.toMatchObject({ user: { id: 'owner' } });
    expect(requests).toEqual(['Bearer expired', 'Bearer other-tab-access']);
    expect(authStorage.getStoredTokens().refreshToken).toBe('other-tab-refresh');
  });
  it('requires a changed refresh token, even if access JWT is identical within one second', async () => {
    authStorage.setStoredTokens({ accessToken: 'same-access', refreshToken: 'old' });
    vi.stubGlobal('fetch', vi.fn(async () => {
      localStorage.setItem('wap_refresh_token', 'new');
      return new Response(JSON.stringify({ code: 'REFRESH_ROTATED' }), { status: 409 });
    }));
    await expect(client.refreshToken()).resolves.toMatchObject({ accessToken: 'same-access', refreshToken: 'new' });
  });
  it('clears the local session on REFRESH_ROTATED with no replacement pair', async () => {
    authStorage.setStoredTokens({ accessToken: 'expired', refreshToken: 'old' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 'REFRESH_ROTATED' }), { status: 409 })));
    await expect(client.refreshToken()).rejects.toMatchObject({ status: 401 });
    expect(authStorage.getStoredTokens().accessToken).toBeNull();
    expect(authStorage.getStoredTokens().refreshToken).toBeNull();
  });
  it.each(['logout', 'logoutAll'] as const)('refreshes expired access before %s so server revocation still occurs', async method => {
    authStorage.setStoredTokens({ accessToken: 'expired', refreshToken: 'valid' });
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      calls.push(url);
      if (url === '/api/auth/refresh') return new Response(JSON.stringify({ accessToken: 'fresh', refreshToken: 'rotated' }), { status: 200 });
      expect(init?.method).toBe('POST');
      return new Response(JSON.stringify({ success: true }), { status: new Headers(init?.headers).get('Authorization') === 'Bearer expired' ? 401 : 200 });
    }));
    await expect(client[method]()).resolves.toEqual({ success: true });
    const endpoint = method === 'logout' ? '/api/auth/logout' : '/api/auth/logout-all';
    expect(calls).toEqual([endpoint, '/api/auth/refresh', endpoint]);
  });
  it('reads public authentication flags without sending a stored bearer token', async () => {
    authStorage.setStoredTokens({ accessToken: 'private' });
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      expect(url).toBe('/api/auth/config'); expect(new Headers(init?.headers).has('Authorization')).toBe(false);
      return new Response(JSON.stringify({ signupEnabled: false, googleEnabled: false }));
    }));
    await expect(client.getAuthConfig()).resolves.toEqual({ signupEnabled: false, googleEnabled: false });
  });
  it.each([
    ['ACCOUNT_PENDING', 'Tài khoản đang chờ quản trị viên duyệt.'],
    ['ACCOUNT_DISABLED', 'Tài khoản đã bị vô hiệu hóa. Hãy liên hệ quản trị viên.'],
  ])('shows Vietnamese account state for %s', (code, message) => {
    expect(userErrorMessage(Object.assign(new Error('Account is not active'), { data: { code }, status: 403 }))).toBe(message);
  });
});
