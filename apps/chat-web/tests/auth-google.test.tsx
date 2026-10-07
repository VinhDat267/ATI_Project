/** @vitest-environment jsdom */
import { StrictMode } from 'react';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { generateAccessToken } from '../../chat-api/src/auth/jwt';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../src/App';
import { apiClient } from '../src/services/api-client';
import { authStorage } from '../src/services/auth-storage';

const nativeFetch = globalThis.fetch;
const user = { id: 'google-user', email: 'google@example.test', name: 'Google fixture' };
let server: Server, base: string;
let googleEnabled: boolean, signupEnabled: boolean;
let calls: Array<{ path: string; body: any; authorization?: string; browserSearch: string }>;
let callbacks: ServerResponse[];
let holdMe: boolean, meResponses: ServerResponse[];
let holdRefresh: boolean, refreshResponses: ServerResponse[];
let protectedWrites: Array<{ authorization?: string; body: unknown }>;
let unauthorizedWriteToken: string;
let meHeadersArrived: number;
function reply(response: ServerResponse, body: unknown, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(body));
}
beforeEach(async () => {
  authStorage.clearStoredTokens(); googleEnabled = true; signupEnabled = true; calls = []; callbacks = []; holdMe = false; meResponses = []; holdRefresh = false; refreshResponses = []; protectedWrites = []; unauthorizedWriteToken = ''; meHeadersArrived = 0;
  window.history.replaceState({}, '', '/login');
  server = createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk;
    calls.push({ path: request.url!, body: raw ? JSON.parse(raw) : undefined, authorization: request.headers.authorization, browserSearch: window.location.search });
    if (request.url === '/api/owned-write') {
      protectedWrites.push({ authorization: request.headers.authorization, body: JSON.parse(raw) });
      return reply(response, { success: true }, request.headers.authorization === `Bearer ${unauthorizedWriteToken}` ? 401 : 200);
    }
    if (request.url === '/api/auth/config') return reply(response, { signupEnabled, googleEnabled });
    if (request.url === '/api/auth/google/callback') { callbacks.push(response); return; }
    if (request.url === '/api/auth/google/start') return reply(response, { code: 'GOOGLE_DISABLED', error: 'Không thể đăng nhập Google.' }, 503);
    if (request.url === '/api/auth/google/unlink') return reply(response, { success: true });
    if (request.url === '/api/auth/refresh') {
      if (holdRefresh) { refreshResponses.push(response); return; }
      return reply(response, { error: 'expired session' }, 401);
    }
    if (request.url === '/api/auth/me') {
      if (holdMe) { meResponses.push(response); return; }
      return reply(response, { user: authStorage.getStoredTokens().user ?? user });
    }
    if (request.url!.startsWith('/api/conversations')) return reply(response, { conversations: [] });
    if (request.url === '/api/services') return reply(response, { services: [] });
    return reply(response, { runtimeMode: 'sandbox' });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const response = await nativeFetch(new URL(url, base), init);
    if (url === '/api/auth/me') meHeadersArrived++;
    return response;
  });
});
afterEach(async () => {
  cleanup(); vi.unstubAllGlobals(); authStorage.clearStoredTokens(); window.history.replaceState({}, '', '/');
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
});
function openCallback(query = 'code=private-code&state=private-state') {
  window.history.replaceState({}, '', `/auth/google/callback?${query}`);
  return render(<StrictMode><App /></StrictMode>);
}
async function waitCallback() { await waitFor(() => expect(callbacks).toHaveLength(1)); }
async function complete(body: unknown, status = 200) {
  await waitCallback(); await act(async () => { reply(callbacks[0], body, status); await nativeFetch(`${base}/round-trip`); });
}

