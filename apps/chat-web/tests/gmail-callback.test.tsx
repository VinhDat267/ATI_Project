import { StrictMode } from 'react';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { GmailCallbackView } from '../src/views/GmailCallbackView';
import { useRoute } from '../src/hooks/use-route';
import { authStorage } from '../src/services/auth-storage';
import { ApiClient } from '../src/services/api-client';

let server: Server, callbacks: unknown[], statuses: number, errorCode: string, release: () => void, hold: boolean;
const nativeFetch = globalThis.fetch;
const user = { id: 'a', email: 'ati@example.test', name: 'A' };
const navigate = vi.fn();
let responses: Promise<Response>[];
beforeEach(async () => {
  callbacks = []; responses = []; statuses = 200; errorCode = 'GMAIL_STATE_INVALID'; hold = false; navigate.mockReset();
  authStorage.setStoredTokens({ accessToken: 'initial-token', refreshToken: 'initial-refresh', user });
  const gate = new Promise<void>(resolve => { release = resolve; });
  server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    if (req.url !== '/api/connections/gmail/callback') { res.writeHead(404); res.end('{}'); return; }
    callbacks.push({ method: req.method, body: JSON.parse(body), url: window.location.href, authorization: req.headers.authorization });
    if (hold) await gate;
    res.writeHead(statuses, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(statuses === 200 ? { email: 'different@gmail.test' } : { code: errorCode }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const response = nativeFetch(new URL(url, origin), init).then(async result => { await result.clone().arrayBuffer(); return result; });
    responses.push(response); return response;
  });
  window.history.replaceState({}, '', '/connections/gmail/callback?code=SENTINEL_CODE&state=SENTINEL_STATE&scope=private#secret');
});
afterEach(async () => {
  release(); cleanup(); authStorage.clearStoredTokens(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
});
function Callback() { const { route } = useRoute(); return <GmailCallbackView input={'googleCallback' in route ? route.googleCallback : undefined} navigate={navigate} />; }
const mount = () => render(<StrictMode><Callback /></StrictMode>);
it('scrubs the full query before one authenticated callback, including StrictMode replay', async () => {
  mount(); await waitFor(() => expect(navigate).toHaveBeenCalledWith('/settings#gmail', true));
  expect(callbacks).toEqual([{ method: 'POST', body: { code: 'SENTINEL_CODE', state: 'SENTINEL_STATE' }, url: 'http://localhost:3000/connections/gmail/callback', authorization: 'Bearer initial-token' }]);
  expect(document.body.textContent).not.toMatch(/SENTINEL_CODE|SENTINEL_STATE/);
});
it.each(['GMAIL_STATE_INVALID', 'GMAIL_SCOPE_MISSING', 'GMAIL_REFRESH_TOKEN_MISSING', 'GMAIL_CONNECT_FAILED', 'INVALID_SESSION'])('shows a useful safe message for %s', async code => {
  statuses = 400; errorCode = code; mount();
  const alert = await screen.findByRole('alert'); expect(alert.textContent).toMatch(/kết nối|đăng nhập/i);
  expect(navigate).not.toHaveBeenCalled(); expect(callbacks).toHaveLength(1);
});
it.each(['logout', 'switch-user', 'new-session', 'unmount'])('does not navigate after %s while the callback is in flight', async change => {
  hold = true; const view = mount(); await waitFor(() => expect(callbacks).toHaveLength(1));
  act(() => {
    if (change === 'logout') authStorage.clearStoredTokens();
    if (change === 'switch-user') authStorage.setStoredTokens({ accessToken: 'b', refreshToken: 'br', user: { ...user, id: 'b' } });
    if (change === 'new-session') authStorage.setStoredTokens({ accessToken: 'other-session', refreshToken: 'new', user });
    if (change === 'unmount') view.unmount();
    release();
  });
  // Wait for the actual HTTP body so a late successful response really reaches the client.
  await act(async () => { await Promise.all(responses); });
  expect(navigate).not.toHaveBeenCalled(); expect(callbacks).toHaveLength(1);
});
it('never refreshes or replays the one-use callback on a 401', async () => {
  statuses = 401; errorCode = 'INVALID_SESSION'; const client = new ApiClient();
  await expect(client.completeGmailConnection('code', 'state')).rejects.toMatchObject({ status: 401 });
  expect(callbacks).toHaveLength(1);
});
it.each(['code=one&code=two&state=state', 'error=access_denied&state=state', 'state=state'])('does not send invalid callback parameters: %s', async query => {
  window.history.replaceState({}, '', '/connections/gmail/callback?' + query); mount();
  await screen.findByRole('alert'); expect(callbacks).toHaveLength(0); expect(navigate).not.toHaveBeenCalled();
});
