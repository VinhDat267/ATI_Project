/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useSSE } from '../src/hooks/use-sse';
import { authStorage } from '../src/services/auth-storage';
import { useChatStore } from '../src/store/chat-store';
import { useEffect, useState } from 'react';

let server: Server;
let base: string;
let refreshStatus = 200;
let streamStatus = 200;
let rejectFresh = false;
let streamHeaders: string[] = [];
let refreshCount = 0;
const nativeFetch = globalThis.fetch;
function Client() { const state = useSSE('c1', 'expired'); return state?.disconnected ? <p>Mất kết nối, đang thử lại…</p> : null; }
function RetryClient() { const state = useSSE('c1', 'expired'); return <button onClick={state.reconnect}>Thử lại luồng</button>; }
function SubscribedClient() {
  const [token, setToken] = useState(authStorage.getStoredTokens().accessToken);
  useEffect(() => authStorage.subscribeAuthTokens(tokens => setToken(tokens.accessToken)), []);
  useSSE('c1', token);
  return token ? <p>Đã đăng nhập</p> : <p>Đăng nhập</p>;
}
beforeEach(async () => {
  refreshStatus = 200; streamStatus = 200; rejectFresh = false; streamHeaders = []; refreshCount = 0;
  useChatStore.getState().reset(); useChatStore.getState().setConversationId('c1');
  authStorage.setStoredTokens({ accessToken: 'expired', refreshToken: 'refresh-test' });
  server = createServer((req, res) => {
    if (req.url === '/api/auth/refresh') { refreshCount++; res.writeHead(refreshStatus, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(refreshStatus === 200 ? { accessToken: 'fresh', refreshToken: 'rotated' } : { error: 'Thử lại sau' })); return; }
    if (req.url?.endsWith('/stream')) {
      streamHeaders.push(String(req.headers.authorization));
      if (streamStatus !== 200) { res.writeHead(streamStatus, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Bạn không có quyền thực hiện thao tác này.' })); return; }
      if (req.headers.authorization !== 'Bearer fresh' || rejectFresh) { res.writeHead(401); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('event: clarification\ndata: {"question":"Kết nối đã khôi phục"}\n\n'); return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => nativeFetch(new URL(url, base), init));
});
afterEach(async () => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); authStorage.clearStoredTokens(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
it('real HTTP 401 refreshes once and sends the new header while hidden-tab SSE stays open', async () => {
  render(<Client />);
  await waitFor(() => expect(useChatStore.getState().activeClarification?.question).toBe('Kết nối đã khôi phục'));
  expect(streamHeaders).toEqual(['Bearer expired', 'Bearer fresh']);
  expect(authStorage.getStoredTokens().accessToken).toBe('fresh');
});
it('manual reconnection aborts the previous real stream and opens a read-only stream with fresh authentication', async () => {
  const signals: AbortSignal[] = [];
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => { if (String(url).endsWith('/stream') && init.signal) signals.push(init.signal); return nativeFetch(new URL(url, base), init); });
  render(<RetryClient />);
  await waitFor(() => expect(streamHeaders).toEqual(['Bearer expired', 'Bearer fresh']));
  const previous = signals.at(-1)!;
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại luồng' }));
  await waitFor(() => expect(streamHeaders).toHaveLength(3));
  expect(previous.aborted).toBe(true); expect(streamHeaders[2]).toBe('Bearer fresh'); expect(refreshCount).toBe(1);
});
it('real refresh 401 clears authentication so AuthGate can show sign in', async () => {
  refreshStatus = 401; render(<Client />);
  await waitFor(() => expect(authStorage.getStoredTokens().accessToken).toBeNull());
  expect(streamHeaders).toEqual(['Bearer expired']);
});
it('a second real stream 401 clears authentication without another refresh', async () => {
  rejectFresh = true; render(<Client />);
  await waitFor(() => expect(authStorage.getStoredTokens().accessToken).toBeNull());
  expect(streamHeaders).toEqual(['Bearer expired', 'Bearer fresh']);
});
it('keeps the one-refresh budget when new tokens re-render the authentication subscriber', async () => {
  rejectFresh = true; render(<SubscribedClient />);
  await screen.findByText('Đăng nhập');
  expect(refreshCount).toBe(1);
});
it('a real ownership 403 stops the stream without clearing a valid authenticated session', async () => {
  streamStatus = 403; render(<Client />);
  await screen.findByText('Mất kết nối, đang thử lại…', {}, { timeout: 6500 });
  expect(authStorage.getStoredTokens().accessToken).toBe('expired');
  expect(refreshCount).toBe(0);
  expect(streamHeaders).toEqual(['Bearer expired']);
}, 8000);
it('refresh server failure retains authentication and shows a delayed disconnection notice', async () => {
  refreshStatus = 503; render(<Client />);
  await waitFor(() => expect(streamHeaders.length).toBeGreaterThan(0));
  expect(screen.queryByText('Mất kết nối, đang thử lại…')).toBeNull();
  await screen.findByText('Mất kết nối, đang thử lại…', {}, { timeout: 6500 });
  expect(authStorage.getStoredTokens().accessToken).toBe('expired');
  refreshStatus = 200;
  await waitFor(() => expect(useChatStore.getState().activeClarification?.question).toBe('Kết nối đã khôi phục'), { timeout: 3000 });
  expect(screen.queryByText('Mất kết nối, đang thử lại…')).toBeNull();
}, 12000);
