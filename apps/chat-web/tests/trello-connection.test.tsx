/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { TrelloConnection } from '../src/pages/Settings/TrelloConnection';
import { apiClient } from '../src/services/api-client';
import { PlanMoment } from '../src/pages/Cockpit/PlanMoment';
import { ResponseMoment } from '../src/pages/Responses/ResponseMoment';
import { ReceiptMoment } from '../src/pages/Cockpit/ReceiptMoment';
import { SettingsPage } from '../src/pages/Settings/SettingsPage';
import { trelloConnectionNotice } from '../src/services/trello-connection';
import { authStorage } from '../src/services/auth-storage';
import type { ActivePlan, User } from '../src/types';

describe('Task 10: Trello connection UI and chat moments', () => {
  const adminUser: User = { id: 'u-admin', email: 'admin@example.com', name: 'Admin', role: 'admin' };
  const memberUser: User = { id: 'u-member', email: 'member@example.com', name: 'Member', role: 'member' };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  describe('1. TrelloConnection component', () => {
    it('renders not_connected with button #trello-connect labeled "Kết nối Trello" and no API key or token inputs', async () => {
      vi.spyOn(apiClient, 'getTrelloConnection').mockResolvedValue({
        status: 'not_connected',
        boards: [],
      });

      render(<TrelloConnection user={memberUser} refresh={vi.fn()} />);

      expect(await screen.findByText('Chưa kết nối')).toBeInTheDocument();
      const connectBtn = screen.getByRole('button', { name: 'Kết nối Trello' });
      expect(connectBtn).toBeInTheDocument();
      expect(connectBtn).toHaveAttribute('id', 'trello-connect');

      // No API key or token input
      expect(screen.queryByLabelText(/api key/i)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/token/i)).not.toBeInTheDocument();
      expect(document.querySelector('input[name="apiKey"]')).toBeNull();
      expect(document.querySelector('input[name="token"]')).toBeNull();
    });

    it('renders admin needs_scope with workspace list, cannot save with 0 boards, max 10 boards, checkboxes in workspace', async () => {
      vi.spyOn(apiClient, 'getTrelloConnection').mockResolvedValue({
        status: 'needs_scope',
        username: 'alice_trello',
        boards: [],
      });
      vi.spyOn(apiClient, 'getTrelloWorkspaces').mockResolvedValue({
        workspaces: [
          { id: 'ws-1', name: 'Engineering Workspace' },
          { id: 'ws-2', name: 'Design Workspace' },
        ],
      });
      vi.spyOn(apiClient, 'getTrelloBoards').mockResolvedValue({
        boards: [
          { id: 'b1', name: 'Sprint Board', member: true },
          { id: 'b2', name: 'Bug Tracker', member: true },
        ],
      });
      const saveScopeSpy = vi.spyOn(apiClient, 'saveTrelloScope').mockResolvedValue({
        chosenBy: 'u-admin',
        workspaceId: 'ws-1',
        workspaceName: 'Engineering Workspace',
        boards: [{ boardId: 'b1', boardName: 'Sprint Board' }],
      });

      render(<TrelloConnection user={adminUser} refresh={vi.fn()} />);

      // Admin sees #trello-scope
      const scopeArea = await screen.findByTestId('trello-scope');
      expect(scopeArea).toBeInTheDocument();
      expect(scopeArea).toHaveAttribute('id', 'trello-scope');

      // Admin sees workspaces
      expect(await screen.findByText('Engineering Workspace')).toBeInTheDocument();

      // Checkboxes appear for boards in the workspace
      const b1Checkbox = await screen.findByRole('checkbox', { name: /Sprint Board/i });
      const b2Checkbox = await screen.findByRole('checkbox', { name: /Bug Tracker/i });
      expect(b2Checkbox).not.toBeChecked();

      // Save button disabled when 0 boards selected
      const saveBtn = screen.getByRole('button', { name: /Lưu/i });
      expect(saveBtn).toBeDisabled();

      // Check b1
      fireEvent.click(b1Checkbox);
      expect(b1Checkbox).toBeChecked();
      expect(saveBtn).not.toBeDisabled();

      // Click save
      fireEvent.click(saveBtn);
      await waitFor(() => {
        expect(saveScopeSpy).toHaveBeenCalledWith('ws-1', ['b1']);
      });
    });

    it('hides #trello-scope when role is member', async () => {
      vi.spyOn(apiClient, 'getTrelloConnection').mockResolvedValue({
        status: 'connected',
        username: 'bob_trello',
        workspaceName: 'Engineering Workspace',
        boards: [{ boardId: 'b1', boardName: 'Sprint Board', member: true }],
      });

      render(<TrelloConnection user={memberUser} refresh={vi.fn()} />);

      await screen.findByText(/bob_trello/);
      expect(document.getElementById('trello-scope')).toBeNull();
      expect(screen.getByRole('button', { name: 'Ngắt kết nối' })).toHaveAttribute('id', 'trello-disconnect');
    });

    it('renders member needs_membership with board names and "Bạn cần được thêm vào bảng"', async () => {
      vi.spyOn(apiClient, 'getTrelloConnection').mockResolvedValue({
        status: 'needs_membership',
        username: 'charlie_trello',
        workspaceName: 'Engineering Workspace',
        boards: [
          { boardId: 'b1', boardName: 'Sprint Board', member: false },
          { boardId: 'b2', boardName: 'Bug Tracker', member: false },
        ],
      });

      render(<TrelloConnection user={memberUser} refresh={vi.fn()} />);

      expect(await screen.findByText(/charlie_trello/)).toBeInTheDocument();
      expect(screen.getByText('Sprint Board')).toBeInTheDocument();
      expect(screen.getByText('Bug Tracker')).toBeInTheDocument();
      expect(screen.getAllByText(/Bạn cần được thêm vào bảng/i).length).toBeGreaterThan(0);
    });

    it('allows admin in needs_membership state to click #trello-edit-scope ("Đổi bảng") and save a new scope', async () => {
      vi.spyOn(apiClient, 'getTrelloConnection').mockResolvedValue({
        status: 'needs_membership',
        username: 'charlie_trello',
        workspaceName: 'Engineering Workspace',
        boards: [
          { boardId: 'b1', boardName: 'Sprint Board', member: false },
          { boardId: 'b2', boardName: 'Bug Tracker', member: false },
        ],
      });
      vi.spyOn(apiClient, 'getTrelloWorkspaces').mockResolvedValue({
        workspaces: [{ id: 'ws-1', name: 'Engineering Workspace' }],
      });
      vi.spyOn(apiClient, 'getTrelloBoards').mockResolvedValue({
        boards: [
          { id: 'b1', name: 'Sprint Board', member: true },
          { id: 'b2', name: 'Bug Tracker', member: true },
        ],
      });
      const saveScopeSpy = vi.spyOn(apiClient, 'saveTrelloScope').mockResolvedValue({
        chosenBy: 'u-admin',
        workspaceId: 'ws-1',
        workspaceName: 'Engineering Workspace',
        boards: [{ boardId: 'b1', boardName: 'Sprint Board' }],
      });

      render(<TrelloConnection user={adminUser} refresh={vi.fn()} />);

      expect(await screen.findByText(/charlie_trello/)).toBeInTheDocument();
      const editScopeBtn = await screen.findByRole('button', { name: 'Đổi bảng' });
      expect(editScopeBtn).toBeInTheDocument();
      expect(editScopeBtn).toHaveAttribute('id', 'trello-edit-scope');

      fireEvent.click(editScopeBtn);

      const scopeArea = await screen.findByTestId('trello-scope');
      expect(scopeArea).toBeInTheDocument();
      expect(scopeArea).toHaveAttribute('id', 'trello-scope');

      const b1Checkbox = await screen.findByRole('checkbox', { name: /Sprint Board/i });
      fireEvent.click(b1Checkbox);

      const saveBtn = screen.getByRole('button', { name: /Lưu/i });
      expect(saveBtn).not.toBeDisabled();
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(saveScopeSpy).toHaveBeenCalledWith('ws-1', ['b1']);
      });
    });

    it('displays trelloConnectionNotice when user opens settings after connecting', async () => {
      vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        if (url === '/api/services') return new Response(JSON.stringify({ services: [], canConfigure: false }));
        throw new Error(`Unexpected endpoint: ${url}`);
      }));
      vi.spyOn(apiClient, 'getTrelloConnection').mockResolvedValue({ status: 'not_connected', boards: [] });
      authStorage.setStoredTokens({ user: adminUser });
      trelloConnectionNotice.set('alice_trello');

      render(<SettingsPage user={adminUser} navigate={vi.fn()} onLogout={vi.fn()} />);

      expect(await screen.findByText('Đã kết nối @alice_trello')).toBeInTheDocument();
    });
  });

  describe('2. Chat refusal with Trello', () => {
    it('refusal with unavailableServices trello renders button #trello-connect calling start with returnTo', async () => {
      const startSpy = vi.spyOn(apiClient, 'startTrelloConnection').mockResolvedValue({
        url: 'https://auth.atlassian.com/authorize?state=xyz',
      });
      // Mock assign
      const assignMock = vi.fn();
      vi.stubGlobal('location', { ...window.location, assign: assignMock, protocol: 'http:', hostname: 'localhost' });

      render(
        <ResponseMoment
          request="Tạo thẻ mới trên Trello"
          conversationId="11111111-2222-3333-4444-555555555555"
          unavailableServices={[{ id: 'trello', name: 'Trello' }]}
          reason="Trello cần được kết nối trước khi dùng."
          services={[]}
          connectFromChat={true}
          navigate={vi.fn()}
        />
      );

      const connectBtn = await screen.findByRole('link', { name: /Kết nối Trello/i });
      expect(connectBtn).toBeInTheDocument();
      expect(connectBtn).toHaveAttribute('id', 'trello-connect');

      fireEvent.click(connectBtn);
      await waitFor(() => {
        expect(startSpy).toHaveBeenCalledWith({
          returnTo: '/c/11111111-2222-3333-4444-555555555555',
        });
      });
    });

    it('calls startTrelloConnection with returnTo even when connectFromChat is false (Google flags off), and enables "Gửi lại yêu cầu" once trello personalStatus is connected', async () => {
      const startSpy = vi.spyOn(apiClient, 'startTrelloConnection').mockResolvedValue({
        url: 'https://auth.atlassian.com/authorize?state=xyz',
      });
      const assignMock = vi.fn();
      vi.stubGlobal('location', { ...window.location, assign: assignMock, protocol: 'http:', hostname: 'localhost' });

      const onResendSpy = vi.fn();

      const { unmount } = render(
        <ResponseMoment
          request="Tạo thẻ mới trên Trello"
          conversationId="11111111-2222-3333-4444-555555555555"
          unavailableServices={[{ id: 'trello', name: 'Trello' }]}
          reason="Trello cần được kết nối trước khi dùng."
          services={[]}
          connectFromChat={false}
          navigate={vi.fn()}
        />
      );

      const connectBtn = await screen.findByRole('link', { name: /Kết nối Trello/i });
      expect(connectBtn).toBeInTheDocument();
      expect(connectBtn).toHaveAttribute('id', 'trello-connect');

      fireEvent.click(connectBtn);
      await waitFor(() => {
        expect(startSpy).toHaveBeenCalledWith({
          returnTo: '/c/11111111-2222-3333-4444-555555555555',
        });
      });

      unmount();

      render(
        <ResponseMoment
          request="Tạo thẻ mới trên Trello"
          conversationId="11111111-2222-3333-4444-555555555555"
          unavailableServices={[{ id: 'trello', name: 'Trello' }]}
          reason="Trello cần được kết nối trước khi dùng."
          services={[
            {
              id: 'trello',
              name: 'Trello',
              configured: false,
              connected: false,
              tools: [],
              personalStatus: 'connected',
              username: 'alice_trello',
            } as any,
          ]}
          connectFromChat={false}
          navigate={vi.fn()}
          onResend={onResendSpy}
        />
      );

      expect(await screen.findByText(/Đã kết nối · @alice_trello/)).toBeInTheDocument();
      const resendBtn = screen.getByRole('button', { name: 'Gửi lại yêu cầu' });
      expect(resendBtn).toBeInTheDocument();

      fireEvent.click(resendBtn);
      expect(onResendSpy).toHaveBeenCalledWith('Tạo thẻ mới trên Trello');
    });
  });

  describe('3. PlanMoment and ReceiptMoment display board names and username', () => {
    it('PlanMoment displays username from connections.trello and board name from resourceLabels', () => {
      const plan: ActivePlan = {
        summary: 'Tạo thẻ Trello',
        steps: [
          {
            id: 's1',
            tool: 'trello.create_card',
            description: 'Tạo thẻ fix bug',
            args: { boardId: 'b1', listId: 'l1', title: 'Fix bug' },
            dependsOn: [],
          },
        ],
        connections: {
          trello: {
            credentialId: 'cred-1',
            memberId: 'm1',
            username: 'alice_trello',
            boardIds: ['b1'],
          },
        },
        resourceLabels: {
          b1: 'Sprint Board',
          l1: 'Đang làm (board Sprint Board)',
        },
      };

      render(
        <PlanMoment
          request="Tạo thẻ"
          runtimeMode="sandbox"
          inlineComposer={null}
          plan={plan}
          services={[{ id: 'trello', name: 'Trello', configured: true, connected: true, tools: [] } as any]}
          destination={(step, labels) => labels?.[String(step.args?.boardId)] ?? ''}
          onPreview={vi.fn()}
          onApprove={vi.fn()}
          onCancel={vi.fn()}
          onEdit={vi.fn()}
        />
      );

      expect(screen.getByText(/alice_trello/)).toBeInTheDocument();
      expect(screen.getByText(/Sprint Board/)).toBeInTheDocument();
    });

    it('ReceiptMoment displays username from connections.trello and board name from resourceLabels', () => {
      const planSteps = [
        {
          id: 's1',
          tool: 'trello.create_card',
          description: 'Tạo thẻ',
          args: { boardId: 'b1', listId: 'l1', title: 'Fix bug' },
          dependsOn: [],
        },
      ];
      const steps = [
        {
          id: 's1',
          tool: 'trello.create_card',
          description: 'Tạo thẻ',
          status: 'succeeded' as const,
          duration: '120ms',
          output: { id: 'card-1', url: 'https://trello.com/c/card-1' },
        },
      ];

      render(
        <ReceiptMoment
          request="Tạo thẻ"
          steps={steps}
          planSteps={planSteps}
          labels={{ b1: 'Sprint Board' }}
          trelloConnection={{ username: 'alice_trello' } as any}
          services={[{ id: 'trello', name: 'Trello', configured: true, connected: true, tools: [] } as any]}
          destination={(step, labels) => labels?.[String(step.args?.boardId)] ?? ''}
          onNewConversation={vi.fn()}
          onFollowup={vi.fn()}
        />
      );

      expect(screen.getByText(/alice_trello/)).toBeInTheDocument();
      expect(screen.getByText(/Sprint Board/)).toBeInTheDocument();
    });
  });
});
