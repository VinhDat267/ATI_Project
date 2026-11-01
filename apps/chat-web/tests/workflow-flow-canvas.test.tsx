/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { WorkflowFlowCanvas } from '../src/components/WorkflowFlowCanvas';
import { PlanMoment } from '../src/pages/Cockpit/PlanMoment';
import { ExecutionMoment } from '../src/pages/Cockpit/ExecutionMoment';
import { ReceiptMoment } from '../src/pages/Cockpit/ReceiptMoment';
import { ScheduleMoment } from '../src/pages/Cockpit/ScheduleMoment';
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
});
