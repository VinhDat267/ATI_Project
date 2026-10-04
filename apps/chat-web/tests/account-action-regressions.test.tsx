/** @vitest-environment jsdom */
import { createServer, type Server, type ServerResponse } from 'node:http';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { generateAccessToken } from '../../chat-api/src/auth/jwt';
import { AccountView } from '../src/views/AccountView';
import { apiClient } from '../src/services/api-client';
import { authStorage } from '../src/services/auth-storage';

const nativeFetch = globalThis.fetch;
const member = { id: 'account-action-user', email: 'account-actions@example.test', name: 'Member', role: 'member' as const };
const access = generateAccessToken(member, 'account-action-test-only', 'account-action-session').accessToken;
const expired = generateAccessToken(member, 'account-action-test-only', 'account-action-session', Date.now() - 16 * 60_000).accessToken;
let server: Server, origin: string;
let profile: { name: string; hasGoogle: boolean };
let calls: Array<{ path: string; body: any; authorization?: string }>;
let nameResponses: ServerResponse[], googleResponses: ServerResponse[];
let holdGoogle: boolean, refreshSucceeds: boolean;
let googleFailure: 'none' | 'server' | 'disconnect';
const reply = (response: ServerResponse, body: unknown, status = 200) => {
  response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body));
};
beforeEach(async () => {
  authStorage.clearStoredTokens();
  authStorage.setStoredTokens({ accessToken: access, refreshToken: 'account-action-refresh', user: member });
  profile = { name: member.name, hasGoogle: true }; calls = []; nameResponses = []; googleResponses = [];
  holdGoogle = false; refreshSucceeds = true; googleFailure = 'none';
  server = createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk;
    const call = { path: request.url!, body: raw ? JSON.parse(raw) : undefined, authorization: request.headers.authorization };
    calls.push(call);
    if (call.path === '/api/auth/config') return reply(response, { signupEnabled: true, googleEnabled: true });
    if (call.path === '/api/account') return reply(response, { account: { ...member, ...profile, createdAt: '2026-10-01T00:00:00Z', hasPassword: true, googleEmail: profile.hasGoogle ? 'google@example.test' : null } });
    if (call.path === '/api/account/sessions') return reply(response, { sessions: [] });
    if (call.path === '/api/account/profile') { nameResponses.push(response); return; }
    if (call.path === '/api/auth/refresh') {
      if (!refreshSucceeds || call.body.refreshToken !== 'account-action-refresh') return reply(response, { error: 'Session revoked' }, 401);
      return reply(response, { accessToken: access, refreshToken: 'account-action-rotated-refresh' });
    }
    if (call.path === '/api/auth/google/start' || call.path === '/api/auth/google/unlink') {
      if (holdGoogle) { googleResponses.push(response); return; }
      if (googleFailure === 'disconnect') { response.destroy(); return; }
      if (googleFailure === 'server') return reply(response, { error: 'Unavailable' }, 503);
      if (call.authorization !== `Bearer ${access}`) return reply(response, { error: 'Access expired' }, 401);
      if (call.path.endsWith('/start')) return reply(response, { url: 'http://127.0.0.1/local-oidc' });
      profile.hasGoogle = false; return reply(response, { success: true });
    }
    return reply(response, { success: true });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as any).port}`;
  // Only resolve browser-relative URLs; native HTTP, response bodies and API code remain real.
  vi.stubGlobal('fetch', (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    nativeFetch(typeof input === 'string' && input.startsWith('/') ? `${origin}${input}` : input, init));
});
afterEach(async () => {
  cleanup(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  vi.unstubAllGlobals(); authStorage.clearStoredTokens();
});
async function openAccount() {
  render(<AccountView user={member} navigate={() => {}} onLogout={() => {}} />);
  await screen.findByDisplayValue('Member');
}
async function saveName(value: string) {
  fireEvent.change(screen.getByLabelText('Tên hiển thị'), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu tên' }));
  await waitFor(() => expect(nameResponses).toHaveLength(1));
}
async function finishName(status = 200) {
  const submitted = calls.find(call => call.path === '/api/account/profile')!.body.name;
  await act(async () => {
    if (status === 200) profile.name = submitted;
    reply(nameResponses[0], status === 200 ? { user: { ...member, name: submitted } } : { error: 'Name rejected' }, status);
    await nativeFetch(`${origin}/round-trip`);
  });
}
it('keeps a newer unsubmitted name draft when an earlier PATCH succeeds', async () => {
  await openAccount(); await saveName('Submitted A');
  fireEvent.change(screen.getByLabelText('Tên hiển thị'), { target: { value: 'Unsubmitted B' } });
  await finishName(); await screen.findByRole('status');
  expect(screen.getByLabelText('Tên hiển thị')).toHaveValue('Unsubmitted B');
  expect(authStorage.getStoredTokens().user?.name).toBe('Submitted A');
  expect(calls.filter(call => call.path === '/api/account/profile').map(call => call.body)).toEqual([{ name: 'Submitted A' }]);
});
it('normalizes an unchanged submitted draft after success', async () => {
  await openAccount(); await saveName('  Submitted A  '); await finishName(); await screen.findByRole('status');
  expect(screen.getByLabelText('Tên hiển thị')).toHaveValue('Submitted A');
});
it('preserves edits when the pending name PATCH fails', async () => {
  await openAccount(); await saveName('Submitted A');
  fireEvent.change(screen.getByLabelText('Tên hiển thị'), { target: { value: 'Unsubmitted B' } });
  await finishName(400); await screen.findByRole('alert');
  expect(screen.getByLabelText('Tên hiển thị')).toHaveValue('Unsubmitted B');
  expect(authStorage.getStoredTokens().user?.name).toBe('Member');
});
it('refreshes an expired access token once before starting authenticated Google linking', async () => {
  authStorage.setStoredTokens({ accessToken: expired });
  await expect(apiClient.startGoogleAuth('link')).resolves.toEqual({ url: 'http://127.0.0.1/local-oidc' });
  expect(calls.map(call => call.path)).toEqual(['/api/auth/google/start', '/api/auth/refresh', '/api/auth/google/start']);
  expect(calls.filter(call => call.path.endsWith('/start')).map(call => ({ body: call.body, authorization: call.authorization }))).toEqual([
    { body: { mode: 'link' }, authorization: `Bearer ${expired}` }, { body: { mode: 'link' }, authorization: `Bearer ${access}` },
  ]);
  expect(authStorage.getStoredTokens().refreshToken).toBe('account-action-rotated-refresh');
});
it('refreshes expired Google unlink and reloads the actual account method state', async () => {
  await openAccount(); authStorage.setStoredTokens({ accessToken: expired });
  fireEvent.click(screen.getByRole('button', { name: 'Gỡ liên kết' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Đã gỡ liên kết Google');
  expect(screen.getByRole('button', { name: 'Liên kết Google' })).toBeEnabled();
  expect(calls.filter(call => call.path.includes('/google/') || call.path.endsWith('/refresh')).map(call => call.path)).toEqual([
    '/api/auth/google/unlink', '/api/auth/refresh', '/api/auth/google/unlink',
  ]);
  expect(calls.filter(call => call.path.endsWith('/unlink')).map(call => call.body)).toEqual([{}, {}]);
});
it('clears the still-owned session when Google unlink cannot refresh a revoked session', async () => {
  refreshSucceeds = false; authStorage.setStoredTokens({ accessToken: expired });
  await expect(apiClient.unlinkGoogle()).rejects.toMatchObject({ status: 401 });
  expect(authStorage.getStoredTokens()).toEqual({ accessToken: null, refreshToken: null, user: null });
  expect(calls.map(call => call.path)).toEqual(['/api/auth/google/unlink', '/api/auth/refresh']);
});
it.each(['server', 'disconnect'] as const)('does not retry a Google mutation with an uncertain %s response', async failure => {
  googleFailure = failure;
  await expect(apiClient.unlinkGoogle()).rejects.toBeInstanceOf(Error);
  expect(calls.map(call => call.path)).toEqual(['/api/auth/google/unlink']);
  expect(authStorage.getStoredTokens().accessToken).toBe(access);
});
it('rejects a late successful Google response from an older session without erasing the new one', async () => {
  holdGoogle = true;
  const result = apiClient.startGoogleAuth('link').catch(reason => reason);
  await waitFor(() => expect(googleResponses).toHaveLength(1));
  const newUser = { ...member, id: 'new-account-user' };
  const newAccess = generateAccessToken(newUser, 'account-action-test-only', 'new-account-session').accessToken;
  authStorage.setStoredTokens({ accessToken: newAccess, refreshToken: 'new-account-refresh', user: newUser });
  reply(googleResponses[0], { url: 'http://127.0.0.1/local-oidc' });
  expect(await result).toBeInstanceOf(Error);
  expect(calls.map(call => call.path)).toEqual(['/api/auth/google/start']);
  expect(authStorage.getStoredTokens()).toEqual({ accessToken: newAccess, refreshToken: 'new-account-refresh', user: newUser });
});
