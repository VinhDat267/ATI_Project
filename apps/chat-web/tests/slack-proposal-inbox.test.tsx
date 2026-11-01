import { createServer, type Server } from 'node:http';
import { beforeEach, afterEach, it, expect, vi, describe } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { App } from '../src/App';
import { SlackProposalInbox } from '../src/components/slack/SlackProposalInbox';
import { apiClient } from '../src/services/api-client';
import { authStorage } from '../src/services/auth-storage';

let server: Server;
let requests: Array<{ method?: string; url?: string; body?: any }>;
let proposalsData: any[];
let digestsData: any[];
const nativeFetch = fetch;

const user = { id: 'owner-one', email: 'one@example.test', name: 'One', role: 'member' as const };

beforeEach(async () => {
  requests = [];
  proposalsData = [
    {
      id: 'prop-1',
      connectionId: 'conn-1',
      conversationId: 'conv-1',
      channelId: 'C_ENG',
      threadTs: '1793549000.000100',
      triggerMessageTs: '1793549000.000100',
      status: 'pending',
      revision: '1',
      configVersion: '1',
      reviewExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      activePlanId: null,
      body: {
        decision: {
          kind: 'proposal',
          title: 'Tạo thẻ theo dõi bản phát hành',
          rationale: 'Được nhắc trực tiếp trong kênh kỹ thuật',
          sourceIndices: [0],
          relevance: { kind: 'mention', sourceIndex: 0, evidence: '<@U_ONE>' },
          intents: [{ action: 'task', service: 'trello', summary: 'Chuẩn bị checklist release' }],
        },
        context: [{ ts: '1793549000.000100', user: 'U_LEAD', text: '<@U_ONE> chuẩn bị checklist release nhé' }],
      },
    },
    {
      id: 'prop-stale',
      connectionId: 'conn-1',
      conversationId: 'conv-2',
      channelId: 'C_ENG',
      threadTs: '1793549000.000200',
      triggerMessageTs: '1793549000.000200',
      status: 'stale',
      revision: '2',
      configVersion: '1',
      reviewExpiresAt: new Date(Date.now() - 3600_000).toISOString(),
      activePlanId: null,
      body: null,
    },
  ];
  digestsData = [
    {
      id: 'dig-1',
      connectionId: 'conn-1',
      localDate: '2026-11-02',
      status: 'pending',
      revision: '1',
      configVersion: '1',
      reviewExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      body: {
        localDate: '2026-11-02',
        timezone: 'Asia/Ho_Chi_Minh',
        generatedAt: '2026-11-02T02:05:00.000Z',
        summary: {
          totalProposals: 1,
          pendingCount: 1,
          needsInfoCount: 0,
          awaitingApprovalCount: 0,
          approvedCount: 0,
          rejectedCount: 0,
        },
        items: [
          {
            proposalId: 'prop-1',
            conversationId: 'conv-1',
            channelId: 'C_ENG',
            threadTs: '1793549000.000100',
            title: 'Tạo thẻ theo dõi bản phát hành',
            rationale: 'Được nhắc trực tiếp trong kênh kỹ thuật',
            status: 'pending',
            actions: [{ action: 'task', service: 'trello', summary: 'Chuẩn bị checklist release' }],
          },
        ],
      },
    },
  ];

  authStorage.setStoredTokens({
    accessToken: 'token-one',
    refreshToken: 'refresh-one',
    user,
  });

  server = createServer(async (req, res) => {
    let raw = '';
    for await (const part of req) raw += part;
    const body = raw ? JSON.parse(raw) : undefined;
    requests.push({ method: req.method, url: req.url, body });
    res.setHeader('content-type', 'application/json');

    if (req.url === '/api/connections/myslack') {
      res.end(
        JSON.stringify({
          connections: [
            {
              id: 'conn-1',
              workspaceId: 'T_ONE',
              workspaceName: 'Workspace Một',
              slackUserId: 'U_ONE',
              slackUserLabel: 'One',
              actorId: 'U_ONE',
              status: 'active',
              identityVersion: 1,
              connectedAt: new Date().toISOString(),
              scopes: [],
              consentStatus: 'granted',
              processingReady: true,
            },
          ],
        }),
      );
      return;
    }
    if (req.url?.startsWith('/api/slack/proposals') && req.method === 'GET') {
      res.end(JSON.stringify({ proposals: proposalsData }));
      return;
    }
    if (req.url?.startsWith('/api/slack/digests') && req.method === 'GET') {
      res.end(JSON.stringify({ digests: digestsData }));
      return;
    }
    if (req.url === '/api/slack/proposals/prop-1/refine' && req.method === 'POST') {
      proposalsData[0] = { ...proposalsData[0], revision: '2' };
      res.end(JSON.stringify({ conversationId: 'conv-1', proposal: proposalsData[0] }));
      return;
    }
    if (req.url === '/api/slack/proposals/prop-1/prepare' && req.method === 'POST') {
      proposalsData[0] = {
        ...proposalsData[0],
        status: 'awaiting_approval',
        revision: '2',
        activePlanId: 'plan-101',
      };
      res.end(
        JSON.stringify({
          status: 'awaiting_approval',
          proposal: proposalsData[0],
          plan: {
            id: 'plan-101',
            planHash: 'hash-101',
            summary: 'Tạo thẻ theo dõi bản phát hành và phản hồi thread',
            steps: [
              { id: 'step_1', action: 'trello.create_card', description: 'Tạo thẻ: Tạo thẻ theo dõi bản phát hành' },
              { id: 'step_2', action: 'myslack.reply_in_thread', description: 'Phản hồi vào đúng thread gốc với liên kết kết quả' },
            ],
          },
        }),
      );
      return;
    }
    if (req.url === '/api/plans/plan-101/approve' && req.method === 'POST') {
      res.end(JSON.stringify({ status: 202, planId: 'plan-101', executionStatus: 'executing' }));
      return;
    }
    if (req.url === '/api/slack/proposals/prop-1/reject' && req.method === 'POST') {
      proposalsData[0] = { ...proposalsData[0], status: 'rejected', revision: '3', activePlanId: null };
      res.end(JSON.stringify({ proposal: proposalsData[0] }));
      return;
    }
    if (req.url === '/api/slack/digests/dig-1/refresh-status' && req.method === 'POST') {
      digestsData[0] = {
        ...digestsData[0],
        revision: '2',
        body: {
          ...digestsData[0].body,
          summary: {
            ...digestsData[0].body.summary,
            pendingCount: 0,
            rejectedCount: 1,
          },
          items: [{ ...digestsData[0].body.items[0], status: 'rejected' }],
        },
      };
      res.end(JSON.stringify({ digest: digestsData[0] }));
      return;
    }
    res.end(JSON.stringify({}));
  });

  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + (server.address() as any).port;
  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => nativeFetch(new URL(path, url), init));
});

