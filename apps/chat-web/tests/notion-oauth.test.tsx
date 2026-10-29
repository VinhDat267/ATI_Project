import { StrictMode } from 'react';
import { createServer, type Server } from 'node:http';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { NotionCallbackView } from '../src/views/NotionCallbackView';
import { PersonalNotion } from '../src/pages/Settings/PersonalNotion';
import { useRoute } from '../src/hooks/use-route';
import { authStorage } from '../src/services/auth-storage';
const nativeFetch = fetch, navigate = vi.fn();
let server: Server, callbacks: any[], saved: any[];
const one = '11111111-1111-4111-8111-111111111111', two = '22222222-2222-4222-8222-222222222222';
const row = { id: 'connection', workspaceName: 'Workspace', workspaceId: 'T_1', actorId: 'owner', identityVersion: 1, status: 'scope_required', allowedDatabases: [], toolsAvailable: false };
beforeEach(async () => {
  callbacks = []; saved = []; navigate.mockReset();
  authStorage.setStoredTokens({ accessToken: 'TOKEN', refreshToken: 'REFRESH', user: { id: 'a', email: 'a@example.test', name: 'A' } });
  server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk; res.setHeader('Content-Type', 'application/json');
    if (req.url?.endsWith('/callback')) { callbacks.push({ body: JSON.parse(body), location: window.location.href }); res.end(JSON.stringify(row)); }
    else if (req.method === 'PUT') { saved.push(JSON.parse(body)); res.end(JSON.stringify({ ...row, identityVersion: 2, allowedDatabases: saved[0].databaseIds, status: 'connected' })); }
    else if (req.url?.includes('/databases')) { const query = new URL(req.url!, 'http://fixture').searchParams.get('query'); res.end(JSON.stringify({ databases: query ? [{ id: two, title: 'Notes' }] : [{ id: one, title: 'Tasks' }], identityVersion: 1, hasMore: false })); }
    else res.end(JSON.stringify({ connections: [row] }));
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => nativeFetch(new URL(url, origin), init));
  window.history.replaceState({}, '', '/connections/mynotion/callback?code=PRIVATE_CODE&state=PRIVATE_STATE');
});
afterEach(async () => { cleanup(); authStorage.clearStoredTokens(); vi.unstubAllGlobals(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); });
function Callback() { const { route } = useRoute(); return <NotionCallbackView input={'googleCallback' in route ? route.googleCallback : undefined} navigate={navigate} />; }
it('scrubs OAuth query and makes one callback in StrictMode; completion has no spinner', async () => {
  render(<StrictMode><Callback /></StrictMode>); await screen.findByRole('heading', { name: 'Đã kết nối Notion' });
  expect(callbacks).toHaveLength(1); expect(callbacks[0].location).not.toMatch(/PRIVATE/);
  expect(screen.queryByText('Đang hoàn tất kết nối Notion…')).not.toBeInTheDocument();
});
it('preserves selected databases across search results before saving', async () => {
  render(<PersonalNotion />); fireEvent.click(await screen.findByRole('button', { name: 'Chọn database Workspace' }));
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Tasks' }));
  fireEvent.change(screen.getByLabelText('Tìm database'), { target: { value: 'Notes' } }); fireEvent.click(screen.getByRole('button', { name: 'Tìm' }));
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Notes' }));
  fireEvent.click(screen.getByRole('button', { name: 'Lưu database được dùng' }));
  await waitFor(() => expect(saved).toHaveLength(1)); expect(saved[0]).toEqual({ identityVersion: 1, databaseIds: [one, two] });
  expect(await screen.findByRole('status')).toHaveTextContent('Công cụ Notion cá nhân chưa được mở');
});
