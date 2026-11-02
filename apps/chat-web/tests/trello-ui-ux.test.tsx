/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { toolDefinition } from '../src/services/tool-definitions';
import { operation, resultTitle } from '../src/pages/Cockpit/presentation';
import { PreviewContents } from '../src/pages/Cockpit/PreviewContents';
import { PlanMoment } from '../src/pages/Cockpit/PlanMoment';
import { ReceiptMoment } from '../src/pages/Cockpit/ReceiptMoment';
import { RecoveryMoment } from '../src/pages/Cockpit/RecoveryMoment';
import { ResultFields } from '../src/components/ExecutionProgress';
import { ResponseMoment } from '../src/pages/Responses/ResponseMoment';
import { TrelloConnection } from '../src/pages/Settings/TrelloConnection';
import { apiClient } from '../src/services/api-client';
import type { ActivePlan, User } from '../src/types';

describe('Trello Frontend UI/UX Suite (Tasks 1-4)', () => {
  const adminUser: User = { id: 'u-admin', email: 'admin@example.com', name: 'Admin', role: 'admin' };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe('Task 1: Complete 14 Trello Tools in tool-definitions.ts & cockpit-services.json', () => {
    it('registers all 14 Trello tools in toolDefinition() and configures rich Vietnamese operations', () => {
      const all14Tools = [
        'trello.create_card',
        'trello.update_card',
        'trello.add_member',
        'trello.remove_member',
        'trello.add_checklist',
        'trello.update_checklist_item',
        'trello.add_comment',
        'trello.create_list',
        'trello.set_card_due_complete',
        'trello.get_card',
        'trello.search_cards',
        'trello.search_lists',
        'trello.search_boards',
        'trello.search_members',
      ];

      for (const toolName of all14Tools) {
        expect(toolDefinition(toolName)).toBeDefined();
      }

      expect(operation('trello.update_card')).toMatchObject({
        action: 'Cập nhật thẻ',
        receipt: 'Đã cập nhật thẻ',
        titleField: 'name',
      });
      expect(operation('trello.add_member')).toMatchObject({
        action: 'Gán thành viên',
        receipt: 'Đã gán thành viên',
      });
      expect(operation('trello.remove_member')).toMatchObject({
        action: 'Gỡ thành viên',
        receipt: 'Đã gỡ thành viên',
      });
      expect(operation('trello.add_checklist')).toMatchObject({
        action: 'Thêm checklist',
        receipt: 'Đã thêm checklist',
        titleField: 'name',
      });
      expect(operation('trello.update_checklist_item')).toMatchObject({
        action: 'Cập nhật mục checklist',
        receipt: 'Đã cập nhật checklist',
        titleField: 'name',
      });
      expect(operation('trello.add_comment')).toMatchObject({
        action: 'Bình luận thẻ',
        receipt: 'Đã bình luận',
        titleField: 'text',
      });
      expect(operation('trello.create_list')).toMatchObject({
        action: 'Tạo cột mới',
        receipt: 'Đã tạo cột',
        titleField: 'name',
      });
      expect(operation('trello.set_card_due_complete')).toMatchObject({
        action: 'Đánh dấu hạn chót',
        receipt: 'Đã cập nhật hạn chót',
        titleField: 'name',
      });

      expect(
        resultTitle({
          id: 's1',
          tool: 'trello.create_list',
          description: 'Tạo cột QA Review',
          status: 'succeeded',
          output: { id: 'l-qa', name: 'QA Review', idBoard: 'b1' },
        })
      ).toBe('QA Review');
    });

    it('ReceiptMoment displays real titles and specific badges for multi-step Trello operations', () => {
      const planSteps = [
        {
          id: 's1',
          tool: 'trello.create_list',
          description: 'Tạo cột QA Review',
          args: { boardId: 'b1', name: 'QA Review' },
          dependsOn: [],
        },
        {
          id: 's2',
          tool: 'trello.update_checklist_item',
          description: 'Hoàn thành mục checklist',
          args: { boardId: 'b1', cardId: 'c1', itemName: 'Viết unit test', state: 'complete' },
          dependsOn: ['s1'],
        },
      ];
      const steps = [
        {
          id: 's1',
          tool: 'trello.create_list',
          description: 'Tạo cột QA Review',
          status: 'succeeded' as const,
          duration: '80ms',
          output: { id: 'l-qa', name: 'QA Review' },
        },
        {
          id: 's2',
          tool: 'trello.update_checklist_item',
          description: 'Hoàn thành mục checklist',
          status: 'succeeded' as const,
          duration: '95ms',
          output: { id: 'chk-item-1', name: 'Viết unit test', state: 'complete' },
        },
      ];

      render(
        <ReceiptMoment
          request="Tạo cột QA và tích mục checklist"
          steps={steps}
          planSteps={planSteps}
          labels={{ b1: 'Sprint Board', c1: 'Thẻ OAuth' }}
          trelloConnection={{ username: 'alice_trello' } as any}
          services={[{ id: 'trello', name: 'Trello', configured: true, connected: true, tools: [] } as any]}
          destination={(step, labels) => labels?.[String(step.args?.boardId)] ?? ''}
          onNewConversation={vi.fn()}
          onFollowup={vi.fn()}
        />
      );

      expect(screen.getByText(/✓ Đã tạo cột/)).toBeInTheDocument();
      expect(screen.getByText('QA Review')).toBeInTheDocument();
      expect(screen.getByText(/✓ Đã cập nhật checklist/)).toBeInTheDocument();
      expect(screen.getByText('Viết unit test')).toBeInTheDocument();
    });
  });

  describe('Task 2: Rich Kanban Card, Checklist & Comment Preview in PreviewContents.tsx', () => {
    it('renders assigned members from labels, formatted deadline, and dueComplete status for Trello card preview', () => {
      render(
        <PreviewContents
          step={{
            id: 's-card',
            tool: 'trello.create_card',
            description: 'Tạo thẻ triển khai OAuth',
            args: {
              boardId: 'b1',
              listId: 'l1',
              title: 'Triển khai Trello OAuth',
              desc: 'Hoàn thiện luồng bảo mật PKCE',
              due: '2026-12-15T10:00:00.000Z',
              dueComplete: true,
              idMembers: ['m1', 'm2'],
            },
          }}
          destination="Sprint Board · Đang làm"
          labels={{
            m1: 'Nguyễn Văn A (@vana)',
            m2: 'Trần Thị B (@thib)',
          }}
        />
      );

      expect(screen.getByTestId('trello-card-preview')).toBeInTheDocument();
      expect(screen.getByText('Triển khai Trello OAuth')).toBeInTheDocument();
      expect(screen.getByText('Hoàn thiện luồng bảo mật PKCE')).toBeInTheDocument();
      expect(screen.getByText(/Nguyễn Văn A/)).toBeInTheDocument();
      expect(screen.getByText(/Trần Thị B/)).toBeInTheDocument();
      expect(screen.getByText(/Đã hoàn thành hạn/)).toBeInTheDocument();
    });

    it('renders interactive-style checklist items for trello.add_checklist and trello.update_checklist_item', () => {
      const { unmount } = render(
        <PreviewContents
          step={{
            id: 's-chk',
            tool: 'trello.add_checklist',
            description: 'Thêm checklist nghiệm thu',
            args: {
              boardId: 'b1',
              cardId: 'c1',
              name: 'Checklist Nghiệm Thu',
              items: ['Kiểm tra unit test', 'Kiểm tra giao diện'],
            },
          }}
          destination="Sprint Board · Thẻ OAuth"
        />
      );

      expect(screen.getByText('Checklist Nghiệm Thu')).toBeInTheDocument();
      expect(screen.getByText('Kiểm tra unit test')).toBeInTheDocument();
      expect(screen.getByText('Kiểm tra giao diện')).toBeInTheDocument();
      unmount();

      render(
        <PreviewContents
          step={{
            id: 's-chk-upd',
            tool: 'trello.update_checklist_item',
            description: 'Tích mục checklist',
            args: {
              boardId: 'b1',
              cardId: 'c1',
              itemName: 'Kiểm tra unit test',
              state: 'complete',
            },
          }}
          destination="Sprint Board · Thẻ OAuth"
        />
      );

      expect(screen.getByText('Kiểm tra unit test')).toBeInTheDocument();
      expect(screen.getByText(/Đã hoàn thành \(complete\)/)).toBeInTheDocument();
    });
  });

  describe('Task 3: Structured Pre-Execution Guardrail Warnings & Rich Trello Read ResultFields', () => {
    it('renders structured plan-warnings-callout in PlanMoment when plan.warnings is present', () => {
      const plan: ActivePlan = {
        summary: 'Tạo thẻ Trello mới',
        steps: [
          {
            id: 's1',
            tool: 'trello.create_card',
            description: 'Tạo thẻ Fix bug login',
            args: { boardId: 'b1', listId: 'l1', title: 'Fix bug login' },
            dependsOn: [],
          },
        ],
        warnings: [
          'Cảnh báo trùng thẻ: Trên bảng đã có thẻ đang mở cùng tên "Fix bug login".',
          'Cảnh báo tải công việc: Thành viên Nguyễn Văn A đang phụ trách 5 thẻ mở trên bảng này.',
        ],
      };

      render(
        <PlanMoment
          request="Tạo thẻ Fix bug login"
          runtimeMode="live"
          inlineComposer={null}
          plan={plan}
          services={[{ id: 'trello', name: 'Trello', configured: true, connected: true, tools: [] } as any]}
          destination={() => 'Sprint Board'}
          onPreview={vi.fn()}
          onApprove={vi.fn()}
          onCancel={vi.fn()}
          onEdit={vi.fn()}
        />
      );

      const callout = screen.getByTestId('plan-warnings-callout');
      expect(callout).toBeInTheDocument();
      expect(screen.getByText(/Lưu ý kiểm tra trước khi thực thi/i)).toBeInTheDocument();
      expect(screen.getByText(/Cảnh báo trùng thẻ/)).toBeInTheDocument();
      expect(screen.getByText(/Cảnh báo tải công việc/)).toBeInTheDocument();
    });

    it('renders Trello card fields (desc, due, dueComplete, checklists) in ResultFields', () => {
      render(
        <ResultFields
          tool="trello.get_card"
          output={{
            id: 'c1',
            name: 'Thẻ nâng cấp UI',
            desc: 'Chi tiết thiết kế Kanban',
            due: '2026-12-20T09:00:00.000Z',
            dueComplete: false,
            url: 'https://trello.com/c/c1',
            checklists: [
              {
                id: 'chk1',
                name: 'Việc cần làm',
                items: [
                  { id: 'i1', name: 'Mục 1', state: 'complete' },
                  { id: 'i2', name: 'Mục 2', state: 'incomplete' },
                ],
              },
            ],
          }}
        />
      );

      expect(screen.getByText('Mô tả:')).toBeInTheDocument();
      expect(screen.getByText('Chi tiết thiết kế Kanban')).toBeInTheDocument();
      expect(screen.getByText('Hạn chót:')).toBeInTheDocument();
      expect(screen.getByText('Hoàn thành hạn:')).toBeInTheDocument();
      expect(screen.getByText('Chưa xong')).toBeInTheDocument();
      expect(screen.getByText(/Việc cần làm \(1\/2\)/)).toBeInTheDocument();
    });
  });

  describe('Task 4: ResponseMoment needs_scope / needs_membership & TrelloConnection Counter/Filter', () => {
    it('ResponseMoment navigates to /settings#trello-scope on needs_scope and /settings#trello on needs_membership', async () => {
      const navSpy = vi.fn();
      const { unmount } = render(
        <ResponseMoment
          request="Tạo thẻ Trello"
          conversationId="11111111-2222-3333-4444-555555555555"
          unavailableServices={[{ id: 'trello', name: 'Trello' }]}
          reason="Chưa chọn bảng Trello cho nhóm."
          services={[
            {
              id: 'trello',
              name: 'Trello',
              configured: false,
              connected: false,
              tools: [],
              personalStatus: 'needs_scope',
              username: 'alice_trello',
            } as any,
          ]}
          connectFromChat={false}
          navigate={navSpy}
        />
      );

      expect(await screen.findByText(/Đã kết nối · Chưa chọn bảng · @alice_trello/)).toBeInTheDocument();
      const scopeBtn = screen.getByRole('link', { name: /Chọn bảng Trello/i });
      fireEvent.click(scopeBtn);
      expect(navSpy).toHaveBeenCalledWith('/settings#trello-scope');

      unmount();
      navSpy.mockClear();

      render(
        <ResponseMoment
          request="Tạo thẻ Trello"
          conversationId="11111111-2222-3333-4444-555555555555"
          unavailableServices={[{ id: 'trello', name: 'Trello' }]}
          reason="Cần được thêm vào bảng Trello."
          services={[
            {
              id: 'trello',
              name: 'Trello',
              configured: false,
              connected: false,
              tools: [],
              personalStatus: 'needs_membership',
              username: 'alice_trello',
            } as any,
          ]}
          connectFromChat={false}
          navigate={navSpy}
        />
      );

      expect(await screen.findByText(/Đã kết nối · Cần cấp quyền bảng · @alice_trello/)).toBeInTheDocument();
      const memberBtn = screen.getByRole('link', { name: /Kiểm tra quyền Trello/i });
      fireEvent.click(memberBtn);
      expect(navSpy).toHaveBeenCalledWith('/settings#trello');
    });

    it('TrelloConnection renders board selection counter and quick filter input when >= 5 boards', async () => {
      vi.spyOn(apiClient, 'getTrelloConnection').mockResolvedValue({
        status: 'needs_scope',
        username: 'alice_trello',
        boards: [],
      });
      vi.spyOn(apiClient, 'getTrelloWorkspaces').mockResolvedValue({
        workspaces: [{ id: 'ws-1', name: 'Product Workspace' }],
      });
      vi.spyOn(apiClient, 'getTrelloBoards').mockResolvedValue({
        boards: [
          { id: 'b1', name: 'Alpha Roadmap', member: true },
          { id: 'b2', name: 'Beta Sprint', member: true },
          { id: 'b3', name: 'Gamma Bugs', member: true },
          { id: 'b4', name: 'Delta Ops', member: true },
          { id: 'b5', name: 'Epsilon Release', member: true },
        ],
      });

      render(<TrelloConnection user={adminUser} refresh={vi.fn()} />);

      expect(await screen.findByTestId('trello-scope-counter')).toHaveTextContent('Đã chọn 0/10');
      const filterInput = await screen.findByLabelText('Tìm nhanh bảng Trello');
      fireEvent.change(filterInput, { target: { value: 'Epsilon' } });

      expect(screen.getByRole('checkbox', { name: /Epsilon Release/i })).toBeInTheDocument();
      expect(screen.queryByRole('checkbox', { name: /Alpha Roadmap/i })).not.toBeInTheDocument();
    });
  });

  describe('Task 5: Full-Stack Audit Polish (trello-step-pills, TrelloReceiptMetrics, checklist title label, RecoveryMoment & Board Links)', () => {
    it('renders "Tên checklist:" when trello.add_checklist passes schema-standard args.title', () => {
      render(
        <PreviewContents
          step={{
            id: 's-chk-title',
            tool: 'trello.add_checklist',
            description: 'Thêm checklist chuẩn schema',
            args: {
              boardId: 'b1',
              cardId: 'c1',
              title: 'Checklist Nghiệm Thu Chuẩn Schema',
              items: ['Mục A', 'Mục B'],
            },
          }}
          destination="Sprint Board · Thẻ OAuth"
        />
      );

      expect(screen.getByText('Tên checklist:')).toBeInTheDocument();
      expect(screen.queryByText('Tiêu đề card:')).not.toBeInTheDocument();
      expect(screen.getByText('Checklist Nghiệm Thu Chuẩn Schema')).toBeInTheDocument();
    });

    it('renders trello-step-pills on PlanMoment and trello-receipt-metrics on ReceiptMoment', () => {
      const plan: ActivePlan = {
        summary: 'Tạo thẻ và thêm checklist',
        steps: [
          {
            id: 's1',
            tool: 'trello.create_card',
            description: 'Tạo thẻ Sprint',
            args: {
              boardId: 'b1',
              listId: 'l1',
              title: 'Thẻ Sprint 15',
              due: '2026-12-15T10:00:00.000Z',
              dueComplete: true,
              idMembers: ['m1', 'm2'],
            },
            dependsOn: [],
          },
          {
            id: 's2',
            tool: 'trello.add_checklist',
            description: 'Thêm checklist',
            args: {
              boardId: 'b1',
              cardId: 'c1',
              title: 'Checklist QA',
              items: ['Mục 1', 'Mục 2', 'Mục 3'],
            },
            dependsOn: ['s1'],
          },
        ],
        warnings: [],
      };

      const { unmount } = render(
        <PlanMoment
          request="Tạo thẻ Sprint và checklist"
          runtimeMode="live"
          inlineComposer={null}
          plan={plan}
          services={[{ id: 'trello', name: 'Trello', configured: true, connected: true, tools: [] } as any]}
          destination={() => 'Sprint Board'}
          onPreview={vi.fn()}
          onApprove={vi.fn()}
          onCancel={vi.fn()}
          onEdit={vi.fn()}
        />
      );

      const stepPills = screen.getAllByTestId('trello-step-pills');
      expect(stepPills.length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText(/2 thành viên/i)).toBeInTheDocument();
      expect(screen.getByText(/3 mục checklist/i)).toBeInTheDocument();
      unmount();

      render(
        <ReceiptMoment
          request="Tạo thẻ Sprint và checklist"
          steps={[
            {
              id: 's1',
              tool: 'trello.create_card',
              description: 'Tạo thẻ Sprint',
              status: 'succeeded',
              duration: '120ms',
              output: {
                id: 'c1',
                name: 'Thẻ Sprint 15',
                dueComplete: true,
                idMembers: ['m1', 'm2'],
                url: 'https://trello.com/c/c1',
              },
            },
            {
              id: 's2',
              tool: 'trello.add_checklist',
              description: 'Thêm checklist',
              status: 'succeeded',
              duration: '90ms',
              output: {
                id: 'chk1',
                name: 'Checklist QA',
                items: [
                  { id: 'i1', name: 'Mục 1', state: 'incomplete' },
                  { id: 'i2', name: 'Mục 2', state: 'incomplete' },
                  { id: 'i3', name: 'Mục 3', state: 'incomplete' },
                ],
              },
            },
          ]}
          planSteps={plan.steps}
          services={[{ id: 'trello', name: 'Trello', configured: true, connected: true, tools: [] } as any]}
          destination={() => 'Sprint Board'}
          onNewConversation={vi.fn()}
          onFollowup={vi.fn()}
        />
      );

      const receiptMetrics = screen.getAllByTestId('trello-receipt-metrics');
      expect(receiptMetrics.length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText(/Đã gán 2 thành viên/i)).toBeInTheDocument();
      expect(screen.getByText(/Đã tạo 3 mục checklist/i)).toBeInTheDocument();
    });

    it('renders "Mở Trello kiểm tra" link in RecoveryMoment (Moment 8) and external board links in TrelloConnection', async () => {
      const { unmount } = render(
        <RecoveryMoment
          request="Tạo thẻ Trello"
          moment={8}
          snapshot={{
            execution: {
              id: 'exec-1',
              convId: 'conv-1',
              status: 'paused_recovery',
              pausedStepId: 's1',
              startedAt: new Date().toISOString(),
            },
            plan: {
              summary: 'Tạo thẻ Trello',
              connections: { trello: { username: 'alice_trello' } as any },
              steps: [
                {
                  id: 's1',
                  tool: 'trello.create_card',
                  description: 'Tạo thẻ mới',
                  args: { boardId: 'b1', listId: 'l1', title: 'Thẻ mới' },
                  dependsOn: [],
                },
              ],
            },
            steps: [
              {
                stepId: 's1',
                tool: 'trello.create_card',
                status: 'unknown',
              },
            ],
            recoveryActions: ['skip', 'stop'],
          } as any}
          steps={[
            {
              id: 's1',
              tool: 'trello.create_card',
              description: 'Tạo thẻ mới',
              status: 'unknown',
            },
          ]}
          services={[{ id: 'trello', name: 'Trello', configured: true, connected: true, tools: [] } as any]}
          controls={{
            busy: false,
            error: null,
            onRetry: vi.fn(),
            onSkip: vi.fn(),
            onStop: vi.fn(),
            onContinue: vi.fn(),
            onEdit: vi.fn(),
          }}
        />
      );

      const checkLink = screen.getByRole('link', { name: /Mở Trello kiểm tra/i });
      expect(checkLink).toHaveAttribute('href', 'https://trello.com/b/b1');
      unmount();

      vi.spyOn(apiClient, 'getTrelloConnection').mockResolvedValue({
        status: 'connected',
        username: 'alice_trello',
        workspaceName: 'Engineering Workspace',
        boards: [{ boardId: 'b1', boardName: 'Sprint Board', member: true }],
      });

      render(<TrelloConnection user={adminUser} refresh={vi.fn()} />);
      const boardLink = await screen.findByRole('link', { name: /Sprint Board/i });
      expect(boardLink).toHaveAttribute('href', 'https://trello.com/b/b1');
    });
  });
});
