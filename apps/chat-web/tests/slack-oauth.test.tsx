import { StrictMode } from 'react';
import { createServer, type Server } from 'node:http';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { SlackCallbackView } from '../src/views/SlackCallbackView';
import { PersonalSlack } from '../src/pages/Settings/PersonalSlack';
import { useRoute } from '../src/hooks/use-route';
import { authStorage } from '../src/services/auth-storage';
const nativeFetch = fetch, navigate = vi.fn();
let server: Server, callbacks: any[], removed: string[], fail: boolean;
beforeEach(async () => {
  callbacks = []; removed = []; fail = false; navigate.mockReset();
  authStorage.setStoredTokens({ accessToken: 'TOKEN', refreshToken: 'REFRESH', user: { id: 'a', email: 'a@example.test', name: 'A' } });
  server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    res.setHeader('Content-Type', 'application/json');
    if (req.url?.endsWith('/callback')) { callbacks.push({ body: JSON.parse(body), location: window.location.href }); res.statusCode = fail ? 401 : 200; res.end(JSON.stringify(fail ? {} : { workspaceName: 'Workspace', workspaceId: 'T_1' })); }
    else if (req.method === 'DELETE') { removed.push(req.url!); res.end(JSON.stringify({ success: true, revoked: false })); }
    else res.end(JSON.stringify({ connections: [{ id: 'one', workspaceName: 'Workspace One', workspaceId: 'T_1', actorId: 'U_1', status: 'active', missingScopes: [] }, { id: 'two', workspaceName: 'Workspace Two', workspaceId: 'T_2', actorId: 'U_2', status: 'reconnect_required', missingScopes: ['search:read'] }].filter(r => !removed.some(path => path.endsWith('/' + r.id))) }));
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => nativeFetch(new URL(url, origin), init));
  window.history.replaceState({}, '', '/connections/myslack/callback?code=PRIVATE_CODE&state=PRIVATE_STATE');
});
afterEach(async () => { cleanup(); authStorage.clearStoredTokens(); vi.unstubAllGlobals(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); });
function Callback() { const { route } = useRoute(); return <SlackCallbackView input={'googleCallback' in route ? route.googleCallback : undefined} navigate={navigate} />; }
it('scrubs callback secrets, makes one request in StrictMode and shows completion', async () => {
  render(<StrictMode><Callback /></StrictMode>);
  await screen.findByRole('heading', { name: 'Đã kết nối Slack' });
  expect(callbacks).toHaveLength(1); expect(callbacks[0].location).not.toMatch(/PRIVATE/);
  expect(screen.queryByText(/Đang hoàn tất/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Về Kết nối dịch vụ' })); expect(navigate).toHaveBeenCalledWith('/settings#myslack', true);
});
it('never replays callback after 401 and safely explains failure', async () => {
  fail = true; render(<Callback />); await screen.findByRole('alert'); expect(callbacks).toHaveLength(1);
});
it('lists two workspaces and disconnects only the selected one', async () => {
  render(<PersonalSlack />); await screen.findByText('Workspace One'); await screen.findByText('Workspace Two');
  expect(screen.getByText(/Chờ cho phép xử lý dữ liệu/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Ngắt kết nối Workspace One' }));
  await waitFor(() => expect(screen.queryByText('Workspace One')).not.toBeInTheDocument());
  expect(screen.getByText('Workspace Two')).toBeInTheDocument(); expect(removed).toEqual(['/api/connections/myslack/one']);
  expect(screen.getByRole('status')).toHaveTextContent(/gỡ quyền.*Slack/);
});
