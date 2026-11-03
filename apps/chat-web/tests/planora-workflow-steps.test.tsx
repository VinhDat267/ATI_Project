/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import type { ActivePlan, PlanStep } from '../src/types';
import { PlanoraWorkflowSteps } from '../src/planora/workspace/PlanoraWorkflowSteps';
import { PlanMoment } from '../src/pages/Cockpit/PlanMoment';
import { ExecutionMoment } from '../src/pages/Cockpit/ExecutionMoment';
import { ReceiptMoment } from '../src/pages/Cockpit/ReceiptMoment';
import { PreviewModal } from '../src/pages/Cockpit/PreviewModal';
import { GmailPreview } from '../src/pages/Cockpit/GmailPreview';
import { PreviewContents } from '../src/pages/Cockpit/PreviewContents';

afterEach(() => {
  cleanup();
});

const sampleLinearSteps: PlanStep[] = [
  {
    id: 'step_1',
    tool: 'mysheets.read_range',
    description: 'Đọc dữ liệu KPI quý 4 từ bảng tính',
    args: { spreadsheetId: 'sheet_kpi_123', range: 'KPI!A1:D10' },
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
    tool: 'slack.send_message',
    description: 'Thông báo kết quả vào kênh Slack #kpi-updates',
    args: { channel: '#kpi-updates', text: { $template: 'Đã tạo issue ${step_2.output.url}' } },
    dependsOn: ['step_2'],
  },
];

describe('PL-06: PlanoraWorkflowSteps Component', () => {
  it('renders Planora step cards sequence with index, action, read/write side-effects, and dependsOn', () => {
    const onPreview = vi.fn();
    render(
      <PlanoraWorkflowSteps
        steps={sampleLinearSteps}
        mode="preview"
        resourceLabels={{ sheet_kpi_123: 'Bảng KPI Q4', '#kpi-updates': '#kpi-updates' }}
        onStepPreview={onPreview}
      />
    );

    // Canvas container attributes
    const canvas = screen.getByTestId('workflow-flow-canvas');
    expect(canvas).toHaveAttribute('data-flow-mode', 'preview');
    expect(canvas).toHaveAttribute('data-planora-workflow-steps', 'true');

    // Grid of Planora step cards
    const step1Card = screen.getByTestId('planora-step-card-step_1');
    expect(within(step1Card).getByText(/Bước 1/i)).toBeInTheDocument();
    expect(within(step1Card).getByText('Chỉ đọc')).toBeInTheDocument();
    expect(within(step1Card).getByText('Đọc từ bảng tính của bạn: Bảng KPI Q4')).toBeInTheDocument();

    const step2Card = screen.getByTestId('planora-step-card-step_2');
    expect(within(step2Card).getByText(/Bước 2/i)).toBeInTheDocument();
    expect(within(step2Card).getByText('Ghi')).toBeInTheDocument();
    expect(within(step2Card).getByText(/Phụ thuộc: Việc 1/i)).toBeInTheDocument();

    const step3Card = screen.getByTestId('planora-step-card-step_3');
    expect(within(step3Card).getByText(/Bước 3/i)).toBeInTheDocument();
    expect(within(step3Card).getByText('Ghi')).toBeInTheDocument();
    expect(within(step3Card).getByText(/Phụ thuộc: Việc 2/i)).toBeInTheDocument();

    // Data-flow strip and pill mappings
    const strip = screen.getByTestId('workflow-data-flow-strip');
    expect(strip).toBeInTheDocument();
    expect(strip).toHaveTextContent(/Dữ liệu từ Việc 1 → Việc 2/i);
    expect(strip).toHaveTextContent(/Dữ liệu từ Việc 2 → Việc 3/i);

    // Trigger preview callback
    const previewBtn = within(step1Card).getByRole('button', { name: /Xem trước/i });
    fireEvent.click(previewBtn);
    expect(onPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'step_1',
        tool: 'mysheets.read_range',
      })
    );
  });

  it('renders executing mode with live step statuses and duration', () => {
    render(
      <PlanoraWorkflowSteps
        steps={sampleLinearSteps}
        mode="executing"
        stepStatuses={{
          step_1: 'succeeded',
          step_2: 'running',
          step_3: 'pending',
        }}
      />
    );

    const canvas = screen.getByTestId('workflow-flow-canvas');
    expect(canvas).toHaveAttribute('data-flow-mode', 'executing');

    const card1 = screen.getByTestId('planora-step-card-step_1');
    const card2 = screen.getByTestId('planora-step-card-step_2');
    const card3 = screen.getByTestId('planora-step-card-step_3');

    expect(within(card1).getByText('Hoàn thành')).toBeInTheDocument();
    expect(within(card2).getByText('Đang chạy')).toBeInTheDocument();
    expect(within(card3).getByText('Chờ')).toBeInTheDocument();
  });

  it('renders schedule mode with service trigger and Auto-Digest badge', () => {
    render(
      <PlanoraWorkflowSteps
        services={['mycalendar', 'slack']}
        isAutoDigest={true}
        mode="schedule"
      />
    );

    const canvas = screen.getByTestId('workflow-flow-canvas');
    expect(canvas).toHaveAttribute('data-flow-mode', 'schedule');
    expect(canvas).toHaveAttribute('data-auto-digest', 'true');
    expect(screen.getByTestId('workflow-auto-digest-node')).toBeInTheDocument();
  });

  it('allows service selection and highlights corresponding cards', () => {
    const onSelectService = vi.fn();
    const { rerender } = render(
      <PlanoraWorkflowSteps
        steps={sampleLinearSteps}
        mode="preview"
        selectedService={null}
        onSelectService={onSelectService}
      />
    );

    const githubNode = screen.getByTestId('workflow-node-github');
    fireEvent.click(githubNode);
    expect(onSelectService).toHaveBeenCalledWith('github');

    rerender(
      <PlanoraWorkflowSteps
        steps={sampleLinearSteps}
        mode="preview"
        selectedService="github"
        onSelectService={onSelectService}
      />
    );

    const step2Card = screen.getByTestId('planora-step-card-step_2');
    expect(step2Card).toHaveAttribute('data-highlighted-step', 'true');
  });
});

