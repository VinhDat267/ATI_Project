import { StrictMode } from 'react';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { JiraCallbackView } from '../src/views/JiraCallbackView';
import { useRoute } from '../src/hooks/use-route';
import { authStorage } from '../src/services/auth-storage';
import { jiraApi } from '../src/services/jira-api';

let server: Server;
let callbacks: unknown[];
let statuses: number;
let errorCode: string;
let release: () => void;
let hold: boolean;
let extra: Record<string, unknown>;
const nativeFetch = globalThis.fetch;
const user = { id: 'user-jira-1', email: 'alice@example.test', name: 'Alice' };
const navigate = vi.fn();
let responses: Promise<Response>[];

beforeEach(async () => {
  callbacks = [];
  responses = [];
  statuses = 200;
  errorCode = 'JIRA_STATE_INVALID';
  hold = false;
  extra = {};
  navigate.mockReset();
  authStorage.setStoredTokens({ accessToken: 'initial-jira-token', refreshToken: 'initial-jira-refresh', user });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    if (req.url !== '/api/connections/myjira/callback') {
      res.writeHead(404);
      res.end('{}');
      return;
    }
    callbacks.push({
      method: req.method,
      body: JSON.parse(body),
      url: window.location.href,
      authorization: req.headers.authorization,
    });
    if (hold) await gate;
    res.writeHead(statuses, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify(
        statuses === 200
          ? {
              connected: true,
              connectionState: 'connected',
              jiraAccountId: 'jira-acc-1',
              atlassianAccountId: 'atl-acc-1',
              displayName: 'Alice Atlassian',
              siteCount: 1,
              ...extra,
            }
          : { code: errorCode }
      )
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const response = nativeFetch(new URL(url, origin), init).then(async (result) => {
      await result.clone().arrayBuffer();
      return result;
    });
    responses.push(response);
    return response;
  });
  window.history.replaceState({}, '', '/connections/myjira/callback?code=SENTINEL_CODE&state=SENTINEL_STATE#secret');
});

afterEach(async () => {
  release();
  cleanup();
  authStorage.clearStoredTokens();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function Callback() {
  const { route } = useRoute();
  return <JiraCallbackView input={'jiraCallback' in route ? route.jiraCallback : undefined} navigate={navigate} />;
}

const mount = () =>
  render(
    <StrictMode>
      <Callback />
    </StrictMode>
  );

it('scrubs the full query before one authenticated callback, including StrictMode replay', async () => {
  mount();
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/settings#jira', true));
  expect(callbacks).toEqual([
    {
      method: 'POST',
      body: { code: 'SENTINEL_CODE', state: 'SENTINEL_STATE' },
      url: 'http://localhost:3000/connections/myjira/callback',
      authorization: 'Bearer initial-jira-token',
    },
  ]);
  expect(document.body.textContent).not.toMatch(/SENTINEL_CODE|SENTINEL_STATE/);
});

it.each(['JIRA_STATE_INVALID', 'JIRA_CONNECT_FAILED', 'ATLASSIAN_ACCOUNT_IN_USE', 'ACCOUNT_CHANGED', 'INVALID_SESSION'])(
  'shows a useful safe message for %s',
  async (code) => {
    statuses = 400;
    errorCode = code;
    mount();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/kết nối|đăng nhập|Atlassian|tài khoản/i);
    expect(navigate).not.toHaveBeenCalled();
    expect(callbacks).toHaveLength(1);
  }
);

it.each(['logout', 'switch-user', 'new-session', 'unmount'])(
  'does not navigate after %s while the callback is in flight',
  async (change) => {
    hold = true;
    const view = mount();
    await waitFor(() => expect(callbacks).toHaveLength(1));
    act(() => {
      if (change === 'logout') authStorage.clearStoredTokens();
      if (change === 'switch-user')
        authStorage.setStoredTokens({ accessToken: 'b', refreshToken: 'br', user: { ...user, id: 'user-b' } });
      if (change === 'new-session')
        authStorage.setStoredTokens({ accessToken: 'other-session', refreshToken: 'new', user });
      if (change === 'unmount') view.unmount();
      release();
    });
    await act(async () => {
      await Promise.all(responses);
    });
    expect(navigate).not.toHaveBeenCalled();
    expect(callbacks).toHaveLength(1);
  }
);

it('never refreshes or replays the one-use callback on a 401', async () => {
  statuses = 401;
  errorCode = 'INVALID_SESSION';
  await expect(jiraApi.callback('code', 'state')).rejects.toMatchObject({ status: 401 });
  expect(callbacks).toHaveLength(1);
});

it.each(['code=one&code=two&state=state', 'error=access_denied&state=state', 'state=state'])(
  'does not send invalid callback parameters: %s',
  async (query) => {
    window.history.replaceState({}, '', '/connections/myjira/callback?' + query);
    mount();
    await screen.findByRole('alert');
    expect(callbacks).toHaveLength(0);
    expect(navigate).not.toHaveBeenCalled();
  }
);

it('returns to the conversation the connection started from', async () => {
  extra = { returnTo: '/c/11111111-2222-4333-8444-555555555555' };
  mount();
  await waitFor(() =>
    expect(navigate).toHaveBeenCalledWith('/c/11111111-2222-4333-8444-555555555555', true)
  );
  expect(navigate).toHaveBeenCalledTimes(1);
});

it.each([
  'https://evil.example/c/11111111-2222-4333-8444-555555555555',
  '//evil.example',
  '/settings',
  '/c/11111111-2222-4333-8444-555555555555?x=1',
  42,
])('goes to the settings page when the return path is not a conversation: %s', async (returnTo) => {
  extra = { returnTo };
  mount();
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/settings#jira', true));
  expect(navigate).toHaveBeenCalledTimes(1);
});