it.each(['/login', '/signup'])('shows enabled Google action and submits login mode on %s', async path => {
  window.history.replaceState({}, '', path); render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Tiếp tục với Google' }));
  expect(await screen.findByRole('alert')).toBeVisible();
  expect(calls.filter(call => call.path === '/api/auth/google/start').map(call => call.body)).toEqual([{ mode: 'login' }]);
});
it.each(['/login', '/signup'])('hides Google when server config disables it on %s', async path => {
  googleEnabled = false; window.history.replaceState({}, '', path); render(<App />);
  await waitFor(() => expect(calls.some(call => call.path === '/api/auth/config')).toBe(true));
  expect(screen.queryByRole('button', { name: 'Tiếp tục với Google' })).toBeNull();
});
it('keeps Google signup available when only email signup is disabled', async () => {
  signupEnabled = false; window.history.replaceState({}, '', '/signup'); render(<App />);
  expect(await screen.findByRole('button', { name: 'Tiếp tục với Google' })).toBeVisible();
  expect(screen.queryByLabelText('Mật khẩu')).toBeNull();
});
it('scrubs callback secrets before any HTTP request and consumes the state once in StrictMode', async () => {
  openCallback(); expect(window.location.search).toBe(''); await waitCallback();
  expect(calls.every(call => call.browserSearch === '')).toBe(true);
  expect(calls.filter(call => call.path === '/api/auth/google/callback').map(call => call.body)).toEqual([{ code: 'private-code', state: 'private-state' }]);
  await complete({ accessToken: 'access-google', refreshToken: 'refresh-google', user });
  await screen.findByRole('textbox', { name: /Mô tả công việc bạn muốn thực hiện|Nhập câu trả lời làm rõ yêu cầu/ });
  expect(window.location.pathname).toBe('/');
  expect(authStorage.getStoredTokens()).toEqual({ accessToken: 'access-google', refreshToken: 'refresh-google', user });
  expect(JSON.stringify(localStorage)).not.toMatch(/private-code|private-state/);
});
it('shows pending approval without storing a session or opening chat', async () => {
  openCallback(); await complete({ code: 'ACCOUNT_PENDING', error: 'pending' }, 403);
  expect(await screen.findByRole('status')).toHaveTextContent('chờ quản trị viên duyệt');
  expect(authStorage.getStoredTokens().accessToken).toBeNull();
  expect(screen.queryByRole('textbox', { name: /Mô tả công việc bạn muốn thực hiện|Nhập câu trả lời làm rõ yêu cầu/ })).toBeNull();
});
it.each(['ACCOUNT_DISABLED', 'INVALID_OAUTH_STATE', 'UNKNOWN_PRIVATE_ERROR'])('renders safe accessible error for %s without exposing provider text', async code => {
  openCallback(); await complete({ code, error: 'private-code private-state private-client-secret' }, 403);
  expect(await screen.findByRole('alert')).toBeVisible();
  expect(screen.getByRole('alert')).not.toHaveTextContent('private-');
  expect(authStorage.getStoredTokens().accessToken).toBeNull();
});
it.each(['error=access_denied&error_description=private-provider-detail&state=private-state', 'code=private-code', 'state=private-state', 'code=one&code=two&state=private-state'])('rejects missing, ambiguous or denied callback locally: %s', async query => {
  openCallback(query); expect(window.location.search).toBe('');
  expect(await screen.findByRole('alert')).toBeVisible();
  expect(calls.some(call => call.path === '/api/auth/google/callback')).toBe(false);
  expect(screen.getByRole('alert')).not.toHaveTextContent('private-');
});
it('allows an authenticated link callback and preserves the current session', async () => {
  authStorage.setStoredTokens({ accessToken: 'existing-access', refreshToken: 'existing-refresh', user });
  openCallback(); await complete({ success: true });
  expect(await screen.findByRole('status')).toHaveTextContent('liên kết');
  expect(authStorage.getStoredTokens().accessToken).toBe('existing-access');
  expect(calls.find(call => call.path === '/api/auth/google/callback')?.authorization).toBe('Bearer existing-access');
});
it.each(['logout', 'new-principal', 'unmount'])('discards a late callback after %s', async action => {
  const view = openCallback(); await waitCallback();
  act(() => {
    if (action === 'logout') authStorage.clearStoredTokens();
    else if (action === 'new-principal') authStorage.setStoredTokens({ accessToken: 'new-access', user: { ...user, id: 'new-principal' } });
    else view.unmount();
  });
  await complete({ accessToken: 'late-access', refreshToken: 'late-refresh', user });
  expect(authStorage.getStoredTokens().accessToken).toBe(action === 'new-principal' ? 'new-access' : null);
});
it('does not retry a rejected one-use callback or erase a newer principal', async () => {
  authStorage.setStoredTokens({ accessToken: 'existing', user });
  const request = apiClient.completeGoogleAuth('private-code', 'private-state'); await waitCallback();
  authStorage.setStoredTokens({ accessToken: 'newer', user: { ...user, id: 'newer' } });
  reply(callbacks[0], { code: 'INVALID_OAUTH_STATE' }, 401);
  await expect(request).rejects.toMatchObject({ status: 401, data: { code: 'INVALID_OAUTH_STATE' } });
  expect(calls.filter(call => call.path === '/api/auth/google/callback')).toHaveLength(1);
  expect(calls.some(call => call.path === '/api/auth/refresh')).toBe(false);
  expect(authStorage.getStoredTokens().accessToken).toBe('newer');
});
it('sends authenticated unlink without client identity input', async () => {
  authStorage.setStoredTokens({ accessToken: 'existing', user });
  await expect(apiClient.unlinkGoogle()).resolves.toEqual({ success: true });
  expect(calls.find(call => call.path === '/api/auth/google/unlink')).toMatchObject({ authorization: 'Bearer existing', body: {} });
});
it('does not let an older session hydration replace the Google principal', async () => {
  const oldUser = { ...user, id: 'old-user', name: 'Old user' };
  authStorage.setStoredTokens({ accessToken: 'old-access', refreshToken: 'old-refresh', user: oldUser });
  holdMe = true; openCallback(); await waitCallback(); await waitFor(() => expect(meResponses.length).toBeGreaterThan(0));
  await complete({ accessToken: 'google-access', refreshToken: 'google-refresh', user });
  await screen.findByRole('textbox', { name: /Mô tả công việc bạn muốn thực hiện|Nhập câu trả lời làm rõ yêu cầu/ });
  await act(async () => {
    for (const response of meResponses) reply(response, { user: oldUser });
    await nativeFetch(`${base}/round-trip`);
  });
  expect(authStorage.getStoredTokens().user?.id).toBe('google-user');
});
it('preserves Google login when an older session hydration returns unauthorized', async () => {
  const oldUser = { ...user, id: 'old-user' };
  authStorage.setStoredTokens({ accessToken: 'old-access', refreshToken: 'old-refresh', user: oldUser });
  holdMe = true; openCallback(); await waitCallback(); await waitFor(() => expect(meResponses.length).toBeGreaterThan(0));
  await complete({ accessToken: 'google-access', refreshToken: 'google-refresh', user });
  await screen.findByRole('textbox', { name: /Mô tả công việc bạn muốn thực hiện|Nhập câu trả lời làm rõ yêu cầu/ });
  await act(async () => {
    for (const response of meResponses) reply(response, { error: 'old session expired' }, 401);
    await nativeFetch(`${base}/round-trip`);
  });
  await waitFor(() => expect(calls.filter(call => call.path === '/api/auth/me').length).toBeGreaterThan(0));
  expect(authStorage.getStoredTokens().accessToken).toBe('google-access');
  expect(calls.some(call => call.path === '/api/auth/refresh')).toBe(false);
});
it.each([200, 401])('preserves Google principal when an older in-flight refresh resolves with %s', async status => {
  const oldUser = { ...user, id: 'old-user' };
  authStorage.setStoredTokens({ accessToken: 'old-access', refreshToken: 'old-refresh', user: oldUser });
  holdMe = true; holdRefresh = true; openCallback(); await waitCallback();
  await waitFor(() => expect(meResponses.length).toBeGreaterThan(0));
  await act(async () => { for (const response of meResponses) reply(response, { error: 'expired' }, 401); });
  await waitFor(() => expect(refreshResponses).toHaveLength(1));
  await complete({ accessToken: 'google-access', refreshToken: 'google-refresh', user });
  await screen.findByRole('textbox', { name: /Mô tả công việc bạn muốn thực hiện|Nhập câu trả lời làm rõ yêu cầu/ });
  await act(async () => {
    reply(refreshResponses[0], status === 200 ? { accessToken: 'rotated-old-access', refreshToken: 'rotated-old-refresh' } : { error: 'expired' }, status);
    await nativeFetch(`${base}/round-trip`);
  });
  expect(authStorage.getStoredTokens()).toEqual({ accessToken: 'google-access', refreshToken: 'google-refresh', user });
});
it.each(['different-user', 'same-user-new-session'])('does not replay an old POST under Google %s after REFRESH_ROTATED', async transition => {
  const oldUser = transition === 'different-user' ? { ...user, id: 'old-user' } : user;
  const oldAccess = generateAccessToken(oldUser, 'fixture-secret', 'old-session').accessToken;
  const googleAccess = generateAccessToken(user, 'fixture-secret', 'google-session').accessToken;
  unauthorizedWriteToken = oldAccess; holdRefresh = true;
  authStorage.setStoredTokens({ accessToken: oldAccess, refreshToken: 'old-refresh', user: oldUser });
  const oldAction = apiClient.request('/api/owned-write', { method: 'POST', body: JSON.stringify({ message: 'old session draft' }) });
  const outcome = oldAction.then(() => 'replayed', () => 'cancelled');
  await waitFor(() => expect(refreshResponses).toHaveLength(1));
  openCallback(); await complete({ accessToken: googleAccess, refreshToken: 'google-refresh', user });
  await screen.findByRole('textbox', { name: /Mô tả công việc bạn muốn thực hiện|Nhập câu trả lời làm rõ yêu cầu/ });
  await act(async () => { reply(refreshResponses[0], { code: 'REFRESH_ROTATED' }, 409); });
  expect(await outcome).toBe('cancelled');
  expect(protectedWrites).toEqual([{ authorization: `Bearer ${oldAccess}`, body: { message: 'old session draft' } }]);
  expect(authStorage.getStoredTokens()).toEqual({ accessToken: googleAccess, refreshToken: 'google-refresh', user });
});
it('retries an old POST using a genuine same-user same-session cross-tab rotation', async () => {
  const oldAccess = generateAccessToken(user, 'fixture-secret', 'shared-session', 1000).accessToken;
  const rotatedAccess = generateAccessToken(user, 'fixture-secret', 'shared-session', 2000).accessToken;
  unauthorizedWriteToken = oldAccess; holdRefresh = true;
  authStorage.setStoredTokens({ accessToken: oldAccess, refreshToken: 'old-refresh', user });
  const oldAction = apiClient.request('/api/owned-write', { method: 'POST', body: JSON.stringify({ message: 'same session draft' }) });
  await waitFor(() => expect(refreshResponses).toHaveLength(1));
  localStorage.setItem('wap_access_token', rotatedAccess); localStorage.setItem('wap_refresh_token', 'rotated-refresh');
  reply(refreshResponses[0], { code: 'REFRESH_ROTATED' }, 409);
  await expect(oldAction).resolves.toEqual({ success: true });
  expect(protectedWrites).toEqual([
    { authorization: `Bearer ${oldAccess}`, body: { message: 'same session draft' } },
    { authorization: `Bearer ${rotatedAccess}`, body: { message: 'same session draft' } },
  ]);
});
it('discards hydration from a prior session even when Google signs in the same user', async () => {
  const oldUser = { ...user, name: 'Old session profile' };
  const oldAccess = generateAccessToken(oldUser, 'fixture-secret', 'old-session').accessToken;
  const googleAccess = generateAccessToken(user, 'fixture-secret', 'google-session').accessToken;
  authStorage.setStoredTokens({ accessToken: oldAccess, refreshToken: 'old-refresh', user: oldUser });
  holdMe = true; openCallback(); await waitCallback(); await waitFor(() => expect(meResponses.length).toBeGreaterThan(0));
  await complete({ accessToken: googleAccess, refreshToken: 'google-refresh', user });
  await screen.findByRole('textbox', { name: /Mô tả công việc bạn muốn thực hiện|Nhập câu trả lời làm rõ yêu cầu/ });
  await act(async () => {
    for (const response of meResponses) reply(response, { user: oldUser });
    await nativeFetch(`${base}/round-trip`);
  });
  expect(authStorage.getStoredTokens().user).toEqual(user);
});
it('retries an obsolete hydration 401 with the current shared-session pair without clearing it or refreshing', async () => {
  const oldAccess = generateAccessToken(user, 'fixture-secret', 'shared-session', 1000).accessToken;
  const rotatedAccess = generateAccessToken(user, 'fixture-secret', 'shared-session', 2000).accessToken;
  authStorage.setStoredTokens({ accessToken: oldAccess, refreshToken: 'old-refresh', user });
  holdMe = true; render(<App />); await waitFor(() => expect(meResponses).toHaveLength(1));
  localStorage.setItem('wap_access_token', rotatedAccess); localStorage.setItem('wap_refresh_token', 'rotated-refresh');
  await act(async () => { reply(meResponses[0], { error: 'obsolete access token' }, 401); await nativeFetch(`${base}/round-trip`); });
  expect(authStorage.getStoredTokens().accessToken).toBe(rotatedAccess);
  await waitFor(() => expect(meResponses).toHaveLength(2));
  await act(async () => { reply(meResponses[1], { user }); await nativeFetch(`${base}/round-trip`); });
  expect(calls.filter(call => call.path === '/api/auth/me').map(call => call.authorization)).toEqual([`Bearer ${oldAccess}`, `Bearer ${rotatedAccess}`]);
  expect(calls.some(call => call.path === '/api/auth/refresh')).toBe(false);
  expect(authStorage.getStoredTokens()).toEqual({ accessToken: rotatedAccess, refreshToken: 'rotated-refresh', user });
});
it('discards an old hydration body after headers arrived before same-user Google login', async () => {
  const oldUser = { ...user, name: 'Old body profile' };
  const oldAccess = generateAccessToken(oldUser, 'fixture-secret', 'old-session').accessToken;
  const googleAccess = generateAccessToken(user, 'fixture-secret', 'google-session').accessToken;
  authStorage.setStoredTokens({ accessToken: oldAccess, refreshToken: 'old-refresh', user: oldUser });
  holdMe = true; openCallback(); await waitCallback(); await waitFor(() => expect(meResponses.length).toBeGreaterThan(0));
  for (const response of meResponses) { response.writeHead(200, { 'content-type': 'application/json' }); response.write('{"user":'); }
  await waitFor(() => expect(meHeadersArrived).toBe(meResponses.length));
  await complete({ accessToken: googleAccess, refreshToken: 'google-refresh', user });
  await screen.findByRole('textbox', { name: /Mô tả công việc bạn muốn thực hiện|Nhập câu trả lời làm rõ yêu cầu/ });
  await act(async () => {
    for (const response of meResponses) response.end(`${JSON.stringify(oldUser)}}`);
    await nativeFetch(`${base}/round-trip`);
  });
  expect(authStorage.getStoredTokens().user).toEqual(user);
});
it('hydrates an initially missing profile after current-session refresh', async () => {
  const oldAccess = generateAccessToken(user, 'fixture-secret', 'shared-session', 1000).accessToken;
  const rotatedAccess = generateAccessToken(user, 'fixture-secret', 'shared-session', 2000).accessToken;
  authStorage.setStoredTokens({ accessToken: oldAccess, refreshToken: 'old-refresh' });
  holdMe = true; holdRefresh = true; render(<App />); await waitFor(() => expect(meResponses).toHaveLength(1));
  reply(meResponses[0], { error: 'expired' }, 401); await waitFor(() => expect(refreshResponses).toHaveLength(1));
  reply(refreshResponses[0], { accessToken: rotatedAccess, refreshToken: 'rotated-refresh' });
  await waitFor(() => expect(meResponses).toHaveLength(2));
  await act(async () => { reply(meResponses[1], { user }); await nativeFetch(`${base}/round-trip`); });
  expect(authStorage.getStoredTokens().user).toEqual(user);
});
it('preserves a subsequent shared-session rotation when the bounded hydration retry is also obsolete', async () => {
  const first = generateAccessToken(user, 'fixture-secret', 'shared-session', 1000).accessToken;
  const second = generateAccessToken(user, 'fixture-secret', 'shared-session', 2000).accessToken;
  const third = generateAccessToken(user, 'fixture-secret', 'shared-session', 3000).accessToken;
  authStorage.setStoredTokens({ accessToken: first, refreshToken: 'first-refresh', user });
  holdMe = true; render(<App />); await waitFor(() => expect(meResponses).toHaveLength(1));
  localStorage.setItem('wap_access_token', second); localStorage.setItem('wap_refresh_token', 'second-refresh');
  reply(meResponses[0], { error: 'obsolete' }, 401); await waitFor(() => expect(meResponses).toHaveLength(2));
  localStorage.setItem('wap_access_token', third); localStorage.setItem('wap_refresh_token', 'third-refresh');
  await act(async () => { reply(meResponses[1], { error: 'also obsolete' }, 401); await nativeFetch(`${base}/round-trip`); });
  expect(authStorage.getStoredTokens().accessToken).toBe(third);
  expect(calls.filter(call => call.path === '/api/auth/me')).toHaveLength(2);
});
it.each([false, true])('does not clear a replacement shared-session pair when an old hydration 401 JSON body finishes later (identical JWT=%s)', async identicalJwt => {
  const first = generateAccessToken(user, 'fixture-secret', 'shared-session', 1000).accessToken;
  const second = generateAccessToken(user, 'fixture-secret', 'shared-session', 2000).accessToken;
  const third = identicalJwt ? first : generateAccessToken(user, 'fixture-secret', 'shared-session', 3000).accessToken;
  authStorage.setStoredTokens({ accessToken: first, refreshToken: 'first-refresh', user });
  holdMe = true; render(<App />); await waitFor(() => expect(meResponses).toHaveLength(1));
  localStorage.setItem('wap_access_token', second); localStorage.setItem('wap_refresh_token', 'second-refresh');
  reply(meResponses[0], { error: 'obsolete' }, 401); await waitFor(() => expect(meResponses).toHaveLength(2));
  meResponses[1].writeHead(401, { 'content-type': 'application/json' }); meResponses[1].write('{"error":');
  await waitFor(() => expect(meHeadersArrived).toBe(2));
  await waitFor(() => expect(authStorage.getStoredTokens().accessToken).toBeNull());
  act(() => authStorage.setStoredTokens({ accessToken: third, refreshToken: 'third-refresh', user }));
  await act(async () => { meResponses[1].end('"obsolete retry"}'); await nativeFetch(`${base}/round-trip`); });
  expect(authStorage.getStoredTokens()).toEqual({ accessToken: third, refreshToken: 'third-refresh', user });
  expect(calls.filter(call => call.path === '/api/auth/me')).toHaveLength(2);
});
it.each(['new-principal', 'same-user-new-session', 'logout', 'new-principal-without-event'])('preserves live cross-tab auth changes before callback installation: %s', async transition => {
  const initialAccess = generateAccessToken(user, 'fixture-secret', 'initial-session').accessToken;
  authStorage.setStoredTokens({ accessToken: initialAccess, refreshToken: 'initial-refresh', user });
  openCallback(); await waitCallback();
  const newerUser = transition.startsWith('new-principal') ? { ...user, id: 'other-tab-user' } : user;
  const newerAccess = generateAccessToken(newerUser, 'fixture-secret', 'other-tab-session').accessToken;
  if (transition === 'logout') {
    localStorage.removeItem('wap_access_token'); localStorage.removeItem('wap_refresh_token'); localStorage.removeItem('wap_user');
  } else {
    localStorage.setItem('wap_access_token', newerAccess); localStorage.setItem('wap_refresh_token', 'other-tab-refresh'); localStorage.setItem('wap_user', JSON.stringify(newerUser));
  }
  if (transition !== 'new-principal-without-event') window.dispatchEvent(new StorageEvent('storage', { key: 'wap_access_token', oldValue: initialAccess, newValue: transition === 'logout' ? null : newerAccess }));
  await complete({ accessToken: 'late-google-access', refreshToken: 'late-google-refresh', user });
  expect(authStorage.getStoredTokens()).toEqual(transition === 'logout' ? { accessToken: null, refreshToken: null, user: null }
    : { accessToken: newerAccess, refreshToken: 'other-tab-refresh', user: newerUser });
});
it('suppresses link success after a newer cross-tab session takes ownership', async () => {
  const initialAccess = generateAccessToken(user, 'fixture-secret', 'initial-session').accessToken;
  const newerAccess = generateAccessToken(user, 'fixture-secret', 'newer-session').accessToken;
  authStorage.setStoredTokens({ accessToken: initialAccess, refreshToken: 'initial-refresh', user });
  openCallback(); await waitCallback();
  localStorage.setItem('wap_access_token', newerAccess); localStorage.setItem('wap_refresh_token', 'newer-refresh');
  await complete({ success: true });
  expect(screen.queryByText('Đã liên kết tài khoản Google.')).toBeNull();
  expect(authStorage.getStoredTokens().accessToken).toBe(newerAccess);
});
it.each([false, true])('permits same-session rotation and profile hydration during a link callback (missing profile=%s)', async missingProfile => {
  const initialAccess = generateAccessToken(user, 'fixture-secret', 'shared-session', 1000).accessToken;
  const rotatedAccess = generateAccessToken(user, 'fixture-secret', 'shared-session', 2000).accessToken;
  authStorage.setStoredTokens({ accessToken: initialAccess, refreshToken: 'initial-refresh', ...(missingProfile ? {} : { user }) });
  openCallback(); await waitCallback();
  act(() => authStorage.setStoredTokens({ accessToken: rotatedAccess, refreshToken: 'rotated-refresh', user }));
  window.dispatchEvent(new StorageEvent('storage', { key: 'wap_access_token', oldValue: initialAccess, newValue: rotatedAccess }));
  await complete({ success: true });
  expect(await screen.findByRole('status')).toHaveTextContent('liên kết');
  expect(authStorage.getStoredTokens()).toEqual({ accessToken: rotatedAccess, refreshToken: 'rotated-refresh', user });
});