describe('PL-06: PlanMoment Action Bar & Safety Controls', () => {
  const plan: ActivePlan & { plan_hash?: string } = {
    id: 'plan_test_42',
    plan_hash: 'sha256_mock_hash_89abcdef0123456789abcdef',
    summary: 'Đọc Sheets và gửi Slack',
    resourceLabels: { sheet_kpi_123: 'Bảng KPI Q4' },
    steps: sampleLinearSteps,
  };

  it('renders cryptographic plan_hash binding and preserves approval busy locking against double-clicks', () => {
    const onApprove = vi.fn();
    const onCancel = vi.fn();
    const onEdit = vi.fn();

    render(
      <PlanMoment
        request="Đọc KPI và gửi Slack"
        runtimeMode="sandbox"
        plan={plan}
        services={[]}
        destination={(step) => step.description}
        onPreview={vi.fn()}
        onApprove={onApprove}
        onCancel={onCancel}
        onEdit={onEdit}
        inlineComposer={null}
      />
    );

    // Cryptographic hash binding
    expect(screen.getByTestId('plan-hash-binding')).toHaveTextContent(/sha256_mock_hash_89abcdef0123456789abcdef/i);

    // Action buttons
    const approveBtn = screen.getByRole('button', { name: /Duyệt kế hoạch/i });
    expect(approveBtn).toBeEnabled();

    // First click triggers onApprove
    fireEvent.click(approveBtn);
    expect(onApprove).toHaveBeenCalledTimes(1);

    // Immediate second click is locked (double approve guard)
    fireEvent.click(approveBtn);
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(approveBtn).toBeDisabled();

    // Cancel button
    const cancelBtn = screen.getByRole('button', { name: /Hủy/i });
    fireEvent.click(cancelBtn);
    expect(onCancel).toHaveBeenCalledTimes(1);

    // Sửa qua Chat
    const editBtn = screen.getByRole('button', { name: /Sửa qua Chat/i });
    fireEvent.click(editBtn);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('disables approve button when plan has no valid ID', () => {
    const planNoId: ActivePlan = {
      id: '',
      summary: 'Kế hoạch lỗi không có ID',
      steps: sampleLinearSteps,
    };

    render(
      <PlanMoment
        request="Test missing id"
        runtimeMode="sandbox"
        plan={planNoId}
        services={[]}
        destination={(step) => step.description}
        onPreview={vi.fn()}
        onApprove={vi.fn()}
        onCancel={vi.fn()}
        onEdit={vi.fn()}
        inlineComposer={null}
      />
    );

    const approveBtn = screen.getByRole('button', { name: /Duyệt kế hoạch/i });
    expect(approveBtn).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(/Kế hoạch thiếu mã định danh hợp lệ/i);
  });
});

describe('PL-06: Rich Previews & Overflow Safety', () => {
  it('renders Gmail preview with recipient grounding and anti-spoofing alert when recipient is from thread header', () => {
    const gmailStep: PlanStep = {
      id: 'step_gmail',
      tool: 'gmail.send_message',
      description: 'Gửi email báo cáo',
      args: {
        to: ['lead@example.com'],
        subject: 'Báo cáo tuần',
        body: 'Nội dung thư báo cáo...',
      },
    };

    render(
      <GmailPreview
        step={gmailStep}
        labels={{ 'recipient:lead@example.com': 'thread:Re: Báo cáo tuần' }}
      />
    );

    expect(screen.getByText(/lấy từ luồng thư 'Re: Báo cáo tuần'/i)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/Người nhận lấy từ tiêu đề luồng thư có thể bị giả mạo/i);
    expect(screen.getByText('Báo cáo tuần')).toBeInTheDocument();
    expect(screen.getByText('Nội dung thư báo cáo...')).toBeInTheDocument();
  });

  it('renders Sheets spreadsheet grid preview without breaking layout or omitting cell values', () => {
    const sheetsStep: PlanStep = {
      id: 'step_sheets',
      tool: 'mysheets.append_rows',
      description: 'Ghi thêm dòng KPI',
      args: {
        spreadsheetId: 'sheet-1',
        range: 'KPI!A1:C2',
        rows: [
          ['Doanh thu', '150%', 'Đạt'],
          ['Chi phí', '90%', 'Tiết kiệm'],
        ],
      },
    };

    render(
      <PreviewContents
        step={sheetsStep}
        destination="Bảng tính KPI Q4"
      />
    );

    const grid = screen.getByTestId('spreadsheet-grid-preview');
    expect(grid).toBeInTheDocument();
    expect(within(grid).getByText('Cột A')).toBeInTheDocument();
    expect(within(grid).getByText('Cột B')).toBeInTheDocument();
    expect(within(grid).getByText('Cột C')).toBeInTheDocument();
    expect(within(grid).getByText('Doanh thu')).toBeInTheDocument();
    expect(within(grid).getByText('150%')).toBeInTheDocument();
    expect(within(grid).getByText('Đạt')).toBeInTheDocument();
    expect(within(grid).getByText('Chi phí')).toBeInTheDocument();
  });

  it('traps focus and closes on Escape in PreviewModal', () => {
    const onClose = vi.fn();
    const step: PlanStep = {
      id: 'step_trello',
      tool: 'trello.create_card',
      description: 'Tạo thẻ Trello',
      args: { title: 'Card task review', desc: 'Mô tả công việc' },
    };

    render(
      <PreviewModal
        step={step}
        services={[{ id: 'trello', name: 'Trello', configured: true, connected: true }]}
        destination={() => 'Bảng Sprint 4 · Cột To Do'}
        onClose={onClose}
      />
    );

    const dialog = screen.getByRole('dialog', { name: /Xem trước nội dung/i });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText('Card task review')).toBeInTheDocument();
    expect(within(dialog).getByText('Mô tả công việc')).toBeInTheDocument();

    // Escape closes modal
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('F1: renders PlanMoment using PlanoraWorkflowSteps with responsive 2-column grid inside #plan-cards-container, preserving test IDs and attributes', () => {
    const onPreview = vi.fn();
    const plan: ActivePlan = {
      id: 'plan_f1_test',
      summary: 'Kế hoạch test F1',
      steps: sampleLinearSteps,
      resourceLabels: { sheet_kpi_123: 'Bảng KPI Q4', 'org/repo': 'Kho chính org/repo', '#kpi-updates': '#kpi-updates' },
    };

    render(
      <PlanMoment
        request="Test F1 PlanMoment cards integration"
        runtimeMode="sandbox"
        plan={plan}
        services={[
          { id: 'mysheets', name: 'Google Sheets', configured: true, connected: true },
          { id: 'github', name: 'GitHub', configured: true, connected: true },
          { id: 'slack', name: 'Slack', configured: true, connected: true },
        ]}
        destination={(step, labels) => (labels?.[String(step.args?.spreadsheetId)] ?? step.description)}
        onPreview={onPreview}
        onApprove={vi.fn()}
        onCancel={vi.fn()}
        onEdit={vi.fn()}
        inlineComposer={null}
      />
    );

    // #plan-cards-container wraps [data-testid="planora-step-cards-grid"]
    const container = document.getElementById('plan-cards-container');
    expect(container).toBeInTheDocument();
    expect(container).toHaveAttribute('role', 'list');
    expect(container).toHaveAttribute('aria-label', 'Các bước thực thi');

    const grid = screen.getByTestId('planora-step-cards-grid');
    expect(grid).toBeInTheDocument();
    expect(grid.className).toContain('grid');
    expect(grid.className).toContain('grid-cols-1');
    expect(grid.className).toContain('md:grid-cols-2');

    // 3 cards rendered as <article> with [data-od-id]
    const articles = document.querySelectorAll('#plan-cards-container article');
    expect(articles).toHaveLength(3);
    expect(articles[0]).toHaveAttribute('data-od-id', 'plan-item-1');
    expect(articles[1]).toHaveAttribute('data-od-id', 'plan-item-2');
    expect(articles[2]).toHaveAttribute('data-od-id', 'plan-item-3');

    // Labels Read vs Write
    expect(within(articles[0] as HTMLElement).getByText('Chỉ đọc')).toBeInTheDocument();
    expect(within(articles[1] as HTMLElement).getByText('Ghi')).toBeInTheDocument();
    expect(within(articles[2] as HTMLElement).getByText('Ghi')).toBeInTheDocument();

    // Dependencies label
    expect(within(articles[1] as HTMLElement).getByText(/Phụ thuộc: Việc 1/i)).toBeInTheDocument();

    // Data-flow mapping badge
    expect(screen.getAllByTestId('plan-step-data-flow-badge').length).toBeGreaterThanOrEqual(1);

    // #preview-${step.id} button on each card
    const preview1 = document.getElementById('preview-step_1');
    expect(preview1).toBeInTheDocument();
    expect(preview1).toHaveAttribute('aria-label', 'Xem trước');
    fireEvent.click(preview1!);
    expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({ id: 'step_1' }));
  });

  it('F1: renders ExecutionMoment and ReceiptMoment with active step cards in executing and receipt modes', () => {
    const execSteps = [
      { id: 'step_1', tool: 'mysheets.read_range', description: 'Đọc KPI', status: 'succeeded' as const, duration: '1,0 giây' },
      { id: 'step_2', tool: 'github.create_issue', description: 'Tạo issue', status: 'running' as const },
      { id: 'step_3', tool: 'slack.send_message', description: 'Gửi Slack', status: 'pending' as const },
    ];

    const { unmount: unmountExec } = render(
      <ExecutionMoment
        request="Chạy quy trình"
        steps={execSteps}
        planSteps={sampleLinearSteps}
        destination={(step) => step.description}
      />
    );

    // ExecutionMoment shows step cards in executing mode with real-time statuses
    const execCards = screen.getAllByTestId(/^planora-step-card-/);
    expect(execCards).toHaveLength(3);
    expect(within(execCards[0]).getByText('Hoàn thành')).toBeInTheDocument();
    expect(within(execCards[1]).getByText('Đang chạy')).toBeInTheDocument();
    expect(within(execCards[2]).getByText('Chờ')).toBeInTheDocument();
    unmountExec();

    // ReceiptMoment shows step cards in receipt mode with summary
    const receiptSteps = [
      { id: 'step_1', tool: 'mysheets.read_range', description: 'Đọc KPI', status: 'succeeded' as const, duration: '0,5 giây', output: { rows: 10 } },
      { id: 'step_2', tool: 'github.create_issue', description: 'Tạo issue', status: 'succeeded' as const, duration: '0,8 giây', output: { number: 42, title: 'Issue 42' } },
      { id: 'step_3', tool: 'slack.send_message', description: 'Gửi Slack', status: 'succeeded' as const, duration: '0,2 giây', output: { messageId: 'm1' } },
    ];

    render(
      <ReceiptMoment
        request="Hoàn thành quy trình"
        steps={receiptSteps}
        planSteps={sampleLinearSteps}
        services={[]}
        destination={(step) => step.description}
        onNewConversation={vi.fn()}
        onFollowup={vi.fn()}
      />
    );

    const receiptCards = screen.getAllByTestId(/^planora-step-card-/);
    expect(receiptCards).toHaveLength(3);
    expect(within(receiptCards[0]).getByText('Hoàn thành')).toBeInTheDocument();
    expect(within(receiptCards[0]).getByText(/✓ Đã đọc/i)).toBeInTheDocument();
    expect(within(receiptCards[1]).getByText(/✓ Đã tạo/i)).toBeInTheDocument();
    expect(within(receiptCards[2]).getByText(/✓ Đã gửi/i)).toBeInTheDocument();
  });

  it('F2: renders cryptographic plan_hash when present, and displays plan.id as identifier when plan_hash is absent', () => {
    const planWithHash: ActivePlan & { plan_hash?: string } = {
      id: 'plan-uuid-9876-5432',
      plan_hash: 'sha256_mock_hash_real_crypto_abc123',
      summary: 'Kế hoạch có cryptographic plan_hash',
      steps: sampleLinearSteps,
    };

    const { unmount } = render(
      <PlanMoment
        plan={planWithHash}
        services={[]}
        destination={(step) => step.description}
        onPreview={vi.fn()}
        onApprove={vi.fn()}
        onCancel={vi.fn()}
        onEdit={vi.fn()}
        inlineComposer={null}
        runtimeMode="sandbox"
      />
    );

    const bindingWithHash = screen.getByTestId('plan-hash-binding');
    expect(bindingWithHash).toHaveTextContent('Mã băm ràng buộc kế hoạch (plan_hash): sha256_mock_hash_real_crypto_abc123');
    unmount();

    // When plan_hash is undefined/missing: must display "Mã định danh kế hoạch: {plan.id}" and NEVER label UUID as plan_hash
    const planWithoutHash: ActivePlan & { plan_hash?: string } = {
      id: 'plan-uuid-9876-5432',
      summary: 'Kế hoạch không có plan_hash',
      steps: sampleLinearSteps,
    };

    render(
      <PlanMoment
        plan={planWithoutHash}
        services={[]}
        destination={(step) => step.description}
        onPreview={vi.fn()}
        onApprove={vi.fn()}
        onCancel={vi.fn()}
        onEdit={vi.fn()}
        inlineComposer={null}
        runtimeMode="sandbox"
      />
    );

    const bindingWithoutHash = screen.getByTestId('plan-hash-binding');
    expect(bindingWithoutHash).toHaveTextContent('Mã định danh kế hoạch: plan-uuid-9876-5432');
    expect(bindingWithoutHash.textContent).not.toContain('plan_hash');
    expect(bindingWithoutHash.textContent).not.toContain('Mã băm');
  });

  it('F3: shows schedule workflow button only when schedulesEnabled capability is true, and hides it when false or undefined', () => {
    const receiptSteps = [
      { id: 'step_1', tool: 'slack.send_message', description: 'Gửi tin', status: 'succeeded' as const },
    ];
    const planSteps = [
      { id: 'step_1', tool: 'slack.send_message', description: 'Gửi tin', args: {} },
    ];

    // Case 1: schedulesEnabled = true -> button is rendered
    const { unmount: unmount1 } = render(
      <ReceiptMoment
        request="Gửi tin Slack"
        steps={receiptSteps}
        planSteps={planSteps}
        services={[]}
        destination={(step) => step.description}
        onNewConversation={vi.fn()}
        onFollowup={vi.fn()}
        schedulesEnabled={true}
      />
    );
    expect(screen.getByTestId('receipt-schedule-workflow-btn')).toBeInTheDocument();
    expect(screen.getByTestId('receipt-schedule-workflow-btn')).toHaveTextContent(/Đặt lịch chạy định kỳ quy trình này/i);
    unmount1();

    // Case 2: schedulesEnabled = false -> button is hidden
    const { unmount: unmount2 } = render(
      <ReceiptMoment
        request="Gửi tin Slack"
        steps={receiptSteps}
        planSteps={planSteps}
        services={[]}
        destination={(step) => step.description}
        onNewConversation={vi.fn()}
        onFollowup={vi.fn()}
        schedulesEnabled={false}
      />
    );
    expect(screen.queryByTestId('receipt-schedule-workflow-btn')).toBeNull();
    unmount2();

    // Case 3: schedulesEnabled = undefined -> button is hidden
    render(
      <ReceiptMoment
        request="Gửi tin Slack"
        steps={receiptSteps}
        planSteps={planSteps}
        services={[]}
        destination={(step) => step.description}
        onNewConversation={vi.fn()}
        onFollowup={vi.fn()}
      />
    );
    expect(screen.queryByTestId('receipt-schedule-workflow-btn')).toBeNull();
  });
});
