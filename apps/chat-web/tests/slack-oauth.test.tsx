import { StrictMode } from 'react';
import { createServer, type Server } from 'node:http';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { SlackCallbackView } from '../src/views/SlackCallbackView';
import { PersonalSlack } from '../src/pages/Settings/PersonalSlack';
import { useRoute } from '../src/hooks/use-route';
import { authStorage } from '../src/services/auth-storage';
import { normalizeSlackConnection, normalizeSlackCallbackResult } from '../src/services/slack-connection';

const nativeFetch = fetch, navigate = vi.fn();
let server: Server;
let callbacks: any[];
let startCalls: any[];
let removed: string[];
let fail: boolean;
let callbackResponse: Record<string, any> | null;
let customConnections: any[] | null;
let delayDisconnectMs = 0;
let delayCallbackMs = 0;

beforeEach(async () => {
  callbacks = [];
  startCalls = [];
  removed = [];
  fail = false;
  callbackResponse = null;
  customConnections = null;
  delayDisconnectMs = 0;
  delayCallbackMs = 0;
  navigate.mockReset();
  authStorage.setStoredTokens({
    accessToken: 'TOKEN_1',
    refreshToken: 'REFRESH_1',
    user: { id: 'user_1', email: 'user1@example.test', name: 'User One' },
  });

  server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    res.setHeader('Content-Type', 'application/json');

    if (req.url?.endsWith('/start')) {
      startCalls.push({ body: body ? JSON.parse(body) : {} });
      res.end(JSON.stringify({ url: 'https://slack.com/oauth/v2/authorize?client_id=fake' }));
    } else if (req.url?.endsWith('/callback')) {
      callbacks.push({ body: body ? JSON.parse(body) : {}, location: window.location.href });
      if (delayCallbackMs > 0) {
        await new Promise((r) => setTimeout(r, delayCallbackMs));
      }
      res.statusCode = fail ? 401 : 200;
      res.end(JSON.stringify(fail ? {} : (callbackResponse ?? { id: 'conn_1', workspaceName: 'Workspace', workspaceId: 'T_1', actorId: 'U_1', identityVersion: 1, connectedAt: '2026-10-29T10:00:00.000Z', scopes: [] })));
    } else if (req.method === 'DELETE') {
      removed.push(req.url!);
      if (delayDisconnectMs > 0) {
        await new Promise((r) => setTimeout(r, delayDisconnectMs));
      }
      res.end(JSON.stringify({ success: true, revoked: false }));
    } else {
      const defaultList = [
        { id: 'one', workspaceName: 'Workspace One', workspaceId: 'T_1', actorId: 'U_1', identityVersion: 1, connectedAt: '2026-10-29T10:00:00.000Z', scopes: ['channels:read'], status: 'active', missingScopes: [] },
        { id: 'two', workspaceName: 'Workspace Two', workspaceId: 'T_2', actorId: 'U_2', identityVersion: 1, connectedAt: '2026-10-29T10:00:00.000Z', scopes: ['channels:read'], status: 'reconnect_required', missingScopes: ['search:read'] },
      ];
      const rows = (customConnections ?? defaultList).filter(r => !removed.some(path => path.endsWith('/' + r.id)));
      res.end(JSON.stringify({ connections: rows }));
    }
  });

  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => nativeFetch(new URL(url, origin), init));
  window.history.replaceState({}, '', '/connections/myslack/callback?code=PRIVATE_CODE&state=PRIVATE_STATE');
});

afterEach(async () => {
  cleanup();
  authStorage.clearStoredTokens();
  vi.unstubAllGlobals();
  server.closeAllConnections();
  await new Promise<void>(r => server.close(() => r()));
});

function Callback() {
  const { route } = useRoute();
  return <SlackCallbackView input={'googleCallback' in route ? route.googleCallback : undefined} navigate={navigate} />;
}

