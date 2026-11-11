/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { StrictMode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { NotionConnection } from '../src/pages/Settings/NotionConnection';
import { NotionCallbackView } from '../src/views/NotionCallbackView';
import { apiClient } from '../src/services/api-client';
import { PlanMoment } from '../src/pages/Cockpit/PlanMoment';
import { ResponseMoment } from '../src/pages/Responses/ResponseMoment';
import { ReceiptMoment } from '../src/pages/Cockpit/ReceiptMoment';
import { ScheduleMoment } from '../src/pages/Cockpit/ScheduleMoment';
import { RecoveryMoment } from '../src/pages/Cockpit/RecoveryMoment';
import { PreviewContents } from '../src/pages/Cockpit/PreviewContents';
import { ExecutionProgress } from '../src/components/ExecutionProgress';
import { resourceDestination } from '../src/components/Cockpit';
import { operation } from '../src/pages/Cockpit/presentation';
import { SettingsPage } from '../src/pages/Settings/SettingsPage';
import { notionConnectionNotice, extractNotionDatabaseIdClient } from '../src/services/notion-connection';
import { authStorage } from '../src/services/auth-storage';
import type { ActivePlan, User } from '../src/types';

describe('Task 5: Notion OAuth 1-Click UI, Callback View, and Chat Moments', () => {
  const memberUser: User = { id: 'u-member', email: 'member@example.com', name: 'Member', role: 'member' };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  describe('1. NotionConnection component', () => {
    it('renders not_connected with button #notion-connect labeled "Kết nối Notion" and no token inputs', async () => {
      vi.spyOn(apiClient, 'getNotionConnection').mockResolvedValue({
        available: true,
        status: 'not_connected',
        connections: [],
      });

      render(<NotionConnection user={memberUser} refresh={vi.fn()} />);

      expect(await screen.findByText('Chưa kết nối')).toBeInTheDocument();
      const connectBtn = screen.getByRole('button', { name: 'Kết nối Notion' });
      expect(connectBtn).toBeInTheDocument();
      expect(connectBtn).toHaveAttribute('id', 'notion-connect');
      expect(document.querySelector('input[name="token"]')).toBeNull();
    });

    it('renders needs_scope with candidate databases, paste Notion database link/UUID, and saves selected databases', async () => {
      const db1 = '11111111-2222-3333-4444-555555555555';
      const dbPasted = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      vi.spyOn(apiClient, 'getNotionConnection').mockResolvedValue({
        available: true,
        status: 'needs_scope',
        activeConnectionId: 'conn-notion-1',
        workspaceId: 'ws-1',
        workspaceName: 'Acme Notion',
        botId: 'bot-1',
        selectedDatabases: [],
        connections: [
          {
            id: 'conn-notion-1',
            status: 'needs_scope',
            workspaceId: 'ws-1',
            workspaceName: 'Acme Notion',
            botId: 'bot-1',
            isActive: true,
            selectedDatabases: [],
          },
        ],
      });
      vi.spyOn(apiClient, 'getNotionDatabases').mockResolvedValue({
        databases: [
          { id: db1, title: 'Roadmap 2026', url: 'https://www.notion.so/11111111222233334444555555555555' },
        ],
      });
      const saveScopeSpy = vi.spyOn(apiClient, 'saveNotionScope').mockResolvedValue({
        available: true,
        status: 'connected',
        activeConnectionId: 'conn-notion-1',
        workspaceId: 'ws-1',
        workspaceName: 'Acme Notion',
        botId: 'bot-1',
        selectedDatabases: [
          { id: db1, title: 'Roadmap 2026' },
          { id: dbPasted, title: `Database ${dbPasted.slice(0, 8)}` },
        ],
        connections: [],
      });

      render(<NotionConnection user={memberUser} refresh={vi.fn()} />);

      const scopeArea = await screen.findByTestId('notion-scope');
      expect(scopeArea).toBeInTheDocument();
      expect(scopeArea).toHaveAttribute('id', 'notion-scope');
      expect(await screen.findByTestId('notion-scope-counter')).toHaveTextContent('Đã chọn 0/10');

      const db1Checkbox = await screen.findByRole('checkbox', { name: /Roadmap 2026/i });
      fireEvent.click(db1Checkbox);
      expect(db1Checkbox).toBeChecked();

      // Paste a Notion URL containing a 32-hex ID
      const pasteInput = screen.getByPlaceholderText(/Dán link hoặc ID Database Notion/i);
      const addBtn = screen.getByRole('button', { name: /Thêm database/i });
      fireEvent.change(pasteInput, {
        target: { value: 'https://www.notion.so/myworkspace/Tasks-aaaaaaaabbbbccccddddeeeeeeeeeeee?v=123' },
      });
      fireEvent.click(addBtn);

      expect(await screen.findByTestId('notion-scope-counter')).toHaveTextContent('Đã chọn 2/10');

      const saveBtn = screen.getByRole('button', { name: /Lưu phạm vi database/i });
      expect(saveBtn).toHaveAttribute('id', 'notion-save-scope');
      expect(saveBtn).not.toBeDisabled();
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(saveScopeSpy).toHaveBeenCalledWith(
          'conn-notion-1',
          expect.arrayContaining([
            expect.objectContaining({ id: db1, title: 'Roadmap 2026' }),
            expect.objectContaining({ id: dbPasted }),
          ])
        );
      });
    });

    it('supports switching active workspace when multiple Notion workspaces are connected', async () => {
      vi.spyOn(apiClient, 'getNotionConnection').mockResolvedValue({
        available: true,
        status: 'connected',
        activeConnectionId: 'conn-1',
        workspaceId: 'ws-1',
        workspaceName: 'Workspace Alpha',
        botId: 'bot-1',
        selectedDatabases: [{ id: '11111111-2222-3333-4444-555555555555', title: 'Tasks Alpha' }],
        connections: [
          {
            id: 'conn-1',
            status: 'connected',
            workspaceId: 'ws-1',
            workspaceName: 'Workspace Alpha',
            botId: 'bot-1',
            isActive: true,
            selectedDatabases: [{ id: '11111111-2222-3333-4444-555555555555', title: 'Tasks Alpha' }],
          },
          {
            id: 'conn-2',
            status: 'connected',
            workspaceId: 'ws-2',
            workspaceName: 'Workspace Beta',
            botId: 'bot-2',
            isActive: false,
            selectedDatabases: [{ id: '22222222-3333-4444-5555-666666666666', title: 'Tasks Beta' }],
          },
        ],
      });
      const activateSpy = vi.spyOn(apiClient, 'activateNotionConnection').mockResolvedValue({
        available: true,
        status: 'connected',
        activeConnectionId: 'conn-2',
        workspaceId: 'ws-2',
        workspaceName: 'Workspace Beta',
        botId: 'bot-2',
        selectedDatabases: [{ id: '22222222-3333-4444-5555-666666666666', title: 'Tasks Beta' }],
        connections: [],
      });

      render(<NotionConnection user={memberUser} refresh={vi.fn()} />);

      expect(await screen.findByText('Đã kết nối · Workspace Alpha')).toBeInTheDocument();
      const wsSelect = screen.getByLabelText(/Workspace đang dùng/i);
      fireEvent.change(wsSelect, { target: { value: 'conn-2' } });

      await waitFor(() => {
        expect(activateSpy).toHaveBeenCalledWith('conn-2');
      });
    });

    it('displays notionConnectionNotice when user opens settings after connecting', async () => {
      vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        if (url === '/api/services') return new Response(JSON.stringify({ services: [], canConfigure: false }));
        throw new Error(`Unexpected endpoint: ${url}`);
      }));
      vi.spyOn(apiClient, 'getTrelloConnection').mockResolvedValue({ status: 'not_connected', boards: [] });
      vi.spyOn(apiClient, 'getGitHubConnection').mockResolvedValue({ status: 'not_connected', repos: [] });
      vi.spyOn(apiClient, 'getNotionConnection').mockResolvedValue({
        available: true,
        status: 'not_connected',
        connections: [],
      });
      authStorage.setStoredTokens({ user: memberUser });
      notionConnectionNotice.set('Acme Notion');

      render(<SettingsPage user={memberUser} navigate={vi.fn()} onLogout={vi.fn()} />);

      expect(await screen.findByText('Đã kết nối Notion: Acme Notion')).toBeInTheDocument();
    });

    it('renders distinct disconnect semantics for providerRevocation confirmed vs unconfirmed (with Notion integration removal guidance)', async () => {
      const getSpy = vi
        .spyOn(apiClient, 'getNotionConnection')
        .mockResolvedValueOnce({
          available: true,
          status: 'connected',
          activeConnectionId: 'conn-disc-1',
          workspaceId: 'ws-1',
          workspaceName: 'Acme Notion',
          botId: 'bot-1',
          selectedDatabases: [{ id: '11111111-2222-3333-4444-555555555555', title: 'Roadmap' }],
          connections: [
            {
              id: 'conn-disc-1',
              status: 'connected',
              workspaceId: 'ws-1',
              workspaceName: 'Acme Notion',
              botId: 'bot-1',
              isActive: true,
              selectedDatabases: [{ id: '11111111-2222-3333-4444-555555555555', title: 'Roadmap' }],
            },
          ],
        })
        .mockResolvedValueOnce({
          available: true,
          status: 'not_connected',
          connections: [],
        });

      vi.spyOn(apiClient, 'disconnectNotionConnection').mockResolvedValueOnce({
        disconnected: true,
        status: 'disconnected',
        toolsAvailable: false,
        providerRevocation: 'confirmed',
      } as any);

      const { unmount } = render(<NotionConnection user={memberUser} refresh={vi.fn()} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Ngắt kết nối' }));
      fireEvent.click(screen.getByRole('button', { name: 'Xác nhận ngắt' }));

      expect(
        await screen.findByText(/Đã ngắt kết nối Notion và thu hồi quyền truy cập từ Notion/i),
      ).toBeInTheDocument();
      expect(screen.queryByTestId('notion-revoke-unconfirmed')).toBeNull();
      unmount();

      // Case 2: providerRevocation === 'unconfirmed' -> shows local disconnect success + separate Notion manual removal guidance
      getSpy
        .mockResolvedValueOnce({
          available: true,
          status: 'connected',
          activeConnectionId: 'conn-disc-2',
          workspaceId: 'ws-2',
          workspaceName: 'Ops Notion',
          botId: 'bot-2',
          selectedDatabases: [{ id: '22222222-3333-4444-5555-666666666666', title: 'Ops DB' }],
          connections: [
            {
              id: 'conn-disc-2',
              status: 'connected',
              workspaceId: 'ws-2',
              workspaceName: 'Ops Notion',
              botId: 'bot-2',
              isActive: true,
              selectedDatabases: [{ id: '22222222-3333-4444-5555-666666666666', title: 'Ops DB' }],
            },
          ],
        })
        .mockResolvedValueOnce({
          available: true,
          status: 'not_connected',
          connections: [],
        });

      vi.spyOn(apiClient, 'disconnectNotionConnection').mockResolvedValueOnce({
        disconnected: true,
        status: 'disconnected',
        toolsAvailable: false,
        providerRevocation: 'unconfirmed',
      } as any);

      render(<NotionConnection user={memberUser} refresh={vi.fn()} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Ngắt kết nối' }));
      fireEvent.click(screen.getByRole('button', { name: 'Xác nhận ngắt' }));

      expect(await screen.findByText(/Đã ngắt kết nối Notion trên hệ thống/i)).toBeInTheDocument();
      const unconfirmedWarning = await screen.findByTestId('notion-revoke-unconfirmed');
      expect(unconfirmedWarning).toBeInTheDocument();
      expect(unconfirmedWarning).toHaveTextContent(/Settings|Connections|gỡ tích hợp/i);
      expect(
        screen.queryByText(/Đã ngắt kết nối Notion và thu hồi quyền truy cập từ Notion/i),
      ).toBeNull();
    });

    it('renders non-secret reconnect diagnostics and explicit check recovery button when authFailureCode is refresh_retryable', async () => {
      vi.spyOn(apiClient, 'getNotionConnection')
        .mockResolvedValueOnce({
          available: true,
          status: 'reconnect_required',
          activeConnectionId: 'conn-retry-1',
          workspaceId: 'ws-retry',
          workspaceName: 'Retry Workspace',
          authFailureCode: 'refresh_retryable',
          connections: [
            {
              id: 'conn-retry-1',
              status: 'reconnect_required',
              workspaceId: 'ws-retry',
              workspaceName: 'Retry Workspace',
              botId: 'bot-retry',
              isActive: true,
              authFailureCode: 'refresh_retryable',
              selectedDatabases: [],
            } as any,
          ],
        } as any)
        .mockResolvedValueOnce({
          available: true,
          status: 'connected',
          activeConnectionId: 'conn-retry-1',
          workspaceId: 'ws-retry',
          workspaceName: 'Retry Workspace',
          selectedDatabases: [{ id: '11111111-2222-3333-4444-555555555555', title: 'Roadmap' }],
          connections: [],
        } as any);

      const checkSpy = vi.spyOn(apiClient, 'checkNotionConnection').mockResolvedValueOnce({
        status: 'connected',
        healthStatus: 'healthy',
        latencyMs: 42,
      } as any);

      render(<NotionConnection user={memberUser} refresh={vi.fn()} />);

      expect(await screen.findByTestId('notion-auth-diagnostic')).toHaveTextContent(
        /làm mới phiên tạm thời gián đoạn|Kiểm tra/i,
      );
      const checkBtn = screen.getByRole('button', { name: /Kiểm tra/i });
      expect(checkBtn).toHaveAttribute('id', 'notion-check');
      fireEvent.click(checkBtn);

      await waitFor(() => {
        expect(checkSpy).toHaveBeenCalledWith('conn-retry-1');
      });
    });

    it('refetches status, hides #notion-check, and displays rotation_unknown diagnostic when explicit check recovery fails with 409', async () => {
      const getSpy = vi
        .spyOn(apiClient, 'getNotionConnection')
        .mockResolvedValueOnce({
          available: true,
          status: 'reconnect_required',
          activeConnectionId: 'conn-interrupted-1',
          workspaceId: 'ws-int',
          workspaceName: 'Interrupted Workspace',
          authFailureCode: 'refresh_retryable',
          connections: [
            {
              id: 'conn-interrupted-1',
              status: 'reconnect_required',
              workspaceId: 'ws-int',
              workspaceName: 'Interrupted Workspace',
              botId: 'bot-int',
              isActive: true,
              authFailureCode: 'refresh_retryable',
              selectedDatabases: [],
            } as any,
          ],
        } as any)
        .mockResolvedValueOnce({
          available: true,
          status: 'reconnect_required',
          activeConnectionId: 'conn-interrupted-1',
          workspaceId: 'ws-int',
          workspaceName: 'Interrupted Workspace',
          authFailureCode: 'rotation_unknown',
          connections: [
            {
              id: 'conn-interrupted-1',
              status: 'reconnect_required',
              workspaceId: 'ws-int',
              workspaceName: 'Interrupted Workspace',
              botId: 'bot-int',
              isActive: true,
              authFailureCode: 'rotation_unknown',
              selectedDatabases: [],
            } as any,
          ],
        } as any);

      const checkSpy = vi
        .spyOn(apiClient, 'checkNotionConnection')
        .mockRejectedValueOnce(new Error('Phiên làm mới Notion trước đó bị gián đoạn. Vui lòng kết nối lại.'));

      render(<NotionConnection user={memberUser} refresh={vi.fn()} />);

      expect(await screen.findByTestId('notion-auth-diagnostic')).toHaveTextContent(
        /làm mới phiên tạm thời gián đoạn/i,
      );
      const checkBtn = screen.getByRole('button', { name: /Kiểm tra/i });
      expect(checkBtn).toHaveAttribute('id', 'notion-check');
      fireEvent.click(checkBtn);

      await waitFor(() => {
        expect(checkSpy).toHaveBeenCalledWith('conn-interrupted-1');
        expect(getSpy).toHaveBeenCalledTimes(2);
      });

      await waitFor(() => {
        expect(document.querySelector('#notion-check')).toBeNull();
        expect(screen.getByTestId('notion-auth-diagnostic')).toHaveTextContent(
          /Không xác nhận được trạng thái làm mới token từ Notion/i,
        );
      });
      expect(screen.getByRole('button', { name: /Kết nối lại Notion/i })).toHaveAttribute('id', 'notion-connect');
    });
  });

  describe('2. NotionCallbackView', () => {
    it('completes OAuth callback and navigates back to conversation when returnTo is valid and status is connected', async () => {
      vi.spyOn(apiClient, 'completeNotionConnection').mockResolvedValue({
        available: true,
        status: 'connected',
        activeConnectionId: 'conn-1',
        workspaceId: 'ws-1',
        workspaceName: 'Acme Notion',
        returnTo: '/c/11111111-2222-3333-4444-555555555555',
        connections: [],
      });
      const navSpy = vi.fn();

      render(
        <NotionCallbackView
          input={{ code: 'code-123', state: 'state-456' }}
          navigate={navSpy}
        />
      );

      await waitFor(() => {
        expect(navSpy).toHaveBeenCalledWith('/c/11111111-2222-3333-4444-555555555555', true);
      });
    });

    it('redirects to /settings#notion when status is needs_scope', async () => {
      vi.spyOn(apiClient, 'completeNotionConnection').mockResolvedValue({
        available: true,
        status: 'needs_scope',
        activeConnectionId: 'conn-1',
        workspaceId: 'ws-1',
        workspaceName: 'Acme Notion',
        connections: [],
      });
      const navSpy = vi.fn();

      render(
        <NotionCallbackView
          input={{ code: 'code-123', state: 'state-456' }}
          navigate={navSpy}
        />
      );

      await waitFor(() => {
        expect(navSpy).toHaveBeenCalledWith('/settings#notion', true);
      });
    });

    it('completes under React StrictMode and maps error code when err.data contains both error and code', async () => {
      vi.spyOn(apiClient, 'completeNotionConnection').mockResolvedValueOnce({
        available: true,
        status: 'connected',
        activeConnectionId: 'conn-1',
        workspaceId: 'ws-1',
        workspaceName: 'StrictMode Workspace',
        connections: [],
      });
      const navSpy = vi.fn();

      const { unmount } = render(
        <StrictMode>
          <NotionCallbackView
            input={{ code: 'code-strict', state: 'state-strict' }}
            navigate={navSpy}
          />
        </StrictMode>
      );

      await waitFor(() => {
        expect(navSpy).toHaveBeenCalledWith('/settings#notion', true);
      });
      unmount();

      vi.spyOn(apiClient, 'completeNotionConnection').mockRejectedValueOnce({
        status: 400,
        data: {
          error: 'Phiên xác thực Notion không hợp lệ hoặc đã hết hạn.',
          code: 'NOTION_STATE_INVALID',
        },
      });

      render(
        <NotionCallbackView
          input={{ code: 'code-expired', state: 'state-expired' }}
          navigate={vi.fn()}
        />
      );

      expect(
        await screen.findByText('Phiên kết nối Notion đã hết hạn hoặc không hợp lệ. Vui lòng thử lại.')
      ).toBeInTheDocument();
    });
  });

  describe('3. Chat refusal, PlanMoment, ReceiptMoment, and ScheduleMoment with Notion', () => {
    it('refusal with unavailableServices notion renders #notion-connect calling startNotionConnection and enables resend when connected', async () => {
      const startSpy = vi.spyOn(apiClient, 'startNotionConnection').mockResolvedValue({
        url: 'https://api.notion.com/v1/oauth/authorize?state=xyz',
      });
      const assignMock = vi.fn();
      vi.stubGlobal('location', { ...window.location, assign: assignMock, protocol: 'http:', hostname: 'localhost' });
      const onResendSpy = vi.fn();

      const { unmount } = render(
        <ResponseMoment
          request="Tạo trang mới trên Notion Roadmap"
          conversationId="11111111-2222-3333-4444-555555555555"
          unavailableServices={[{ id: 'notion', name: 'Notion' }]}
          reason="Notion cần được kết nối trước khi dùng."
          services={[]}
          connectFromChat={false}
          navigate={vi.fn()}
        />
      );

      const connectBtn = await screen.findByRole('link', { name: /Kết nối Notion/i });
      expect(connectBtn).toHaveAttribute('id', 'notion-connect');

      fireEvent.click(connectBtn);
      await waitFor(() => {
        expect(startSpy).toHaveBeenCalledWith({
          returnTo: '/c/11111111-2222-3333-4444-555555555555',
        });
      });

      unmount();

      render(
        <ResponseMoment
          request="Tạo trang mới trên Notion Roadmap"
          conversationId="11111111-2222-3333-4444-555555555555"
          unavailableServices={[{ id: 'notion', name: 'Notion' }]}
          reason="Notion cần được kết nối trước khi dùng."
          services={[
            {
              id: 'notion',
              name: 'Notion',
              configured: false,
              connected: false,
              tools: [],
              personalStatus: 'connected',
              workspaceName: 'Acme Notion',
            } as any,
          ]}
          connectFromChat={false}
          navigate={vi.fn()}
          onResend={onResendSpy}
        />
      );

      expect(await screen.findByText(/Đã kết nối · Acme Notion/)).toBeInTheDocument();
      const resendBtn = screen.getByRole('button', { name: 'Gửi lại yêu cầu' });
      fireEvent.click(resendBtn);
      expect(onResendSpy).toHaveBeenCalledWith('Tạo trang mới trên Notion Roadmap');
    });

    it('PlanMoment and ReceiptMoment display Notion workspaceName and database labels', () => {
      const dbId = '11111111-2222-3333-4444-555555555555';
      const plan: ActivePlan = {
        summary: 'Tạo trang trên Notion',
        steps: [
          {
            id: 's1',
            tool: 'notion.create_page',
            description: 'Tạo trang ghi chú',
            databaseId: dbId,
            args: { databaseId: dbId, title: 'Sprint Review' },
            dependsOn: [],
          },
        ],
        connections: {
          notion: {
            credentialId: 'cred-notion-1',
            workspaceId: 'ws-1',
            workspaceName: 'Acme Notion',
            botId: 'bot-1',
            identityVersion: 1,
            databaseIds: [dbId],
          },
        },
        resourceLabels: {
          [dbId]: 'Roadmap 2026',
        },
      };

      const { unmount } = render(
        <PlanMoment
          request="Tạo trang"
          runtimeMode="sandbox"
          inlineComposer={null}
          plan={plan}
          services={[{ id: 'notion', name: 'Notion', configured: true, connected: true, tools: [] } as any]}
          destination={(step, labels) => resourceDestination(step, labels)}
          onPreview={vi.fn()}
          onApprove={vi.fn()}
          onCancel={vi.fn()}
          onEdit={vi.fn()}
        />
      );

      expect(screen.getByText(/Workspace Notion: Acme Notion/)).toBeInTheDocument();
      expect(screen.getByText(/Roadmap 2026/)).toBeInTheDocument();

      unmount();

      render(
        <ReceiptMoment
          request="Tạo trang"
          steps={[
            {
              id: 's1',
              tool: 'notion.create_page',
              description: 'Tạo trang ghi chú',
              status: 'succeeded',
              duration: '150ms',
              output: { id: 'page-1', title: 'Sprint Review', url: 'https://www.notion.so/page-1' },
            },
          ]}
          planSteps={plan.steps}
          labels={plan.resourceLabels}
          notionConnection={plan.connections?.notion}
          services={[{ id: 'notion', name: 'Notion', configured: true, connected: true, tools: [] } as any]}
          destination={(step, labels) => resourceDestination(step, labels)}
          onNewConversation={vi.fn()}
          onFollowup={vi.fn()}
        />
      );

      expect(screen.getByText(/Workspace Notion: Acme Notion/)).toBeInTheDocument();
      expect(screen.getByText('Roadmap 2026')).toBeInTheDocument();
      expect(operation('notion.query_database').action).toBe('Truy vấn database');
    });

    it('ScheduleMoment renders notion_digest candidate with databases badge and extractNotionDatabaseIdClient parses URLs', () => {
      expect(
        extractNotionDatabaseIdClient('https://www.notion.so/acme/Roadmap-11111111222233334444555555555555?v=abc')
      ).toBe('11111111-2222-3333-4444-555555555555');

      render(
        <ScheduleMoment
          digestCandidate={{
            eligible: true,
            kind: 'notion_digest',
            reasonCode: 'ELIGIBLE',
            suggestedCron: '0 9 * * *',
            timezone: 'Asia/Ho_Chi_Minh',
            summary: 'Báo cáo Notion mỗi sáng',
            config: {
              version: 1,
              databases: [
                { id: '11111111-2222-3333-4444-555555555555', title: 'Roadmap 2026' },
              ],
              delivery: { service: 'telegram', chatId: '123456', label: 'Nhóm Ops' },
            },
          }}
        />
      );

      expect(screen.getByText(/Database: Roadmap 2026/)).toBeInTheDocument();
    });

    it('renders Notion page preview card with properties grid, PlanMoment property pills, ExecutionProgress properties/content, ReceiptMoment metrics, and RecoveryMoment link', () => {
      const dbId = '11111111-2222-3333-4444-555555555555';
      const step = {
        id: 's-update',
        tool: 'notion.update_page',
        description: 'Cập nhật trạng thái trang Sprint Review',
        databaseId: dbId,
        args: {
          databaseId: dbId,
          pageId: '22222222-3333-4444-5555-666666666666',
          title: 'Sprint Review Q4',
          properties: { Status: 'Done', Priority: 'High', Urgent: true },
          content: 'Đã hoàn thành toàn bộ hạng mục.',
        },
        dependsOn: [],
      };

      const { unmount: unmountPreview } = render(
        <PreviewContents
          step={step}
          labels={{ [dbId]: 'Roadmap 2026' }}
          destination="Roadmap 2026"
        />
      );
      expect(screen.getByTestId('notion-page-preview')).toBeInTheDocument();
      expect(screen.getByTestId('notion-properties-grid')).toHaveTextContent('Status');
      expect(screen.getByTestId('notion-properties-grid')).toHaveTextContent('Done');
      unmountPreview();

      const plan: ActivePlan = {
        summary: 'Cập nhật trang Notion',
        steps: [step],
        connections: {
          notion: {
            credentialId: 'cred-notion-1',
            workspaceId: 'ws-1',
            workspaceName: 'Acme Notion',
            botId: 'bot-1',
            identityVersion: 1,
            databaseIds: [dbId],
          },
        },
        resourceLabels: { [dbId]: 'Roadmap 2026' },
      };

      const { unmount: unmountPlan } = render(
        <PlanMoment
          request="Cập nhật trang"
          runtimeMode="sandbox"
          inlineComposer={null}
          plan={plan}
          services={[{ id: 'notion', name: 'Notion', configured: true, connected: true, tools: [] } as any]}
          destination={(s, l) => resourceDestination(s, l)}
          onPreview={vi.fn()}
          onApprove={vi.fn()}
          onCancel={vi.fn()}
          onEdit={vi.fn()}
        />
      );
      expect(screen.getByTestId('notion-step-pills')).toHaveTextContent('🏷️ Done');
      expect(screen.getByTestId('notion-step-pills')).toHaveTextContent('📋 3 thuộc tính');
      unmountPlan();

      const { unmount: unmountExec } = render(
        <ExecutionProgress
          steps={[
            {
              id: 's-update',
              tool: 'notion.get_page',
              description: 'Đọc chi tiết trang',
              status: 'succeeded',
              output: {
                id: '22222222-3333-4444-5555-666666666666',
                title: 'Sprint Review Q4',
                url: 'https://www.notion.so/page-2',
                properties: { Status: 'Done', Tags: ['AI', 'Release'] },
                content: 'Nội dung chi tiết biên bản họp.',
              },
            },
          ]}
        />
      );
      expect(screen.getByTestId('notion-result-properties')).toHaveTextContent('Status:');
      expect(screen.getByTestId('notion-result-properties')).toHaveTextContent('Done');
      expect(screen.getAllByText(/Nội dung chi tiết biên bản họp/).length).toBeGreaterThanOrEqual(1);
      unmountExec();

      const { unmount: unmountReceipt } = render(
        <ReceiptMoment
          request="Cập nhật trang"
          steps={[
            {
              id: 's-update',
              tool: 'notion.update_page',
              description: 'Cập nhật trạng thái trang Sprint Review',
              status: 'succeeded',
              duration: '120ms',
              output: {
                id: '22222222-3333-4444-5555-666666666666',
                title: 'Sprint Review Q4',
                url: 'https://www.notion.so/page-2',
                properties: { Status: 'Done', Priority: 'High' },
              },
            },
          ]}
          planSteps={plan.steps}
          labels={plan.resourceLabels}
          notionConnection={plan.connections?.notion}
          services={[{ id: 'notion', name: 'Notion', configured: true, connected: true, tools: [] } as any]}
          destination={(s, l) => resourceDestination(s, l)}
          onNewConversation={vi.fn()}
          onFollowup={vi.fn()}
        />
      );
      expect(screen.getByTestId('notion-receipt-metrics')).toHaveTextContent('Đã cập nhật 2 thuộc tính');
      unmountReceipt();

      render(
        <RecoveryMoment
          request="Cập nhật trang"
          moment={8}
          snapshot={{
            execution: { pausedStepId: 's-update' } as any,
            plan: { ...plan, id: 'plan-1', convId: 'conv-1', status: 'paused' },
            steps: [],
            recoveryActions: ['skip', 'stop'],
          }}
          steps={[
            {
              id: 's-update',
              tool: 'notion.update_page',
              description: 'Cập nhật trạng thái trang Sprint Review',
              status: 'unknown',
              duration: '120ms',
              error: 'Notion API timeout',
            },
          ]}
          services={[{ id: 'notion', name: 'Notion', configured: true, connected: true, tools: [] } as any]}
          controls={null}
        />
      );
      expect(screen.getByRole('link', { name: /Mở Notion kiểm tra/i })).toBeInTheDocument();
    });

    it('normalizes backend wire status disconnected/scope_required, sends databaseIds in saveNotionScope, and handles check health response', async () => {
      const db1 = '11111111-2222-3333-4444-555555555555';
      // 1. Backend raw wire payload for new user: status = "disconnected"
      vi.spyOn(apiClient, 'getNotionConnection').mockResolvedValueOnce({
        status: 'disconnected',
        toolsAvailable: false,
        connections: [],
        activeConnection: null,
        databases: [],
      } as any);

      const { unmount } = render(<NotionConnection user={memberUser} refresh={vi.fn()} />);
      const connectBtn = await screen.findByRole('button', { name: 'Kết nối Notion' });
      expect(connectBtn).toHaveAttribute('id', 'notion-connect');
      unmount();

      // 2. Backend raw wire payload for newly connected workspace without scope: status = "scope_required"
      vi.spyOn(apiClient, 'getNotionConnection').mockResolvedValue({
        status: 'scope_required',
        toolsAvailable: false,
        connections: [
          {
            id: 'conn-wire-1',
            workspaceId: 'ws-wire-1',
            workspaceName: 'Wire Workspace',
            botId: 'bot-wire-1',
            status: 'scope_required',
            allowedDatabases: [],
            selectedDatabases: [],
            isDefault: true,
            toolsAvailable: false,
          },
        ],
        activeConnection: {
          id: 'conn-wire-1',
          workspaceId: 'ws-wire-1',
          workspaceName: 'Wire Workspace',
          botId: 'bot-wire-1',
          status: 'scope_required',
          allowedDatabases: [],
          selectedDatabases: [],
          isDefault: true,
          toolsAvailable: false,
        },
        databases: [],
      } as any);
      vi.spyOn(apiClient, 'getNotionDatabases').mockResolvedValue({
        databases: [{ id: db1, title: 'Sprint DB' }],
      });

      render(<NotionConnection user={memberUser} refresh={vi.fn()} />);
      expect(await screen.findByTestId('notion-scope')).toBeInTheDocument();

      // 3. Verify apiClient.saveNotionScope sends databaseIds array in JSON body
      const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ id: 'conn-wire-1', status: 'connected', toolsAvailable: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
      vi.stubGlobal('fetch', fetchMock);
      await apiClient.saveNotionScope('conn-wire-1', [{ id: db1, title: 'Sprint DB' }]);
      const [, init] = fetchMock.mock.calls[0]!;
      expect(JSON.parse(String(init?.body))).toMatchObject({
        databaseIds: [db1],
      });
    });
  });
});