afterEach(async () => {
  cleanup();
  authStorage.clearStoredTokens();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

describe('SLACK-06A & SLACK-06B SlackProposalInbox UI and /inbox route', () => {
  it('renders proposals, hides redacted/stale body safely, previews & approves cross-service plan, rejects with CAS, and refreshes daily digest', async () => {
    const navigate = vi.fn();
    render(<SlackProposalInbox user={user} navigate={navigate} onLogout={vi.fn()} />);

    // Waits for workspace connection and proposal card
    expect(await screen.findByText('Tạo thẻ theo dõi bản phát hành')).toBeInTheDocument();
    expect(screen.getByText(/<@U_ONE> chuẩn bị checklist release nhé/)).toBeInTheDocument();

    // Redacted/stale proposal does not render stale body content and shows safe notice
    expect(screen.getByText(/Nguồn tin nhắn đã thay đổi hoặc hết hạn xem lại/)).toBeInTheDocument();

    // Refine in chat triggers CAS POST and navigates to /c/conv-1
    fireEvent.click(screen.getByRole('button', { name: 'Trao đổi thêm trong Chat' }));
    await waitFor(() =>
      expect(requests.some((r) => r.url === '/api/slack/proposals/prop-1/refine' && r.body?.expectedRevision === 1)).toBe(true),
    );
    expect(navigate).toHaveBeenCalledWith('/c/conv-1');

    // Prepare plan with thread reply checkbox
    const replyCheckbox = screen.getByLabelText('Phản hồi lại vào thread nguồn kèm liên kết kết quả');
    expect(replyCheckbox).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Xem trước kế hoạch' }));
    await waitFor(() =>
      expect(
        requests.some(
          (r) =>
            r.url === '/api/slack/proposals/prop-1/prepare' &&
            r.body?.expectedRevision === 2 &&
            r.body?.replyInThread === true,
        ),
      ).toBe(true),
    );

    // Shows plan preview steps and approve button
    expect(await screen.findByText('Phản hồi vào đúng thread gốc với liên kết kết quả')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Phê duyệt và thực thi' }));
    await waitFor(() => expect(requests.some((r) => r.url === '/api/plans/plan-101/approve')).toBe(true));

    // Reject proposal
    fireEvent.click(screen.getByRole('button', { name: 'Từ chối đề xuất' }));
    await waitFor(() =>
      expect(requests.some((r) => r.url === '/api/slack/proposals/prop-1/reject')).toBe(true),
    );

    // Daily digest is rendered and Refresh status updates digest counts
    expect(screen.getByText(/Bản tóm tắt ngày 2026-11-02/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Làm mới trạng thái' }));
    await waitFor(() =>
      expect(requests.some((r) => r.url === '/api/slack/digests/dig-1/refresh-status')).toBe(true),
    );
    expect(await screen.findByText(/1 đã từ chối/)).toBeInTheDocument();
  });

  it('mounts /inbox route inside App when authenticated and clears state on account switch', async () => {
    window.history.replaceState({}, '', '/inbox');
    vi.spyOn(apiClient, 'getRuntime').mockResolvedValue({ runtimeMode: 'sandbox' });
    vi.spyOn(apiClient, 'getMe').mockResolvedValue({ user });

    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Hộp thư đề xuất & Bản tóm tắt' })).toBeInTheDocument();
    expect(await screen.findByText('Tạo thẻ theo dõi bản phát hành')).toBeInTheDocument();

    act(() =>
      authStorage.setStoredTokens({
        accessToken: 'token-two',
        refreshToken: 'refresh-two',
        user: { id: 'owner-two', email: 'two@example.test', name: 'Two' },
      }),
    );
    expect(screen.queryByText('Tạo thẻ theo dõi bản phát hành')).not.toBeInTheDocument();
  });
});
