import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import type { ChatMessage, ExecutionSnapshot, ServiceInfo, User } from '../src/types';
import { AnswerMoment, RefusalMoment, ExpandedClarificationMoment } from '../src/pages/Responses/ResponseMoment';
import { ClarificationMoment } from '../src/pages/Cockpit/ClarificationMoment';
import { SlowPlanningMoment, PlanningErrorMoment, OfflineBanner } from '../src/pages/Errors/PlanningErrors';
import { RecoveryMoment, type RecoveryControls } from '../src/pages/Cockpit/RecoveryMoment';
import { RecoveryEditor } from '../src/pages/Cockpit/RecoveryEditor';
import { PlanoraChatWorkspace } from '../src/planora/workspace/PlanoraChatWorkspace';
import { useChatStore } from '../src/store/chat-store';
import { apiClient } from '../src/services/api-client';
import { setActiveWorkspaceId } from '../src/services/workspace-storage';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const tokensCssPath = path.resolve(__dirname, '../src/planora/styles/tokens.css');
const tokensCss = readFileSync(tokensCssPath, 'utf8');

function parseTokens(css: string) {
  const extract = (selector: string) => {
    const idx = css.indexOf(selector);
    if (idx === -1) return {} as Record<string, string>;
    const block = css.slice(idx).split('}')[0];
    return Object.fromEntries(
      [...block.matchAll(/--(planora-[a-z0-9-]+):\s*(#[0-9A-Fa-f]{3,8})\s*;/g)].map(m => [m[1], m[2]])
    );
  };
  return {
    light: extract(':root {'),
    dark: extract('html.dark,'),
  };
}

const { light: lightTokens, dark: darkTokens } = parseTokens(tokensCss);

function luminance(hex: string): number {
  const rgb = hex
    .replace('#', '')
    .match(/.{2}/g)!
    .map(x => parseInt(x, 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

function contrastRatio(hex1: string, hex2: string): number {
  const l1 = luminance(hex1);
  const l2 = luminance(hex2);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

const testUser: User = {
  id: 'user-pl-07',
  name: 'PL-07 Test User',
  email: 'test@example.com',
  role: 'member',
};

afterEach(() => {
  cleanup();
  useChatStore.getState().reset();
  vi.restoreAllMocks();
});

const sampleServices: ServiceInfo[] = [
  { id: 'trello', name: 'Trello', configured: true, connected: true, connectionStatus: 'healthy', personalStatus: 'connected' },
  { id: 'github', name: 'GitHub', configured: true, connected: true, connectionStatus: 'healthy', personalStatus: 'connected' },
  { id: 'slack', name: 'Slack', configured: true, connected: true, connectionStatus: 'healthy' },
  { id: 'gmail', name: 'Gmail', configured: true, connected: true, connectionStatus: 'healthy', personalStatus: 'connected' },
  { id: 'notion', name: 'Notion', configured: false, connected: false, connectionStatus: 'unconfigured' },
];

const makeSnapshot = (
  stepStatus: 'failed' | 'unknown' | 'succeeded',
  recoveryActions: Array<'retry' | 'skip' | 'stop' | 'continue'>
): ExecutionSnapshot => ({
  plan: {
    id: 'plan-rec-1',
    convId: 'conv-rec-1',
    status: 'partial',
    summary: 'Kế hoạch phục hồi kiểm thử',
    steps: [
      { id: 's1', tool: 'trello.create_card', description: 'Tạo thẻ Trello', args: { listId: 'list1', name: 'Task 1' } },
      { id: 's2', tool: 'slack.send_message', description: 'Gửi Slack', args: { channel: '#ati-test', text: 'Hello' } },
    ],
  },
  execution: {
    status: 'partial',
    pausedStepId: 's2',
  },
  steps: [
    { stepId: 's1', tool: 'trello.create_card', status: 'succeeded', output: { id: 'card-123', url: 'https://trello.com/c/123' } },
    { stepId: 's2', tool: 'slack.send_message', status: stepStatus, error: 'Không thể kết nối máy chủ Slack' },
  ],
  recoveryActions,
});

describe('PL-07: Planora Responses & Recovery', () => {
  describe('AnswerMoment', () => {
    it('renders answer text, sources, safe lookup links, and expanded lookups', () => {
      const message: ChatMessage = {
        id: 'msg-ans-1',
        role: 'assistant',
        content: 'Tổng hợp danh sách các công việc hiện tại.',
        metadata: {
          type: 'answer',
          lookups: [
            { tool: 'trello.list_cards', query: 'Sprint 4', resultCount: 3, links: ['https://trello.com/c/12345', 'javascript:alert(1)'] },
          ],
          usedDirectory: ['trello'],
        },
      };

      render(<AnswerMoment message={message} request="Tìm việc sprint 4" services={sampleServices} />);

      expect(screen.getByText('Câu trả lời')).toBeInTheDocument();
      expect(screen.getByText('Tổng hợp danh sách các công việc hiện tại.')).toBeInTheDocument();
      expect(screen.getByText(/1 lần tra cứu · Danh mục Trello · hãy kiểm lại ở Trello/)).toBeInTheDocument();

      // Lookups toggle
      const toggleBtn = screen.getByRole('button', { name: 'Đã tra cứu' });
      expect(screen.queryByRole('list', { name: '' })).toBeNull();

      fireEvent.click(toggleBtn);
      expect(screen.getByText('trello.list_cards')).toBeInTheDocument();
      expect(screen.getByText('Sprint 4')).toBeInTheDocument();
      expect(screen.getByText('3 kết quả')).toBeInTheDocument();

      // Only safe HTTPS link is rendered
      const safeLink = screen.getByRole('link', { name: 'https://trello.com/c/12345' });
      expect(safeLink).toHaveAttribute('href', 'https://trello.com/c/12345');
      expect(safeLink).toHaveAttribute('target', '_blank');
      expect(safeLink).toHaveAttribute('rel', 'noopener noreferrer');
      expect(screen.queryByText('javascript:alert(1)')).toBeNull();

      // No writes notice
      expect(screen.getByText('Chưa có gì được ghi lên công cụ nào.')).toBeInTheDocument();
    });
  });

  describe('RefusalMoment', () => {
    it('renders unavailable services and action CTA without auto-resend', () => {
      const message: ChatMessage = {
        id: 'msg-ref-1',
        role: 'assistant',
        content: 'Từ chối yêu cầu: Notion chưa kết nối.',
        metadata: {
          type: 'refusal',
          reason: 'Notion chưa được kết nối hoặc chưa có tài nguyên được phép.',
          suggestion: 'Bạn hãy kết nối Notion trong Cài đặt.',
          unavailableServices: [{ id: 'notion', name: 'Notion' }],
        },
      };

      const navigate = vi.fn();
      const onEdit = vi.fn();
      const onResend = vi.fn();

      render(
        <RefusalMoment
          message={message}
          request="Tạo trang Notion và gửi Slack"
          services={sampleServices}
          canConfigure={true}
          navigate={navigate}
          onEdit={onEdit}
          onResend={onResend}
        />
      );

      expect(screen.getByText('Tôi chưa làm được yêu cầu này')).toBeInTheDocument();
      expect(screen.getByText('Notion chưa được kết nối hoặc chưa có tài nguyên được phép.')).toBeInTheDocument();
      expect(screen.getByText('Bạn hãy kết nối Notion trong Cài đặt.')).toBeInTheDocument();

      const connectNotionLink = screen.getByRole('link', { name: 'Kết nối Notion' });
      expect(connectNotionLink).toHaveAttribute('href', '/settings#notion');

      fireEvent.click(connectNotionLink);
      expect(navigate).toHaveBeenCalledWith('/settings#notion');

      // Edit button works
      const editBtn = screen.getByRole('button', { name: 'Sửa yêu cầu' });
      fireEvent.click(editBtn);
      expect(onEdit).toHaveBeenCalledWith('Tạo trang Notion và gửi Slack');

      // Resend button is not shown while Notion is still unconfigured
      expect(screen.queryByRole('button', { name: 'Gửi lại yêu cầu' })).toBeNull();
      expect(onResend).not.toHaveBeenCalled();
    });

    it('shows resend button when missing service is now connected, and triggers only on user click', () => {
      const message: ChatMessage = {
        id: 'msg-ref-2',
        role: 'assistant',
        content: 'Từ chối yêu cầu',
        metadata: {
          type: 'refusal',
          reason: 'Trello cần kết nối.',
          unavailableServices: [{ id: 'trello', name: 'Trello' }],
        },
      };

      const onResend = vi.fn();
      render(
        <RefusalMoment
          message={message}
          request="Tạo thẻ Trello"
          services={sampleServices} // Trello is connected in sampleServices
          canConfigure={true}
          navigate={vi.fn()}
          onEdit={vi.fn()}
          onResend={onResend}
          connectFromChat={true}
        />
      );

      expect(screen.getByText(/Trello đã được kết nối. Bạn có thể gửi lại yêu cầu./)).toBeInTheDocument();
      const resendBtn = screen.getByRole('button', { name: 'Gửi lại yêu cầu' });
      expect(onResend).not.toHaveBeenCalled();

      fireEvent.click(resendBtn);
      expect(onResend).toHaveBeenCalledTimes(1);
      expect(onResend).toHaveBeenCalledWith('Tạo thẻ Trello');
    });

    it('shows admin guidance for non-admin members when shared service is missing', () => {
      const message: ChatMessage = {
        id: 'msg-ref-3',
        role: 'assistant',
        content: 'Từ chối yêu cầu',
        metadata: {
          type: 'refusal',
          reason: 'Notion chưa kết nối.',
          unavailableServices: [{ id: 'notion', name: 'Notion' }],
        },
      };

      render(
        <RefusalMoment
          message={message}
          request="Ghi Notion"
          services={sampleServices}
          canConfigure={false}
          navigate={vi.fn()}
          onEdit={vi.fn()}
        />
      );

      expect(screen.getByText('Chỉ quản trị viên kết nối được dịch vụ mới. Bạn hãy báo quản trị viên của nhóm.')).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /Kết nối Notion/ })).toBeNull();
    });
  });

  describe('ClarificationMoment', () => {
    it('allows selecting choices and custom free text without auto-submitting', () => {
      const onSelect = vi.fn();
      const onDraft = vi.fn();
      const onSend = vi.fn();
      const onBack = vi.fn();

      render(
        <ClarificationMoment
          request="Báo kênh tổng kết"
          question="Bạn muốn gửi vào kênh Slack nào?"
          context="Nhóm có nhiều kênh đang hoạt động."
          options={['#general', '#ati-test', '#dev']}
          selected={null}
          onSelect={onSelect}
          draft=""
          onDraft={onDraft}
          planning={false}
          input={{ current: null }}
          onSend={onSend}
          onBack={onBack}
          onKeyDown={vi.fn()}
        />
      );

      expect(screen.getByText('Tôi cần bạn xác nhận thêm một thông tin')).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1, name: 'Bạn muốn gửi vào kênh Slack nào?' })).toBeInTheDocument();
      expect(screen.getByText('Nhóm có nhiều kênh đang hoạt động.')).toBeInTheDocument();

      // Submit button is initially disabled when nothing is selected or typed
      const submitBtn = screen.getByRole('button', { name: 'Xác nhận và tiếp tục' });
      expect(submitBtn).toBeDisabled();

      // Clicking an option selects it, pre-fills draft without auto-submitting
      const optionGeneral = screen.getByRole('radio', { name: '#general' });
      fireEvent.click(optionGeneral);
      expect(onSelect).toHaveBeenCalledWith('#general');
      expect(onDraft).toHaveBeenCalledWith('#general');
      expect(onSend).not.toHaveBeenCalled();

      // Keyboard navigation updates selection and draft
      fireEvent.keyDown(optionGeneral, { key: 'ArrowDown' });
      expect(onSelect).toHaveBeenCalledWith('#ati-test');
      expect(onDraft).toHaveBeenCalledWith('#ati-test');
      expect(onSend).not.toHaveBeenCalled();

      // Typing custom draft
      const customInput = screen.getByLabelText('Nhập câu trả lời làm rõ yêu cầu');
      fireEvent.change(customInput, { target: { value: '#custom-channel' } });
      expect(onDraft).toHaveBeenCalledWith('#custom-channel');
      expect(onSend).not.toHaveBeenCalled();
    });

    it('ExpandedClarificationMoment handles keyboard radio navigation and draft sync', () => {
      const onSelect = vi.fn();
      const onDraft = vi.fn();
      const onSend = vi.fn();
      const onEdit = vi.fn();

      render(
        <ExpandedClarificationMoment
          clarification={{
            question: 'Bạn muốn làm gì với danh sách này?',
            options: ['Gửi Slack', 'Ghi Google Sheets', 'Tạo Trello'],
            context: 'Chọn một trong các hành động.',
            reason: 'read_only',
          }}
          variant="read-only"
          request="Liệt kê danh sách task"
          services={sampleServices}
          canConfigure={true}
          selected="Gửi Slack"
          onSelect={onSelect}
          onDraft={onDraft}
          onSend={onSend}
          onEdit={onEdit}
          navigate={vi.fn()}
          planning={false}
        />
      );

      const radioGhiSheets = screen.getByRole('radio', { name: 'Ghi Google Sheets' });

      // Click option calls onSelect and onDraft without sending
      fireEvent.click(radioGhiSheets);
      expect(onSelect).toHaveBeenCalledWith('Ghi Google Sheets');
      expect(onDraft).toHaveBeenCalledWith('Ghi Google Sheets');
      expect(onSend).not.toHaveBeenCalled();

      // ArrowDown on radio moves to next radio and syncs draft
      fireEvent.keyDown(radioGhiSheets, { key: 'ArrowDown' });
      expect(onSelect).toHaveBeenCalledWith('Tạo Trello');
      expect(onDraft).toHaveBeenCalledWith('Tạo Trello');
      expect(onSend).not.toHaveBeenCalled();

      // Submit sends selected
      const submitBtn = screen.getByRole('button', { name: 'Xác nhận và tiếp tục' });
      fireEvent.click(submitBtn);
      expect(onSend).toHaveBeenCalledWith('Gửi Slack');
    });

    it('ExpandedClarificationMoment destination variant pre-fills draft and uses accessible colors', () => {
      const onSelect = vi.fn();
      const onDraft = vi.fn();
      const onSend = vi.fn();

      render(
        <ExpandedClarificationMoment
          clarification={{
            question: 'Chọn nơi lưu dữ liệu',
            options: ['Kho chính', 'Kho phụ'],
            context: 'Chọn một nơi.',
            reason: 'destination',
          }}
          variant="destination"
          request="Lưu dữ liệu"
          services={sampleServices}
          canConfigure={true}
          selected="Kho chính"
          onSelect={onSelect}
          onDraft={onDraft}
          onSend={onSend}
          onEdit={vi.fn()}
          navigate={vi.fn()}
          planning={false}
        />
      );

      // Verify accessible colors: uses text-[var(--planora-on-primary)] instead of hardcoded text-white
      const optionLabel = screen.getByText('Kho chính');
      expect(optionLabel).toHaveClass('text-[var(--planora-on-primary)]');
      expect(optionLabel).not.toHaveClass('text-white');

      const selectedBadge = screen.getByText('Đã chọn');
      expect(selectedBadge).toHaveClass('text-[var(--planora-on-primary)]');
      expect(selectedBadge).not.toHaveClass('text-white');

      // Click option updates both onSelect and onDraft
      const radioKhoPhu = screen.getByRole('radio', { name: /Kho phụ/ });
      fireEvent.click(radioKhoPhu);
      expect(onSelect).toHaveBeenCalledWith('Kho phụ');
      expect(onDraft).toHaveBeenCalledWith('Kho phụ');
      expect(onSend).not.toHaveBeenCalled();
    });
  });

  describe('PlanningErrors', () => {
    it('SlowPlanningMoment renders gather progress and dismiss button retains prompt', () => {
      const onDismiss = vi.fn();
      render(
        <SlowPlanningMoment
          request="Tạo card và gửi Slack"
          seconds={18}
          gather={{
            isGathering: true,
            summary: '1/2 công cụ đã khảo sát',
            steps: [
              { tool: 'trello.list_boards', status: 'completed', result: 'Bảng ATI' },
              { tool: 'slack.list_channels', status: 'running' },
            ],
          }}
          services={sampleServices}
          onDismiss={onDismiss}
        />
      );

      expect(screen.getByText('Đang lập kế hoạch')).toBeInTheDocument();
      expect(screen.getByText('18')).toBeInTheDocument();
      expect(screen.getByText('ATI đang suy nghĩ lâu hơn thường lệ')).toBeInTheDocument();
      expect(screen.getByText('1/2 công cụ đã khảo sát')).toBeInTheDocument();
      expect(screen.getByText('✓ Đã tra cứu')).toBeInTheDocument();
      expect(screen.getByText('Đang chờ phản hồi…')).toBeInTheDocument();

      const dismissBtn = screen.getByRole('button', { name: 'Thôi chờ, giữ lại câu yêu cầu' });
      fireEvent.click(dismissBtn);
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('PlanningErrorMoment displays server vs network error and retry/edit buttons', () => {
      const onRetry = vi.fn();
      const onEdit = vi.fn();

      const { rerender } = render(
        <PlanningErrorMoment request="Kế hoạch bị lỗi" networkError={false} onRetry={onRetry} onEdit={onEdit} />
      );

      expect(screen.getByRole('heading', { level: 1, name: 'Sự cố máy chủ' })).toBeInTheDocument();
      expect(screen.getByText('Không thể lập kế hoạch lúc này. Hãy thử lại.')).toBeInTheDocument();
      expect(screen.getByText('Kế hoạch bị lỗi')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
      expect(onRetry).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByRole('button', { name: 'Sửa yêu cầu' }));
      expect(onEdit).toHaveBeenCalledTimes(1);

      // Network error
      rerender(<PlanningErrorMoment request="Mất mạng" networkError={true} onRetry={onRetry} onEdit={onEdit} />);
      expect(screen.getByRole('heading', { level: 1, name: 'Mất kết nối máy chủ' })).toBeInTheDocument();
      expect(screen.getByText('Không thể kết nối máy chủ. Hãy kiểm tra mạng và thử lại.')).toBeInTheDocument();
    });

    it('OfflineBanner renders when offline and handles retry action', () => {
      const onRetry = vi.fn();
      render(<OfflineBanner busy={false} onRetry={onRetry} />);

      expect(screen.getByText('Mất kết nối. Hãy kiểm tra mạng và thử lại.')).toBeInTheDocument();
      const retryBtn = screen.getByRole('button', { name: 'Thử lại' });
      fireEvent.click(retryBtn);
      expect(onRetry).toHaveBeenCalledTimes(1);
    });
  });

  describe('RecoveryMoment & RecoveryEditor', () => {
    it('Moment 7 (known failure): renders error, impact, and triggers retry and skip', () => {
      const snapshot = makeSnapshot('failed', ['retry', 'skip', 'stop']);
      const controls: RecoveryControls = {
        busy: false,
        error: null,
        onRetry: vi.fn(),
        onSkip: vi.fn(),
        onStop: vi.fn(),
        onContinue: vi.fn(),
        onEdit: vi.fn(),
      };

      const steps = [
        { id: 's1', tool: 'trello.create_card', description: 'Tạo thẻ Trello', status: 'succeeded' as const, output: { id: 'card-123' } },
        { id: 's2', tool: 'slack.send_message', description: 'Gửi Slack', status: 'failed' as const, error: 'Không thể kết nối máy chủ Slack' },
      ];

      render(
        <RecoveryMoment
          request="Tạo thẻ và gửi Slack"
          moment={7}
          snapshot={snapshot}
          steps={steps}
          services={sampleServices}
          controls={controls}
        />
      );

      expect(screen.getByText('Cần bạn xử lý · Lỗi đã biết')).toBeInTheDocument();
      expect(screen.getByText('Slack chưa hoàn thành việc này')).toBeInTheDocument();
      expect(screen.getByText('Chuyện gì đã xảy ra')).toBeInTheDocument();
      expect(screen.getByText('Không thể kết nối máy chủ Slack')).toBeInTheDocument();
      expect(screen.getByText('Ảnh hưởng hiện tại')).toBeInTheDocument();

      // Retry button
      const retryBtn = screen.getByRole('button', { name: 'Thử lại việc 2' });
      fireEvent.click(retryBtn);
      expect(controls.onRetry).toHaveBeenCalledWith('s2');

      // Skip button
      const skipBtn = screen.getByRole('button', { name: 'Bỏ qua việc này' });
      fireEvent.click(skipBtn);
      expect(controls.onSkip).toHaveBeenCalledWith('s2');
    });

    it('Moment 8 (unknown): TUYỆT ĐỐI KHÔNG có Retry hay Continue, chỉ có Bỏ qua và Dừng', () => {
      const snapshot = makeSnapshot('unknown', ['retry', 'skip', 'stop', 'continue']); // Even if server sent retry/continue!
      const controls: RecoveryControls = {
        busy: false,
        error: null,
        onRetry: vi.fn(),
        onSkip: vi.fn(),
        onStop: vi.fn(),
        onContinue: vi.fn(),
        onEdit: vi.fn(),
      };

      const steps = [
        { id: 's1', tool: 'trello.create_card', description: 'Tạo thẻ Trello', status: 'succeeded' as const },
        { id: 's2', tool: 'slack.send_message', description: 'Gửi Slack', status: 'unknown' as const },
      ];

      render(
        <RecoveryMoment
          request="Tạo thẻ và gửi Slack"
          moment={8}
          snapshot={snapshot}
          steps={steps}
          services={sampleServices}
          controls={controls}
        />
      );

      expect(screen.getByText('Cần bạn xử lý · Chưa chắc kết quả')).toBeInTheDocument();
      expect(screen.getByText('Chưa rõ kết quả trên Slack')).toBeInTheDocument();
      expect(screen.getByText(/Để tránh ghi lặp, hệ thống không thử lại ở bước chưa rõ kết quả/)).toBeInTheDocument();

      // ABSOLUTELY NO RETRY, EDIT, OR CONTINUE BUTTONS
      expect(screen.queryByRole('button', { name: /Thử lại/ })).toBeNull();
      expect(screen.queryByRole('button', { name: /Sửa rồi thử lại/ })).toBeNull();
      expect(screen.queryByRole('button', { name: /Làm tiếp/ })).toBeNull();

      // Skip has safety label
      const skipBtn = screen.getByRole('button', { name: 'Đã thấy kết quả → Bỏ qua bước này và làm tiếp' });
      expect(skipBtn).toBeInTheDocument();
      fireEvent.click(skipBtn);
      expect(controls.onSkip).toHaveBeenCalledWith('s2');

      // Stop button exists
      expect(screen.getByRole('button', { name: 'Dừng kế hoạch' })).toBeInTheDocument();
    });

    it('Stop confirmation dialog: Escape only closes dialog without stopping; Confirm button calls onStop', () => {
      const snapshot = makeSnapshot('failed', ['stop']);
      const controls: RecoveryControls = {
        busy: false,
        error: null,
        onRetry: vi.fn(),
        onSkip: vi.fn(),
        onStop: vi.fn(),
        onContinue: vi.fn(),
        onEdit: vi.fn(),
      };

      const steps = [
        { id: 's2', tool: 'slack.send_message', description: 'Gửi Slack', status: 'failed' as const },
      ];

      render(
        <RecoveryMoment
          request="Gửi tin nhắn"
          moment={7}
          snapshot={snapshot}
          steps={steps}
          services={sampleServices}
          controls={controls}
        />
      );

      const stopBtn = screen.getByRole('button', { name: 'Dừng kế hoạch' });
      fireEvent.click(stopBtn);

      const dialog = screen.getByRole('dialog', { name: 'Dừng kế hoạch?' });
      expect(dialog).toBeInTheDocument();
      expect(controls.onStop).not.toHaveBeenCalled();

      // Pressing Escape closes dialog without stopping
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(controls.onStop).not.toHaveBeenCalled();

      // Open dialog again and click "Dừng hẳn quy trình"
      fireEvent.click(stopBtn);
      const confirmStopBtn = screen.getByRole('button', { name: 'Dừng hẳn quy trình' });
      fireEvent.click(confirmStopBtn);
      expect(controls.onStop).toHaveBeenCalledTimes(1);
    });

    it('RecoveryEditor requires confirmation before submitting edited args', () => {
      const onSubmit = vi.fn();
      const onClose = vi.fn();

      render(
        <RecoveryEditor
          tool="trello.create_card"
          stepArgs={{ listId: 'list-1', title: 'Original Title' }}
          prompt="Ghi chú thêm"
          busy={false}
          onClose={onClose}
          onSubmit={onSubmit}
        />
      );

      expect(screen.getByRole('dialog', { name: 'Sửa rồi thử lại' })).toBeInTheDocument();
      const nameInput = screen.getByDisplayValue('Original Title');
      fireEvent.change(nameInput, { target: { value: 'Updated Title' } });

      // First click: preview / review step
      const reviewBtn = screen.getByRole('button', { name: 'Xem lại nội dung sửa' });
      fireEvent.click(reviewBtn);
      expect(onSubmit).not.toHaveBeenCalled();
      expect(screen.getByText(/Gửi nội dung sửa để ATI lập kế hoạch mới\?/)).toBeInTheDocument();

      // Second click: submit confirmed
      const confirmSubmitBtn = screen.getByRole('button', { name: 'Dừng và gửi yêu cầu sửa' });
      fireEvent.click(confirmSubmitBtn);
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Updated Title' }),
        'Ghi chú thêm'
      );
    });
  });

  describe('F1: Workspace clarification prefill and safe send integration', () => {
    beforeEach(() => {
      localStorage.clear();
      setActiveWorkspaceId('personal');
      useChatStore.getState().reset();
      vi.spyOn(apiClient, 'getRuntime').mockResolvedValue({ runtimeMode: 'sandbox', schedulesEnabled: true });
      vi.spyOn(apiClient, 'getServices').mockResolvedValue({ services: sampleServices, canConfigure: true });
      vi.spyOn(apiClient, 'getMe').mockResolvedValue({ user: testUser });
      vi.spyOn(apiClient, 'getConversations').mockResolvedValue({ conversations: [] });
    });

    it('pre-fills composer draft when clicking read-only clarification option without sending, and posts once on confirm', () => {
      const onSendMessage = vi.fn();
      useChatStore.setState({
        messages: [{ id: 'msg-u1', role: 'user', content: 'Liệt kê danh sách việc' }],
        activeClarification: {
          question: 'Bạn muốn làm gì với danh sách này?',
          options: ['Gửi Slack', 'Ghi Google Sheets'],
          reason: 'read_only',
        },
      });

      render(
        <PlanoraChatWorkspace
          services={sampleServices}
          servicesLoading={false}
          servicesError={null}
          onSendMessage={onSendMessage}
          onNewConversation={vi.fn()}
          onSelectConversation={vi.fn()}
          onSettings={vi.fn()}
          onApprove={vi.fn()}
          onCancel={vi.fn()}
          recovery={null}
        />
      );

      const textarea = document.getElementById('chat-prompt-input') as HTMLTextAreaElement;
      expect(textarea).toBeInTheDocument();
      expect(textarea.value).toBe('');

      // Click option "Ghi Google Sheets"
      const optionSheets = screen.getByRole('radio', { name: 'Ghi Google Sheets' });
      act(() => {
        fireEvent.click(optionSheets);
      });

      // Draft textarea is prefilled
      expect(textarea.value).toBe('Ghi Google Sheets');

      // CRITICAL: Safe behavior - no message is posted yet
      expect(onSendMessage).not.toHaveBeenCalled();

      // User explicitly clicks "Xác nhận và tiếp tục"
      const confirmBtn = screen.getByRole('button', { name: 'Xác nhận và tiếp tục' });
      act(() => {
        fireEvent.click(confirmBtn);
      });

      // Posts exactly once with the selected draft value
      expect(onSendMessage).toHaveBeenCalledTimes(1);
      expect(onSendMessage).toHaveBeenCalledWith('Ghi Google Sheets');
    });

    it('pre-fills composer draft when clicking destination clarification option without sending, and posts once on confirm', () => {
      const onSendMessage = vi.fn();
      useChatStore.setState({
        messages: [{ id: 'msg-u2', role: 'user', content: 'Tạo thẻ việc mới' }],
        activeClarification: {
          question: 'Chọn bảng Trello',
          options: ['Bảng Dự Án', 'Bảng Cá Nhân'],
          reason: 'destination',
        },
      });

      render(
        <PlanoraChatWorkspace
          services={sampleServices}
          servicesLoading={false}
          servicesError={null}
          onSendMessage={onSendMessage}
          onNewConversation={vi.fn()}
          onSelectConversation={vi.fn()}
          onSettings={vi.fn()}
          onApprove={vi.fn()}
          onCancel={vi.fn()}
          recovery={null}
        />
      );

      const textarea = document.getElementById('chat-prompt-input') as HTMLTextAreaElement;
      expect(textarea).toBeInTheDocument();
      expect(textarea.value).toBe('');

      // Click option "Bảng Dự Án"
      const optionProject = screen.getByRole('radio', { name: /Bảng Dự Án/ });
      act(() => {
        fireEvent.click(optionProject);
      });

      // Draft textarea is prefilled
      expect(textarea.value).toBe('Bảng Dự Án');

      // No message sent yet
      expect(onSendMessage).not.toHaveBeenCalled();

      // Click confirm
      const confirmBtn = screen.getByRole('button', { name: 'Xác nhận và tiếp tục' });
      act(() => {
        fireEvent.click(confirmBtn);
      });

      expect(onSendMessage).toHaveBeenCalledTimes(1);
      expect(onSendMessage).toHaveBeenCalledWith('Bảng Dự Án');
    });

    it('pre-fills draft in standard clarification (Moment 3) without sending, and posts once on confirm', () => {
      const onSendMessage = vi.fn();
      useChatStore.setState({
        messages: [{ id: 'msg-u3', role: 'user', content: 'Thông báo nhóm' }],
        activeClarification: {
          question: 'Bạn muốn gửi vào kênh nào?',
          options: ['#general', '#dev'],
        },
      });

      render(
        <PlanoraChatWorkspace
          services={sampleServices}
          servicesLoading={false}
          servicesError={null}
          onSendMessage={onSendMessage}
          onNewConversation={vi.fn()}
          onSelectConversation={vi.fn()}
          onSettings={vi.fn()}
          onApprove={vi.fn()}
          onCancel={vi.fn()}
          recovery={null}
        />
      );

      const customInput = screen.getByLabelText('Nhập câu trả lời làm rõ yêu cầu') as HTMLTextAreaElement;
      expect(customInput.value).toBe('');

      // Click option "#dev"
      const optionDev = screen.getByRole('radio', { name: '#dev' });
      act(() => {
        fireEvent.click(optionDev);
      });

      // Textarea draft is synchronized
      expect(customInput.value).toBe('#dev');

      // No message sent yet
      expect(onSendMessage).not.toHaveBeenCalled();

      // Click confirm
      const confirmBtn = screen.getByRole('button', { name: 'Xác nhận và tiếp tục' });
      act(() => {
        fireEvent.click(confirmBtn);
      });

      expect(onSendMessage).toHaveBeenCalledTimes(1);
      expect(onSendMessage).toHaveBeenCalledWith('#dev');
    });
  });

  describe('F2: WCAG AA Contrast & Accessible Color Pairings', () => {
    it('meets WCAG AA contrast (>= 4.5:1) for all critical PL-07 status pairs in both Light and Dark mode', () => {
      // 1. RecoveryMoment destructive button: errorText on errorBg
      const lightErrorContrast = contrastRatio(lightTokens['planora-error-text'], lightTokens['planora-error-bg']);
      const darkErrorContrast = contrastRatio(darkTokens['planora-error-text'], darkTokens['planora-error-bg']);
      expect(lightErrorContrast).toBeGreaterThanOrEqual(4.5);
      expect(darkErrorContrast).toBeGreaterThanOrEqual(4.5);

      // 2. ResponseMoment destination options: onPrimary on primary
      const lightPrimaryContrast = contrastRatio(lightTokens['planora-on-primary'], lightTokens['planora-primary']);
      const darkPrimaryContrast = contrastRatio(darkTokens['planora-on-primary'], darkTokens['planora-primary']);
      expect(lightPrimaryContrast).toBeGreaterThanOrEqual(4.5);
      expect(darkPrimaryContrast).toBeGreaterThanOrEqual(4.5);

      // 3. OfflineBanner warning/offline: pendingText on pendingBg
      const lightPendingContrast = contrastRatio(lightTokens['planora-pending-text'], lightTokens['planora-pending-bg']);
      const darkPendingContrast = contrastRatio(darkTokens['planora-pending-text'], darkTokens['planora-pending-bg']);
      expect(lightPendingContrast).toBeGreaterThanOrEqual(4.5);
      expect(darkPendingContrast).toBeGreaterThanOrEqual(4.5);
    });

    it('RecoveryMoment stop confirmation button uses accessible destructive styling without low-contrast hardcoded text-white', () => {
      const snapshot = makeSnapshot('failed', ['stop']);
      const controls: RecoveryControls = {
        busy: false,
        error: null,
        onRetry: vi.fn(),
        onSkip: vi.fn(),
        onStop: vi.fn(),
        onContinue: vi.fn(),
        onEdit: vi.fn(),
      };

      render(
        <RecoveryMoment
          request="Gửi tin nhắn"
          moment={7}
          snapshot={snapshot}
          steps={[{ id: 's2', tool: 'slack.send_message', description: 'Gửi Slack', status: 'failed' as const }]}
          services={sampleServices}
          controls={controls}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Dừng kế hoạch' }));
      const confirmStopBtn = screen.getByRole('button', { name: 'Dừng hẳn quy trình' });
      expect(confirmStopBtn).toHaveClass('text-[var(--planora-error-text)]');
      expect(confirmStopBtn).toHaveClass('bg-[var(--planora-error-bg)]');
      expect(confirmStopBtn).not.toHaveClass('text-white');
    });

    it('OfflineBanner uses accessible Planora pending warning tokens instead of low-contrast amber text-white', () => {
      const onRetry = vi.fn();
      render(<OfflineBanner busy={false} onRetry={onRetry} />);

      const banner = screen.getByRole('status');
      expect(banner).toHaveClass('bg-[var(--planora-pending-bg)]');
      expect(banner).toHaveClass('text-[var(--planora-pending-text)]');
      expect(banner).not.toHaveClass('bg-amber-600');
      expect(banner).not.toHaveClass('text-white');
    });
  });
});
