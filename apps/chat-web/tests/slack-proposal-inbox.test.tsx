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
      convId: 'conv-1',
      status: 'pending',
      revision: '1',
      activePlanId: null,
      planHash: null,
      createdAt: '2026-11-02T01:00:00.000Z',
      body: {
        artifactId: 'prop-1',
        configVersion: '1',
        payloadRevision: '1',
        truncated: false,
        decision: {
          kind: 'proposal',
          title: 'Tạo thẻ theo dõi bản phát hành',
          rationale: 'Được nhắc trực tiếp trong kênh kỹ thuật',
          sourceIndices: [0],
          relevance: { kind: 'mention', sourceIndex: 0, evidence: '<@U_ONE>' },
          intents: [{ action: 'task', service: 'trello', summary: 'Chuẩn bị checklist release' }],
        },
        context: [
          {
            channelId: 'C_ENG',
            ts: '1793549000.000100',
            threadTs: '1793549000.000100',
            user: 'U_LEAD',
            text: '<@U_ONE> chuẩn bị checklist release nhé',
          },
        ],
      },
    },
    {
      id: 'prop-clarify',
      connectionId: 'conn-1',
      convId: 'conv-clarify',
      status: 'needs_info',
      revision: '1',
      activePlanId: null,
      planHash: null,
      createdAt: '2026-11-02T01:10:00.000Z',
      body: {
        artifactId: 'prop-clarify',
        configVersion: '1',
        payloadRevision: '1',
        truncated: false,
        decision: {
          kind: 'needs_clarification',
          title: 'Báo cáo chiến dịch',
          rationale: 'Thời hạn chưa cụ thể trong tin nhắn',
          sourceIndices: [0],
          relevance: { kind: 'mention', sourceIndex: 0, evidence: '<@U_ONE>' },
          question: 'Vui lòng cho biết hạn chót cụ thể của báo cáo chiến dịch.',
        },
        context: [
          {
            channelId: 'C_MKT',
            ts: '1793549000.000150',
            threadTs: '1793549000.000150',
            user: 'U_PM',
            text: '<@U_ONE> gửi báo cáo chiến dịch vào tuần sau nhé',
          },
        ],
      },
    },
    {
      id: 'prop-stale',
      connectionId: 'conn-1',
      convId: 'conv-2',
      status: 'stale',
      revision: '2',
      activePlanId: null,
      planHash: null,
      createdAt: '2026-11-02T00:00:00.000Z',
      body: null,
    },
  ];
  digestsData = [
    {
      id: 'dig-1',
      connectionId: 'conn-1',
      localDate: '2026-11-02',
      status: 'completed',
      revision: '1',
      createdAt: '2026-11-02T02:05:00.000Z',
      body: {
        artifactId: 'dig-1',
        localDate: '2026-11-02',
        timezone: 'Asia/Ho_Chi_Minh',
        summary: 'Tổng hợp 2 đề xuất ngày 2026-11-02',
        entries: [
          {
            proposalId: 'prop-1',
            title: 'Tạo thẻ theo dõi bản phát hành',
            rationale: 'Được nhắc trực tiếp trong kênh kỹ thuật',
            status: 'pending',
            createdAt: '2026-11-02T01:00:00.000Z',
          },
          {
            proposalId: 'prop-clarify',
            title: 'Báo cáo chiến dịch',
            rationale: 'Thời hạn chưa cụ thể trong tin nhắn',
            status: 'needs_info',
            createdAt: '2026-11-02T01:10:00.000Z',
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
        planHash: 'a'.repeat(64),
      };
      res.end(
        JSON.stringify({
          status: 'awaiting_approval',
          planId: 'plan-101',
          planHash: 'a'.repeat(64),
          proposal: proposalsData[0],
          plan: {
            kind: 'plan',
            thinking: 'Tạo thẻ và phản hồi thread',
            summary: 'Tạo thẻ theo dõi bản phát hành và phản hồi thread',
            warnings: ['Chỉ thực thi sau khi bạn phê duyệt.'],
            steps: [
              {
                id: 'step_1',
                tool: 'trello.create_card',
                description: 'Tạo thẻ: Tạo thẻ theo dõi bản phát hành',
                args: {},
                dependsOn: [],
              },
              {
                id: 'step_2',
                tool: 'myslack.chat_postMessage',
                description: 'Phản hồi vào đúng thread gốc với liên kết kết quả',
                args: {},
                dependsOn: ['step_1'],
              },
            ],
          },
        }),
      );
      return;
    }
    if (req.url === '/api/slack/proposals/prop-clarify/prepare' && req.method === 'POST') {
      proposalsData[1] = {
        ...proposalsData[1],
        status: 'needs_info',
        revision: '2',
        activePlanId: null,
      };
      res.end(
        JSON.stringify({
          status: 'needs_info',
          clarification:
            'Tin nhắn Slack có nhắc thời hạn chưa cụ thể. Vui lòng chọn ngày hạn chót (YYYY-MM-DD) hoặc xác nhận tạo việc không gắn hạn chót.',
          proposal: proposalsData[1],
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
      res.end(JSON.stringify({ status: 'rejected', revision: '3', proposal: proposalsData[0] }));
      return;
    }
    if (req.url === '/api/slack/digests/dig-1/refresh-status' && req.method === 'POST') {
      digestsData[0] = {
        ...digestsData[0],
        revision: '2',
        body: {
          ...digestsData[0].body,
          entries: [
            { ...digestsData[0].body.entries[0], status: 'rejected' },
            digestsData[0].body.entries[1],
          ],
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
    expect(screen.getByText(/Kênh C_ENG · Phiên bản 1/)).toBeInTheDocument();
    expect(screen.getByText(/<@U_ONE> chuẩn bị checklist release nhé/)).toBeInTheDocument();

    // Renders needs_clarification proposal without intents array crash and shows its question
    expect(screen.getByText('Vui lòng cho biết hạn chót cụ thể của báo cáo chiến dịch.')).toBeInTheDocument();

    // Redacted/stale proposal does not render stale body content and shows safe notice
    expect(screen.getByText(/Nguồn tin nhắn đã thay đổi hoặc hết hạn xem lại/)).toBeInTheDocument();

    // Refine in chat triggers CAS POST and navigates to /c/conv-1
    fireEvent.click(screen.getAllByRole('button', { name: 'Trao đổi thêm trong Chat' })[0]);
    await waitFor(() =>
      expect(requests.some((r) => r.url === '/api/slack/proposals/prop-1/refine' && r.body?.expectedRevision === 1)).toBe(true),
    );
    expect(navigate).toHaveBeenCalledWith('/c/conv-1');

    // Prepare plan with thread reply checkbox on prop-1
    const replyCheckbox = screen.getAllByLabelText('Phản hồi lại vào thread nguồn kèm liên kết kết quả')[0];
    expect(replyCheckbox).toBeChecked();
    fireEvent.click(screen.getAllByRole('button', { name: 'Xem trước kế hoạch' })[0]);
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

    // Prepare on prop-clarify returns backend `clarification` field and displays it
    fireEvent.click(screen.getAllByRole('button', { name: 'Xem trước kế hoạch' })[1]);
    expect(
      await screen.findByText(/Tin nhắn Slack có nhắc thời hạn chưa cụ thể\. Vui lòng chọn ngày hạn chót/),
    ).toBeInTheDocument();

    // Reject proposal prop-1
    fireEvent.click(screen.getAllByRole('button', { name: 'Từ chối đề xuất' })[0]);
    await waitFor(() =>
      expect(requests.some((r) => r.url === '/api/slack/proposals/prop-1/reject')).toBe(true),
    );

    // Daily digest is rendered from backend `entries` + string `summary`, and Refresh status updates digest counts
    expect(screen.getByText(/Bản tóm tắt ngày 2026-11-02/)).toBeInTheDocument();
    expect(screen.getByText(/Tổng hợp 2 đề xuất ngày 2026-11-02/)).toBeInTheDocument();
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
