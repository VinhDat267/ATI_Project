/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { useSSE } from '../src/hooks/use-sse';
import { authStorage } from '../src/services/auth-storage';
import { useChatStore } from '../src/store/chat-store';

let server: Server;
let base: string;
let refreshStatus = 200;
let rejectFresh = false;
let streamHeaders: string[] = [];
const nativeFetch = globalThis.fetch;
function Client() { const state = useSSE('c1', 'expired'); return state?.disconnected ? <p>Mất kết nối, đang thử lại…</p> : null; }
beforeEach(async () => {
  refreshStatus = 200; rejectFresh = false; streamHeaders = [];
  useChatStore.getState().reset(); useChatStore.getState().setConversationId('c1');
  authStorage.setStoredTokens({ accessToken: 'expired', refreshToken: 'refresh-test' });
  server = createServer((req, res) => {
    if (req.url === '/api/auth/refresh') { res.writeHead(refreshStatus, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(refreshStatus === 200 ? { accessToken: 'fresh', refreshToken: 'rotated' } : { error: 'Thử lại sau' })); return; }
    if (req.url?.endsWith('/stream')) {
      streamHeaders.push(String(req.headers.authorization));
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
