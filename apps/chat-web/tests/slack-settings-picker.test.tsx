import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SettingsPage } from '../src/pages/Settings/SettingsPage';
import { outcomeURL, OutcomeLink } from '../src/pages/Cockpit/presentation';
import type { ServiceInfo, User } from '../src/types';

const admin: User = { id: 'admin', name: 'Admin', email: 'admin@localhost.test', role: 'admin' };
const nativeFetch = globalThis.fetch;

describe('Slack Settings channel picker and receipt permalink', () => {
  let server: Server;
  let calls: Array<{ url: string; method: string; body: any }>;
  let slackService: ServiceInfo;
  let candidateResponse: { status: number; body: any };

  beforeEach(async () => {
    window.history.replaceState({}, '', '/settings');
    localStorage.clear();
    calls = [];
    candidateResponse = {
      status: 200,
      body: {
        items: [
          { id: 'C0123456789', label: '#general' },
          { id: 'G0123456789', label: '🔒 dev-ops', warning: 'Bot chưa ở trong kênh: gõ /invite @tên-bot trong kênh này' },
        ],
        truncated: false,
      },
    };
    slackService = {
      id: 'slack',
      name: 'Slack',
      connected: false,
      configured: false,
      connectionStatus: 'unconfigured',
      lastCheckedAt: null,
      tools: ['slack.search_channels', 'slack.send_message', 'slack.read_messages', 'slack.read_thread'],
      allowedScope: [],
      scopeCandidates: true,
      credentialFields: [{ key: 'botToken', label: 'Bot token', type: 'password' }],
      scopeKey: 'channels',
      scopeLabel: 'Channel ID',
    };
    server = createServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      const parsed = body ? JSON.parse(body) : null;
      calls.push({ url: req.url!, method: req.method!, body: parsed });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/services') {
        res.end(JSON.stringify({ services: [slackService], canConfigure: true }));
        return;
      }
      if (req.url === '/api/services/slack/scope-candidates') {
        res.statusCode = candidateResponse.status;
        res.end(JSON.stringify(candidateResponse.body));
        return;
      }
      if (req.url === '/api/services/slack/credentials') {
        slackService = { ...slackService, configured: true, allowedScope: parsed.allowedScope };
        res.end(JSON.stringify({ success: true, message: 'Credentials saved for slack' }));
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    vi.stubGlobal('fetch', (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
      nativeFetch(typeof input === 'string' && input.startsWith('/') ? `${origin}${input}` : input, init),
    );
  });

  afterEach(async () => {
    cleanup();
    vi.unstubAllGlobals();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('loads Slack channels from provider using unsaved botToken, toggles chips, warns on unjoined channel, and saves', async () => {
    render(<SettingsPage user={admin} navigate={() => {}} onLogout={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /Slack —/ }));

    expect(screen.getByTestId('scope-candidate-picker')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Bot token'), { target: { value: 'xoxb-123-new' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tải danh sách' }));

    const privateCheckbox = await screen.findByRole('checkbox', { name: /dev-ops/ });
    expect(calls.some((c) => c.url === '/api/services/slack/scope-candidates' && c.body?.credentials?.botToken === 'xoxb-123-new')).toBe(true);

    fireEvent.click(screen.getByRole('checkbox', { name: /#general/ }));
    fireEvent.click(privateCheckbox);
    expect(screen.getByText(/Có mục đã chọn đang có cảnh báo/)).toBeInTheDocument();

    fireEvent.click(privateCheckbox);
    fireEvent.click(screen.getByRole('button', { name: /Lưu thay đổi/ }));

    await waitFor(() => {
      const save = calls.find((c) => c.url === '/api/services/slack/credentials');
      expect(save?.body?.allowedScope).toEqual(['C0123456789']);
    });
  });

  it('extracts https permalink from slack.send_message output and rejects unsafe links', () => {
    const okStep: any = {
      stepId: 's1',
      tool: 'slack.send_message',
      description: 'Báo Slack',
      status: 'succeeded',
      output: { ts: '1700000000.000100', channel: 'C1', permalink: 'https://acme.slack.com/archives/C1/p1700000000000100' },
    };
    expect(outcomeURL(okStep)).toBe('https://acme.slack.com/archives/C1/p1700000000000100');

    render(<OutcomeLink step={okStep} className="link" />);
    const link = screen.getByRole('link', { name: 'Xem tin' });
    expect(link).toHaveAttribute('href', 'https://acme.slack.com/archives/C1/p1700000000000100');

    expect(outcomeURL({ ...okStep, output: { ts: '1.1', channel: 'C1', permalink: 'javascript:alert(1)' } })).toBeUndefined();
  });
});