it('scrubs callback secrets, makes one request in StrictMode and shows completion', async () => {
  render(<StrictMode><Callback /></StrictMode>);
  await screen.findByRole('heading', { name: 'Đã kết nối Slack' });
  expect(callbacks).toHaveLength(1);
  expect(callbacks[0].location).not.toMatch(/PRIVATE/);
  expect(screen.queryByText(/Đang hoàn tất/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Về Kết nối dịch vụ' }));
  expect(navigate).toHaveBeenCalledWith('/settings#myslack', true);
});

it('navigates to validated conversation returnTo on callback success', async () => {
  callbackResponse = {
    connectionId: 'conn_1',
    workspaceName: 'Acme Corp',
    workspaceId: 'T_123',
    slackUserId: 'U_123',
    returnTo: '/c/12345678-1234-1234-1234-123456789abc',
  };
  render(<Callback />);
  await waitFor(() => {
    expect(navigate).toHaveBeenCalledWith('/c/12345678-1234-1234-1234-123456789abc', true);
  });
});

it('falls back to settings when callback returnTo is invalid', async () => {
  callbackResponse = {
    connectionId: 'conn_1',
    workspaceName: 'Acme Corp',
    workspaceId: 'T_123',
    slackUserId: 'U_123',
    returnTo: 'https://malicious.example.com/steal',
  };
  render(<Callback />);
  await screen.findByRole('heading', { name: 'Đã kết nối Slack' });
  expect(navigate).not.toHaveBeenCalledWith('https://malicious.example.com/steal', true);
  fireEvent.click(screen.getByRole('button', { name: 'Về Kết nối dịch vụ' }));
  expect(navigate).toHaveBeenCalledWith('/settings#myslack', true);
});

it('never replays callback after 401 and safely explains failure', async () => {
  fail = true;
  render(<Callback />);
  await screen.findByRole('alert');
  expect(callbacks).toHaveLength(1);
});

it('terminates callback pending state and ignores response if session owner changed', async () => {
  delayCallbackMs = 80;
  render(<Callback />);
  expect(screen.getByText(/Đang hoàn tất/)).toBeInTheDocument();

  // Switch session owner mid-flight
  await act(async () => {
    authStorage.setStoredTokens({
      accessToken: 'TOKEN_2',
      refreshToken: 'REFRESH_2',
      user: { id: 'user_2', email: 'user2@example.test', name: 'User Two' },
    });
  });

  await waitFor(() => expect(screen.queryByText(/Đang hoàn tất/)).not.toBeInTheDocument());
  expect(screen.getByRole('alert')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Đã kết nối Slack' })).not.toBeInTheDocument();
  expect(callbacks).toHaveLength(1);
  expect(navigate).not.toHaveBeenCalled();
});

it('owner switch ends pending callback without another exchange or navigation', async () => {
  authStorage.setStoredTokens({ accessToken: 'A', refreshToken: 'RA', user: { id: 'A', email: 'a@example.test', name: 'A' } });
  const fetchSpy = vi.fn(() => new Promise<Response>(() => {}));
  vi.stubGlobal('fetch', fetchSpy);
  const nav = vi.fn();
  render(<SlackCallbackView input={{ code: 'CODE', state: 'STATE' }} navigate={nav} />);
  expect(screen.getByText(/Đang hoàn tất/)).toBeInTheDocument();
  await act(async () => {
    authStorage.setStoredTokens({ accessToken: 'B', refreshToken: 'RB', user: { id: 'B', email: 'b@example.test', name: 'B' } });
  });
  await waitFor(() => expect(screen.queryByText(/Đang hoàn tất/)).not.toBeInTheDocument());
  expect(screen.getByRole('alert')).toBeInTheDocument();
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  expect(nav).not.toHaveBeenCalled();
});

it('does not fabricate successful callback identity from workspace name alone', () => {
  expect(normalizeSlackCallbackResult({ workspaceId: 'T1', workspaceName: 'Workspace' })).toBeNull();
});

it('rejects invalid canonical generation and timestamp instead of inventing metadata', () => {
  const raw = {
    id: 'conn',
    workspaceId: 'T1',
    workspaceName: 'Workspace',
    slackUserId: 'U1',
    slackUserLabel: 'U1',
    status: 'active',
    identityVersion: 0,
    scopes: [],
    connectedAt: 'invalid',
    consentStatus: 'granted',
    processingReady: true,
  };
  expect(normalizeSlackConnection(raw)).toBeNull();
});

it('normalizes legacy metadata safely and renders canonical 02A fields', async () => {
  customConnections = [
    {
      id: 'canon_1',
      workspaceId: 'T_CANON',
      workspaceName: 'Acme Canonical',
      slackUserId: 'U_CANON',
      slackUserLabel: 'Alice (Finance)',
      status: 'active',
      identityVersion: 1,
      scopes: ['channels:read'],
      connectedAt: '2026-10-29T10:00:00.000Z',
      consentStatus: 'granted',
      processingReady: true,
    },
    {
      id: 'legacy_2',
      workspaceId: 'T_LEGACY',
      workspaceName: 'Acme Legacy',
      actorId: 'U_LEGACY',
      identityVersion: 1,
      connectedAt: '2026-10-29T10:00:00.000Z',
      status: 'active',
      scopes: ['channels:read'],
      missingScopes: ['chat:write'],
    },
  ];

  render(<PersonalSlack />);
  await screen.findByText('Acme Canonical');
  await screen.findByText('Acme Legacy');

  // Canonical workspace with processingReady === true
  expect(screen.getByText('Alice (Finance)')).toBeInTheDocument();
  expect(screen.getByText('Đã sẵn sàng xử lý')).toBeInTheDocument();

  // Legacy workspace normalizes actorId and defaults to pending/unready
  expect(screen.getByText('U_LEGACY')).toBeInTheDocument();
  expect(screen.getByText('Chờ cho phép xử lý dữ liệu')).toBeInTheDocument();
  expect(screen.getByText(/Một số quyền chưa được cấp/)).toBeInTheDocument();
});

it('refuses to infer readiness from active + granted alone when processingReady is false', async () => {
  customConnections = [
    {
      id: 'unready_1',
      workspaceId: 'T_UNREADY',
      workspaceName: 'Unready Corp',
      slackUserId: 'U_TEST',
      slackUserLabel: 'Test User',
      status: 'active',
      identityVersion: 1,
      scopes: ['channels:read'],
      connectedAt: '2026-10-29T10:00:00.000Z',
      consentStatus: 'granted',
      processingReady: false, // Provider unverified or policy missing
    },
  ];

  render(<PersonalSlack />);
  await screen.findByText('Unready Corp');
  expect(screen.getByText('Chờ cho phép xử lý dữ liệu')).toBeInTheDocument();
  expect(screen.queryByText('Đã sẵn sàng xử lý')).not.toBeInTheDocument();
});

it('distinguishes duplicate workspace names by displaying workspace IDs and Slack identities', async () => {
  customConnections = [
    {
      id: 'dup_1',
      workspaceId: 'T_CORP_US',
      workspaceName: 'Enterprise Slack',
      slackUserId: 'U_US',
      slackUserLabel: 'User US',
      status: 'active',
      processingReady: true,
      consentStatus: 'granted',
      identityVersion: 1,
      scopes: ['channels:read'],
      connectedAt: '2026-10-29T10:00:00.000Z',
    },
    {
      id: 'dup_2',
      workspaceId: 'T_CORP_EU',
      workspaceName: 'Enterprise Slack',
      slackUserId: 'U_EU',
      slackUserLabel: 'User EU',
      status: 'active',
      processingReady: false,
      consentStatus: 'pending',
      identityVersion: 1,
      scopes: ['channels:read'],
      connectedAt: '2026-10-29T10:00:00.000Z',
    },
  ];

  render(<PersonalSlack />);
  const headings = await screen.findAllByText('Enterprise Slack');
  expect(headings).toHaveLength(2);
  expect(screen.getByText('T_CORP_US')).toBeInTheDocument();
  expect(screen.getByText('T_CORP_EU')).toBeInTheDocument();
  expect(screen.getByText('User US')).toBeInTheDocument();
  expect(screen.getByText('User EU')).toBeInTheDocument();
});

it('requires CockpitDialog confirmation to disconnect; cancel sends no DELETE; confirm sends DELETE', async () => {
  render(<PersonalSlack />);
  await screen.findByText('Workspace One');
  await screen.findByText('Workspace Two');

  // Click disconnect on Workspace One -> opens confirmation dialog
  fireEvent.click(screen.getByRole('button', { name: 'Ngắt kết nối Workspace One' }));
  const dialog = await screen.findByRole('dialog', { name: /Ngắt kết nối/ });
  expect(dialog).toBeInTheDocument();
  expect(screen.getByText(/Bạn có chắc chắn muốn ngắt kết nối/)).toBeInTheDocument();
  expect(removed).toHaveLength(0);

  // Click "Hủy" -> closes dialog without DELETE
  fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  expect(removed).toHaveLength(0);
  expect(screen.getByText('Workspace One')).toBeInTheDocument();

  // Click disconnect again -> confirm this time
  fireEvent.click(screen.getByRole('button', { name: 'Ngắt kết nối Workspace One' }));
  await screen.findByRole('dialog', { name: /Ngắt kết nối/ });
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận ngắt kết nối' }));

  await waitFor(() => expect(screen.queryByText('Workspace One')).not.toBeInTheDocument());
  expect(screen.getByText('Workspace Two')).toBeInTheDocument();
  expect(removed).toEqual(['/api/connections/myslack/one']);
  expect(screen.getByRole('status')).toHaveTextContent(/gỡ quyền.*Slack/);
});

it('ignores disconnect response if session owner changed before completion', async () => {
  delayDisconnectMs = 80;
  render(<PersonalSlack />);
  await screen.findByText('Workspace One');

  fireEvent.click(screen.getByRole('button', { name: 'Ngắt kết nối Workspace One' }));
  await screen.findByRole('dialog', { name: /Ngắt kết nối/ });
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận ngắt kết nối' }));

  // Switch session owner mid-flight
  authStorage.setStoredTokens({
    accessToken: 'TOKEN_NEW',
    refreshToken: 'REFRESH_NEW',
    user: { id: 'user_different', email: 'other@example.test', name: 'Other User' },
  });

  await new Promise((r) => setTimeout(r, 120));
  // Workspace One is still in DOM because state mutation for old session was ignored
  expect(screen.getByRole('heading', { level: 3, name: 'Workspace One' })).toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

it('provides reconnect action for reconnect_required status and connects another workspace', async () => {
  render(<PersonalSlack />);
  await screen.findByText('Workspace Two');

  // Workspace Two has status 'reconnect_required' -> shows badge and reconnect button
  expect(screen.getByText('Cần kết nối lại')).toBeInTheDocument();
  const reconnectBtn = screen.getByRole('button', { name: 'Kết nối lại Workspace Two' });
  expect(reconnectBtn).toBeInTheDocument();

  // Clicking reconnect triggers start with workspaceHint
  fireEvent.click(reconnectBtn);
  await waitFor(() => {
    expect(startCalls.some((c) => c.body?.workspaceHint === 'T_2')).toBe(true);
  });

  // "Kết nối workspace Slack" button exists
  const connectAnotherBtn = screen.getByRole('button', { name: 'Kết nối workspace Slack' });
  expect(connectAnotherBtn).toBeInTheDocument();
});

it('represents actual metadata in headline without claiming tools are live now when all rows processingReady are true', async () => {
  customConnections = [
    {
      id: 'conn_ready',
      workspaceId: 'T_READY',
      workspaceName: 'Ready Workspace',
      slackUserId: 'U_READY',
      slackUserLabel: 'Ready User',
      status: 'active',
      identityVersion: 1,
      scopes: ['channels:read'],
      connectedAt: '2026-10-29T10:00:00.000Z',
      consentStatus: 'granted',
      processingReady: true,
    },
  ];
  render(<PersonalSlack />);
  await screen.findByText('Ready Workspace');
  expect(screen.getByText('Đã sẵn sàng xử lý')).toBeInTheDocument();
  // Unconditional pending claim should NOT be shown
  expect(screen.queryByText(/Chờ cho phép xử lý dữ liệu: ATI chưa đọc tin/)).not.toBeInTheDocument();
  expect(screen.getByText(/Đã sẵn sàng xử lý dữ liệu/)).toBeInTheDocument();
});

it('displays load error with retry button instead of silently hiding when GET fails', async () => {
  let failGet = true;
  const errorServer = createServer(async (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (failGet) {
      res.statusCode = 503;
      res.end(JSON.stringify({ error: 'Service Unavailable' }));
    } else {
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          connections: [
            {
              id: 'c_retry',
              workspaceId: 'T_RETRY',
              workspaceName: 'Retry Workspace',
              slackUserId: 'U1',
              slackUserLabel: 'U1',
              status: 'active',
              identityVersion: 1,
              scopes: [],
              connectedAt: '2026-10-29T10:00:00.000Z',
              consentStatus: 'pending',
              processingReady: false,
            },
          ],
        })
      );
    }
  });
  await new Promise<void>((r) => errorServer.listen(0, '127.0.0.1', r));
  const errOrigin = `http://127.0.0.1:${(errorServer.address() as any).port}`;
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => nativeFetch(new URL(url, errOrigin), init));

  render(<PersonalSlack />);
  const alertEl = await screen.findByRole('alert');
  expect(alertEl).toHaveTextContent(/Không tải được danh sách kết nối Slack/);
  const retryBtn = screen.getByRole('button', { name: /Thử lại/ });
  expect(retryBtn).toBeInTheDocument();

  failGet = false;
  fireEvent.click(retryBtn);
  await screen.findByText('Retry Workspace');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();

  errorServer.closeAllConnections();
  await new Promise<void>((r) => errorServer.close(() => r()));
});
