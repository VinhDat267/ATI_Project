/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createRef, useState } from 'react';
import { WorkflowFlowCanvas } from '../src/components/WorkflowFlowCanvas';
import { PlanMoment } from '../src/pages/Cockpit/PlanMoment';
import { ExecutionMoment } from '../src/pages/Cockpit/ExecutionMoment';
import { ReceiptMoment } from '../src/pages/Cockpit/ReceiptMoment';
import { ScheduleMoment } from '../src/pages/Cockpit/ScheduleMoment';
import { PreviewContents } from '../src/pages/Cockpit/PreviewContents';
import { RequestMoment } from '../src/pages/Cockpit/RequestMoments';
import { HistoryPage } from '../src/pages/History/HistoryPage';
import { SettingsPage } from '../src/pages/Settings/SettingsPage';
import { SchedulesCapabilityContext } from '../src/hooks/use-schedules';
import { apiClient } from '../src/services/api-client';
import { useChatStore } from '../src/store/chat-store';
import type { ActivePlan, ChatMessage, PlanStep } from '../src/types';

afterEach(() => {
  cleanup();
});

describe('WorkflowFlowCanvas — Make.com Orbital Workflow Visualizer', () => {
  const linearSteps: PlanStep[] = [
    {
      id: 'step_1',
      tool: 'mysheets.read_range',
      description: 'Đọc bảng KPI quý 4',
      args: { spreadsheetId: 'sheet-1', range: 'KPI!A1:D10' },
    },
    {
      id: 'step_2',
      tool: 'mysheets.append_rows',
      description: 'Ghi thêm dòng tổng kết',
      args: { spreadsheetId: 'sheet-1', sheetTitle: 'KPI', rows: [['Tổng', '100%']] },
    },
    {
      id: 'step_3',
      tool: 'slack.send_message',
      description: 'Gửi báo cáo vào kênh #kpi-updates',
      args: { channel: '#kpi-updates', text: 'Đã cập nhật KPI' },
    },
  ];

  const fanOutSteps: PlanStep[] = [
    {
      id: 'step_1',
      tool: 'github.get_issue',
      description: 'Đọc thông tin issue #42 trên GitHub',
      args: { repo: 'VinhDat267/ati-test', issueNumber: 42 },
    },
    {
      id: 'step_2',
      tool: 'trello.create_card',
      description: 'Tạo thẻ theo dõi lỗi trên Trello',
      args: { boardId: 'board-1', listId: 'list-1', name: 'Fix issue #42' },
    },
    {
      id: 'step_3',
      tool: 'slack.send_message',
      description: 'Thông báo cho nhóm qua Slack #engineering',
      args: { channel: '#engineering', text: 'Đã tạo thẻ Trello cho issue #42' },
    },
  ];

  it('groups PlanStep[] into Make.com orbital service nodes with w-16 h-16 ring-4 cards, step count bubbles, and dotted SVG connectors', () => {
    render(
      <WorkflowFlowCanvas
        steps={linearSteps}
        mode="preview"
        resourceLabels={{ 'sheet-1': 'Bảng KPI Q4', '#kpi-updates': '#kpi-updates' }}
      />
    );

    const canvas = screen.getByTestId('workflow-flow-canvas');
    expect(canvas).toHaveAttribute('data-flow-mode', 'preview');
    expect(canvas).not.toHaveAttribute('data-router-node', 'true');

    const sheetsNode = screen.getByTestId('workflow-node-mysheets');
    const slackNode = screen.getByTestId('workflow-node-slack');
    expect(sheetsNode).toHaveClass('w-16', 'h-16', 'rounded-full', 'bg-white', 'ring-4');
    expect(slackNode).toHaveClass('w-16', 'h-16', 'rounded-full', 'bg-white', 'ring-4');

    // Step count bubble shows 2 actions on mysheets and 1 action on slack
    expect(screen.getByTestId('node-bubble-mysheets')).toHaveTextContent('2');
    expect(screen.getByTestId('node-bubble-slack')).toHaveTextContent('1');

    // Dotted SVG connector lines between orbital nodes
    const dottedLines = canvas.querySelectorAll('[stroke-dasharray="4 4"]');
    expect(dottedLines.length).toBeGreaterThanOrEqual(1);
  });

  it('automatically renders a central emerald Router fan-out node with curved dotted SVG branches when 1 source fans out to >= 2 destinations', () => {
    render(
      <WorkflowFlowCanvas
        steps={fanOutSteps}
        mode="preview"
        resourceLabels={{ 'VinhDat267/ati-test': 'VinhDat267/ati-test', 'board-1': 'Sprint Board' }}
      />
    );

    const canvas = screen.getByTestId('workflow-flow-canvas');
    expect(canvas).toHaveAttribute('data-router-node', 'true');

    const routerNode = screen.getByTestId('workflow-router-node');
    expect(routerNode).toBeInTheDocument();
    expect(canvas).toHaveTextContent('Router');
    expect(canvas).toHaveTextContent('1st');
    expect(canvas).toHaveTextContent('2nd');

    expect(screen.getByTestId('workflow-node-github')).toBeInTheDocument();
    expect(screen.getByTestId('workflow-node-trello')).toBeInTheDocument();
    expect(screen.getByTestId('workflow-node-slack')).toBeInTheDocument();
  });

  it('toggles the interactive Node Inspector popover when clicking an orbital service node', () => {
    const onStepPreview = vi.fn();
    render(
      <WorkflowFlowCanvas
        steps={linearSteps}
        mode="preview"
        resourceLabels={{ 'sheet-1': 'Bảng KPI Q4' }}
        onStepPreview={onStepPreview}
      />
    );

    expect(screen.queryByTestId('workflow-node-inspector')).toBeNull();

    // Click mysheets orbital node to open inspector
    fireEvent.click(screen.getByTestId('workflow-node-mysheets'));
    const inspector = screen.getByTestId('workflow-node-inspector');
    expect(inspector).toBeInTheDocument();
    expect(within(inspector).getByText('Đọc bảng KPI quý 4')).toBeInTheDocument();
    expect(within(inspector).getByText('Ghi thêm dòng tổng kết')).toBeInTheDocument();
    expect(within(inspector).getByText(/Đọc bảng tính/i)).toBeInTheDocument();
    expect(within(inspector).getByText(/Thêm dòng vào bảng tính của bạn/i)).toBeInTheDocument();
    expect(within(inspector).getAllByText(/Bảng KPI Q4/i).length).toBeGreaterThanOrEqual(1);

    // Click again to close inspector
    fireEvent.click(screen.getByTestId('workflow-node-mysheets'));
    expect(screen.queryByTestId('workflow-node-inspector')).toBeNull();
  });

  it('renders execution status indicators (✓, spinner, !) in executing and receipt modes', () => {
    const { rerender } = render(
      <WorkflowFlowCanvas
        steps={fanOutSteps}
        stepStatuses={{ step_1: 'succeeded', step_2: 'running', step_3: 'failed' }}
        mode="executing"
      />
    );

    const canvas = screen.getByTestId('workflow-flow-canvas');
    expect(canvas).toHaveAttribute('data-flow-mode', 'executing');
    expect(screen.getByTestId('node-bubble-github')).toHaveTextContent('✓');
    expect(screen.getByTestId('node-bubble-trello')).toHaveAttribute('data-status-icon', 'running');
    expect(screen.getByTestId('node-bubble-slack')).toHaveTextContent('!');

    rerender(
      <WorkflowFlowCanvas
        steps={fanOutSteps}
        stepStatuses={{ step_1: 'succeeded', step_2: 'succeeded', step_3: 'succeeded' }}
        mode="receipt"
      />
    );

    expect(screen.getByTestId('workflow-flow-canvas')).toHaveAttribute('data-flow-mode', 'receipt');
    expect(screen.getByTestId('node-bubble-github')).toHaveTextContent('✓');
    expect(screen.getByTestId('node-bubble-trello')).toHaveTextContent('✓');
    expect(screen.getByTestId('node-bubble-slack')).toHaveTextContent('✓');
  });

  it('renders service-level nodes and Auto-Digest indicator in schedule mode', () => {
    render(
      <WorkflowFlowCanvas
        services={['mycalendar', 'slack']}
        isAutoDigest={true}
        mode="schedule"
      />
    );

    const canvas = screen.getByTestId('workflow-flow-canvas');
    expect(canvas).toHaveAttribute('data-flow-mode', 'schedule');
    expect(canvas).toHaveAttribute('data-auto-digest', 'true');
    expect(screen.getByTestId('workflow-node-mycalendar')).toBeInTheDocument();
    expect(screen.getByTestId('workflow-node-slack')).toBeInTheDocument();
    expect(canvas).toHaveTextContent(/Auto-Digest/i);
  });

  it('integrates WorkflowFlowCanvas into PlanMoment, ExecutionMoment, ReceiptMoment, and ScheduleMoment without breaking DOM contracts', () => {
    const plan: ActivePlan = {
      id: 'plan-101',
      summary: 'Đọc GitHub, tạo thẻ Trello và báo Slack',
      resourceLabels: { 'VinhDat267/ati-test': 'VinhDat267/ati-test', 'board-1': 'Sprint Board' },
      steps: fanOutSteps,
    };

    const { unmount: unmountPlan } = render(
      <PlanMoment
        request="Đọc issue #42 rồi tạo thẻ Trello và báo Slack"
        runtimeMode="sandbox"
        plan={plan}
        services={[]}
        destination={(step) => step.description}
        onPreview={vi.fn()}
        onApprove={vi.fn()}
        onCancel={vi.fn()}
        onEdit={vi.fn()}
        inlineComposer={null}
      />
    );

    const planCanvas = screen.getByTestId('workflow-flow-canvas');
    expect(planCanvas).toHaveAttribute('data-flow-mode', 'preview');
    expect(planCanvas).toHaveAttribute('data-router-node', 'true');
    expect(screen.getByRole('list', { name: 'Các bước thực thi' })).toBeInTheDocument();
    expect(document.querySelectorAll('#plan-cards-container article')).toHaveLength(3);
    unmountPlan();

    const execSteps = fanOutSteps.map((s, idx) => ({
      id: s.id,
      tool: s.tool,
      description: s.description,
      status: idx === 0 ? ('succeeded' as const) : idx === 1 ? ('running' as const) : ('pending' as const),
    }));

    const { unmount: unmountExec } = render(
      <ExecutionMoment
        request="Đọc issue #42"
        steps={execSteps}
        planSteps={fanOutSteps}
        labels={plan.resourceLabels}
        destination={(step) => step.description}
      />
    );

    const execCanvas = screen.getByTestId('workflow-flow-canvas');
    expect(execCanvas).toHaveAttribute('data-flow-mode', 'executing');
    expect(document.querySelectorAll('#exec-timeline > div')).toHaveLength(3);
    unmountExec();

    const receiptSteps = fanOutSteps.map((s) => ({
      id: s.id,
      tool: s.tool,
      description: s.description,
      status: 'succeeded' as const,
      duration: '0,5 giây',
    }));

    const { unmount: unmountReceipt } = render(
      <ReceiptMoment
        request="Đọc issue #42"
        steps={receiptSteps}
        planSteps={fanOutSteps}
        services={[]}
        labels={plan.resourceLabels}
        destination={(step) => step.description}
        onNewConversation={vi.fn()}
        onFollowup={vi.fn()}
      />
    );

    const receiptCanvas = screen.getByTestId('workflow-flow-canvas');
    expect(receiptCanvas).toHaveAttribute('data-flow-mode', 'receipt');
    expect(document.getElementById('moment-6')!.firstElementChild).toContainElement(
      document.getElementById('heading-moment-6')!
    );
    expect(document.getElementById('receipt-chain')).toBeInTheDocument();
    unmountReceipt();

    const scheduleMsg: ChatMessage = {
      id: 'msg-sched-1',
      role: 'assistant',
      content: '',
      metadata: {
        type: 'schedule_proposal',
        proposal: {
          kind: 'schedule',
          action: 'create',
          name: 'Bản tin sáng',
          request: 'Đọc lịch họp và gửi vào Slack',
          recurrence: { type: 'daily', time: '07:30' },
          summary: 'Lịch gửi bản tin sáng',
        },
        services: ['mycalendar', 'slack'],
        nextRuns: ['2026-10-26T00:30:00Z'],
      },
    };

    render(<ScheduleMoment message={scheduleMsg} convId="conv-1" navigate={vi.fn()} onEdit={vi.fn()} />);
    const schedCanvas = screen.getByTestId('workflow-flow-canvas');
    expect(schedCanvas).toHaveAttribute('data-flow-mode', 'schedule');
    expect(screen.getByTestId('workflow-node-mycalendar')).toBeInTheDocument();
    expect(screen.getByTestId('workflow-node-slack')).toBeInTheDocument();
  });

  it('Upgrade #1: keeps upstream sequential nodes in a linear chain BEFORE Router and places Router right before parallel destination branches, with connector ears, schedule clock badge, and wrench/filter data-flow badges', () => {
    const fourServiceSteps: PlanStep[] = [
      {
        id: 'step_1',
        tool: 'mysheets.read_range',
        description: 'Đọc danh sách khách hàng từ Google Sheets',
        args: { spreadsheetId: 'sheet-1', range: 'A1:D20' },
      },
      {
        id: 'step_2',
        tool: 'github.create_issue',
        description: 'Tạo issue tổng hợp trên GitHub',
        args: { repo: 'org/repo', title: { $ref: 'step_1.output.summary' } },
        dependsOn: ['step_1'],
      },
      {
        id: 'step_3',
        tool: 'trello.create_card',
        description: 'Tạo thẻ theo dõi trên Trello',
        args: { boardId: 'b1', listId: 'l1', name: { $ref: 'step_2.output.title' } },
        dependsOn: ['step_2'],
      },
      {
        id: 'step_4',
        tool: 'slack.send_message',
        description: 'Thông báo kết quả vào Slack',
        args: { channel: '#ops', text: { $template: 'Đã tạo ${step_2.output.url}' } },
        dependsOn: ['step_2'],
      },
    ];

    const { unmount } = render(<WorkflowFlowCanvas steps={fourServiceSteps} mode="preview" />);

    const upstreamSection = screen.getByTestId('workflow-upstream-chain');
    const branchSection = screen.getByTestId('workflow-branch-chain');

    // Both mysheets and github are in the upstream linear chain BEFORE Router
    expect(within(upstreamSection).getByTestId('workflow-node-mysheets')).toBeInTheDocument();
    expect(within(upstreamSection).getByTestId('workflow-node-github')).toBeInTheDocument();

    // Trello and Slack are in the parallel branch chain AFTER Router
    expect(within(branchSection).getByTestId('workflow-node-trello')).toBeInTheDocument();
    expect(within(branchSection).getByTestId('workflow-node-slack')).toBeInTheDocument();

    // Make.com signature connector ears & wrench/filter badges & data mapping indicator
    const canvas = screen.getByTestId('workflow-flow-canvas');
    expect(canvas.querySelectorAll('[data-connector-ear="true"]').length).toBeGreaterThanOrEqual(4);
    expect(canvas.querySelectorAll('[data-flow-filter-badge="true"]').length).toBeGreaterThanOrEqual(1);
    expect(canvas).toHaveTextContent(/Dữ liệu từ Việc 1 → Việc 2/i);
    unmount();

    // In schedule mode, first node renders a dark clock trigger badge
    render(<WorkflowFlowCanvas services={['mycalendar', 'slack']} isAutoDigest={true} mode="schedule" />);
    expect(document.querySelector('[data-trigger-badge="schedule"]')).not.toBeNull();
  });

  it('Upgrade #4 & Orca Audit #2: highlights matching step cards in PlanMoment when clicking an orbital service node, shows data-flow badges on PlanMoment cards, and provides a 1-click recurring schedule button in ReceiptMoment', () => {
    const planWithDataRef: ActivePlan = {
      id: 'plan-data-flow',
      summary: 'Đọc GitHub rồi tạo thẻ Trello',
      steps: [
        {
          id: 'step_1',
          tool: 'github.get_issue',
          description: 'Đọc thông tin issue #42 trên GitHub',
          args: { repo: 'VinhDat267/ati-test', issueNumber: 42 },
        },
        {
          id: 'step_2',
          tool: 'trello.create_card',
          description: 'Tạo thẻ theo dõi lỗi trên Trello',
          args: { boardId: 'board-1', listId: 'list-1', name: { $ref: 'step_1.output.title' } },
          dependsOn: ['step_1'],
        },
      ],
    };

    const { unmount } = render(
      <PlanMoment
        request="Đọc issue #42 rồi tạo thẻ Trello"
        runtimeMode="sandbox"
        plan={planWithDataRef}
        services={[]}
        destination={(step) => step.description}
        onPreview={vi.fn()}
        onApprove={vi.fn()}
        onCancel={vi.fn()}
        onEdit={vi.fn()}
        inlineComposer={null}
      />
    );

    // Data-flow badge rendered on step card 2 in PlanMoment
    const step2Card = document.querySelector('[data-od-id="plan-item-2"]') as HTMLElement;
    expect(step2Card).toHaveTextContent(/Dữ liệu từ Việc 1 → Việc 2/i);
    expect(step2Card).not.toHaveAttribute('data-highlighted-step', 'true');

    // Click trello orbital node in WorkflowFlowCanvas -> step 2 card becomes highlighted
    fireEvent.click(screen.getByTestId('workflow-node-trello'));
    expect(step2Card).toHaveAttribute('data-highlighted-step', 'true');
    unmount();

    const onFollowup = vi.fn();
    render(
      <ReceiptMoment
        request="Đọc issue #42 rồi tạo thẻ Trello"
        steps={planWithDataRef.steps.map((s) => ({
          id: s.id,
          tool: s.tool,
          description: s.description,
          status: 'succeeded' as const,
        }))}
        planSteps={planWithDataRef.steps}
        services={[]}
        destination={(step) => step.description}
        onNewConversation={vi.fn()}
        onFollowup={onFollowup}
      />
    );

    const scheduleBtn = screen.getByTestId('receipt-schedule-workflow-btn');
    expect(scheduleBtn).toHaveTextContent(/Đặt lịch chạy định kỳ quy trình này/i);
    fireEvent.click(scheduleBtn);
    expect(onFollowup).toHaveBeenCalledWith(
      expect.stringContaining('Mỗi sáng 08:00, tự động thực hiện: Đọc issue #42 rồi tạo thẻ Trello')
    );
  });

  it('Upgrade #3: renders Multi-Service Playbooks strip in RequestMoment that populates #prompt-input on click while preserving the 4-button single-service grid', () => {
    function RequestHarness() {
      const [draft, setDraft] = useState('');
      const inputRef = createRef<HTMLTextAreaElement>();
      return (
        <RequestMoment
          services={[
            { id: 'trello', name: 'Trello', configured: true, connected: true },
            { id: 'slack', name: 'Slack', configured: true, connected: true },
            { id: 'github', name: 'GitHub', configured: true, connected: true },
            { id: 'sheets', name: 'Google Sheets', configured: true, connected: true },
          ]}
          loading={false}
          error={null}
          draft={draft}
          planning={false}
          input={inputRef}
          onDraft={setDraft}
          onSend={vi.fn()}
          onKeyDown={vi.fn()}
          onSettings={vi.fn()}
          navigate={vi.fn()}
          servicePrompt={(s) => s.name}
        />
      );
    }

    render(<RequestHarness />);

    // Single-service grid contract preserved
    const singleGrid = screen.getByText('Gợi ý việc phổ biến theo công cụ của bạn').nextElementSibling!;
    expect(within(singleGrid as HTMLElement).getAllByRole('button')).toHaveLength(4);

    // Multi-Service Playbooks strip present and interactive
    const playbooksSection = screen.getByTestId('multi-service-playbooks');
    expect(playbooksSection).toBeInTheDocument();
    const playbookButtons = within(playbooksSection).getAllByRole('button');
    expect(playbookButtons.length).toBeGreaterThanOrEqual(2);

    fireEvent.click(playbookButtons[0]);
    const promptInput = document.getElementById('prompt-input') as HTMLTextAreaElement;
    expect(promptInput.value.length).toBeGreaterThan(15);
  });

  it('Upgrade #5 & Orca Audit #3: renders Personal OAuth 1-Click vs Workspace summary and updated OAuth footer in SettingsPage', async () => {
    vi.spyOn(apiClient, 'getServices').mockResolvedValue({
      services: [
        {
          id: 'notion',
          name: 'Notion',
          connected: true,
          configured: true,
          connectionStatus: 'healthy',
          lastCheckedAt: '2026-10-08T07:05:00Z',
          tools: ['notion.create_page'],
          allowedScope: ['page_123'],
        },
        {
          id: 'slack',
          name: 'Slack',
          connected: true,
          configured: true,
          connectionStatus: 'healthy',
          lastCheckedAt: '2026-10-08T07:05:00Z',
          tools: ['slack.send_message'],
          allowedScope: ['C123456'],
        },
        {
          id: 'gmail',
          name: 'Gmail',
          connection: 'personal',
          connected: true,
          configured: true,
          connectionStatus: 'healthy',
          lastCheckedAt: '2026-10-08T07:05:00Z',
          tools: ['gmail.send_message'],
        },
      ],
      canConfigure: true,
    });

    render(<SettingsPage user={{ id: 'u-1', email: 'u@example.com', name: 'User', role: 'admin' }} navigate={vi.fn()} onLogout={vi.fn()} />);

    expect(await screen.findByText('2 / 8 dịch vụ đã thiết lập · 2 kết nối tốt')).toBeInTheDocument();
    expect(screen.getByTestId('settings-oauth-summary')).toBeInTheDocument();
    expect(document.body).toHaveTextContent(/OAuth 1-Click cá nhân \(Gmail, Calendar, Sheets, Trello, GitHub, Telegram\)/i);
  });

  it('Upgrade #6: renders compact WorkflowFlowCanvas in ScheduleSection and status filter pills in HistoryPage', async () => {
    vi.spyOn(apiClient, 'getSchedules').mockResolvedValue({
      schedules: [
        {
          id: 'sched-1',
          name: 'Bản tin sáng',
          kind: 'calendar_digest',
          request: 'Đọc lịch họp và gửi vào Slack',
          recurrence: { type: 'daily', time: '07:30' },
          timezone: 'Asia/Ho_Chi_Minh',
          services: ['mycalendar', 'slack'],
          status: 'active',
          version: 1,
          nextRuns: ['2026-10-26T00:30:00Z'],
          lastRun: null,
        } as any,
      ],
    });
    vi.spyOn(apiClient, 'getConversations').mockResolvedValue({
      conversations: [
        {
          id: 'conv-done',
          title: 'Tạo thẻ Trello xong',
          created_at: '2026-10-25T08:00:00Z',
          updatedAt: '2026-10-25T08:01:00Z',
          status: 'completed',
        },
        {
          id: 'conv-chat',
          title: 'Hỏi về lịch họp',
          created_at: '2026-10-25T09:00:00Z',
          updatedAt: '2026-10-25T09:01:00Z',
          status: 'chatting',
        },
      ],
    });
    useChatStore.getState().setConversations([]);

    render(
      <SchedulesCapabilityContext.Provider value={true}>
        <HistoryPage user={{ id: 'u-1', email: 'u@example.com', name: 'User', role: 'admin' }} navigate={vi.fn()} onLogout={vi.fn()} />
      </SchedulesCapabilityContext.Provider>
    );

    expect(await screen.findByText('Tạo thẻ Trello xong')).toBeInTheDocument();
    expect(screen.getByText('Hỏi về lịch họp')).toBeInTheDocument();

    // Compact WorkflowFlowCanvas inside ScheduleRow
    expect((await screen.findAllByTestId('workflow-flow-canvas')).length).toBeGreaterThanOrEqual(1);

    // Status filter pills work and never render forbidden string "Lọc theo trạng thái"
    expect(screen.queryByText(/Lọc theo trạng thái/)).toBeNull();
    const filterGroup = screen.getByRole('group', { name: 'Bộ lọc trạng thái hội thoại' });
    fireEvent.click(within(filterGroup).getByRole('button', { name: /Hoàn thành/i }));
    expect(screen.getByText('Tạo thẻ Trello xong')).toBeInTheDocument();
    expect(screen.queryByText('Hỏi về lịch họp')).toBeNull();
  });

  it('Round 3 Polish (#1, #2, #3): renders horizontal spreadsheet grid preview for mysheets.append_rows, prefills schedule request on Sửa click, and highlights steps in ExecutionMoment and ReceiptMoment on node click', () => {
    // Round 3 Item #1: mysheets.append_rows uses previewStyle="rows" and renders spreadsheet-grid-preview
    const mysheetsStep: PlanStep = {
      id: 'step_sheet',
      tool: 'mysheets.append_rows',
      description: 'Thêm dòng KPI vào Google Sheets của bạn',
      args: {
        spreadsheetId: 'sheet-personal-1',
        sheetTitle: 'KPI',
        rows: [['Q4 Revenue', '125%', 'Đạt mục tiêu']],
      },
    };
    const { unmount: unmountPreview } = render(
      <PreviewContents
        step={mysheetsStep}
        destination="Bảng KPI Q4 · trang KPI"
        labels={{ 'sheet-personal-1': 'Bảng KPI Q4' }}
      />
    );
    expect(screen.getByRole('table')).toHaveClass('w-full', 'text-left', 'text-xs');
    const gridPreview = screen.getByTestId('spreadsheet-grid-preview');
    expect(gridPreview).toHaveTextContent('Cột A');
    expect(gridPreview).toHaveTextContent('Cột B');
    expect(gridPreview).toHaveTextContent('Cột C');
    expect(gridPreview).toHaveTextContent('Q4 Revenue');
    expect(gridPreview).toHaveTextContent('125%');
    unmountPreview();

    // Round 3 Item #2: ScheduleMoment "Sửa" button stores proposal.request in sessionStorage and invokes onEdit()
    const onEdit = vi.fn();
    sessionStorage.removeItem('ati_prefill_prompt');
    const scheduleMsg: ChatMessage = {
      id: 'msg-sched-r3',
      role: 'assistant',
      content: '',
      metadata: {
        type: 'schedule_proposal',
        proposal: {
          kind: 'schedule',
          action: 'create',
          name: 'Bản tin sáng 08:00',
          request: 'Đọc lịch họp Google Calendar và gửi báo cáo vào Slack #general',
          recurrence: { type: 'daily', time: '08:00' },
          summary: 'Lịch gửi bản tin sáng',
        },
        services: ['mycalendar', 'slack'],
        nextRuns: ['2026-10-26T01:00:00Z'],
      },
    };
    const { unmount: unmountSched } = render(
      <ScheduleMoment message={scheduleMsg} convId="conv-r3" navigate={vi.fn()} onEdit={onEdit} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Sửa' }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('ati_prefill_prompt')).toBe(
      'Đọc lịch họp Google Calendar và gửi báo cáo vào Slack #general'
    );
    sessionStorage.removeItem('ati_prefill_prompt');
    unmountSched();

    // Round 3 Item #3: Interactive Node-to-Step Highlighting in ExecutionMoment & ReceiptMoment
    const execSteps = fanOutSteps.map((s, idx) => ({
      id: s.id,
      tool: s.tool,
      description: s.description,
      status: idx === 0 ? ('succeeded' as const) : ('running' as const),
    }));
    const { unmount: unmountExec } = render(
      <ExecutionMoment
        request="Đọc issue #42"
        steps={execSteps}
        planSteps={fanOutSteps}
        destination={(step) => step.description}
      />
    );
    const execItem2 = document.getElementById('exec-item-2')!;
    expect(execItem2).not.toHaveAttribute('data-highlighted-step', 'true');
    fireEvent.click(screen.getByTestId('workflow-node-trello'));
    expect(execItem2).toHaveAttribute('data-highlighted-step', 'true');
    unmountExec();

    render(
      <ReceiptMoment
        request="Đọc issue #42"
        steps={fanOutSteps.map((s) => ({
          id: s.id,
          tool: s.tool,
          description: s.description,
          status: 'succeeded' as const,
        }))}
        planSteps={fanOutSteps}
        services={[]}
        destination={(step) => step.description}
        onNewConversation={vi.fn()}
        onFollowup={vi.fn()}
      />
    );
    fireEvent.click(screen.getByTestId('workflow-node-slack'));
    const highlightedReceiptCards = document.querySelectorAll('#receipt-chain [data-highlighted-step="true"]');
    expect(highlightedReceiptCards).toHaveLength(1);
    expect(highlightedReceiptCards[0]).toHaveTextContent(/Thông báo cho nhóm qua Slack/i);
  });
});
