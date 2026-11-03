/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useChatStore } from '../src/store/chat-store';
import { apiClient } from '../src/services/api-client';
import { setActiveWorkspaceId } from '../src/services/workspace-storage';
import { PlanoraChatWorkspace } from '../src/planora/workspace/PlanoraChatWorkspace';
import { PlanoraConversationFeed } from '../src/planora/workspace/PlanoraConversationFeed';
import type { ChatMessage, ActivePlan, ServiceInfo, User } from '../src/types';

const testUser: User = {
  id: 'user-test-1',
  name: 'Test Planora User',
  email: 'planora@example.test',
  role: 'member',
};

const sampleServices: ServiceInfo[] = [
  { id: 'github', name: 'GitHub', configured: true, connected: true, connectionStatus: 'healthy' },
  { id: 'trello', name: 'Trello', configured: true, connected: true, connectionStatus: 'healthy' },
];

const samplePlan: ActivePlan = {
  id: 'plan-test-123',
  summary: 'Tạo thẻ Trello và issue GitHub',
  resourceLabels: { repo: 'VinhDat267/ATI_Project' },
  steps: [
    { id: 'step_1', tool: 'github.create_issue', description: 'Tạo issue', args: { repo: 'VinhDat267/ATI_Project', title: 'Bug' } },
    { id: 'step_2', tool: 'trello.create_card', description: 'Tạo card', args: { listId: 'list-1', name: 'Bug card' } },
  ],
};

beforeEach(() => {
  localStorage.clear();
  setActiveWorkspaceId('personal');
  useChatStore.getState().reset();
  vi.spyOn(apiClient, 'getRuntime').mockResolvedValue({ runtimeMode: 'sandbox', schedulesEnabled: true });
  vi.spyOn(apiClient, 'getServices').mockResolvedValue({ services: sampleServices, canConfigure: true });
  vi.spyOn(apiClient, 'getMe').mockResolvedValue({ user: testUser });
  vi.spyOn(apiClient, 'getConversations').mockResolvedValue({ conversations: [] });
  vi.spyOn(apiClient, 'sendMessage').mockResolvedValue({ messageId: 'msg-reply-1' });
  vi.spyOn(apiClient, 'approvePlan').mockResolvedValue({ success: true } as any);
  vi.spyOn(apiClient, 'rejectPlan').mockResolvedValue({ success: true } as any);
});

afterEach(() => {
  cleanup();
  useChatStore.getState().reset();
  vi.restoreAllMocks();
});

describe('PL-05: Planora Chat Workspace & One-Composer Policy', () => {
  describe('1. One-Composer Policy across all active states', () => {
    it('renders exactly one textbox on empty workspace (Moment 1)', () => {
      render(
        <PlanoraChatWorkspace
          services={sampleServices}
          servicesLoading={false}
          servicesError={null}
          onSendMessage={vi.fn()}
          onNewConversation={vi.fn()}
          onSelectConversation={vi.fn()}
          onSettings={vi.fn()}
          onApprove={vi.fn()}
          onCancel={vi.fn()}
          recovery={null}
        />
      );

      const textboxes = screen.getAllByRole('textbox');
      expect(textboxes).toHaveLength(1);
      expect(screen.getByRole('textbox', { name: 'Mô tả công việc bạn muốn thực hiện' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Hôm nay bạn muốn nhờ việc gì?');
    });

    it('renders exactly one textbox during plan preview (Moment 4) with no duplicate inline composer', () => {
      useChatStore.setState({ activePlan: samplePlan, planStatus: 'preview' });

      render(
        <PlanoraChatWorkspace
          services={sampleServices}
          servicesLoading={false}
          servicesError={null}
          onSendMessage={vi.fn()}
          onNewConversation={vi.fn()}
          onSelectConversation={vi.fn()}
          onSettings={vi.fn()}
          onApprove={vi.fn()}
          onCancel={vi.fn()}
          recovery={null}
        />
      );

      // In Moment 4 preview, composer is suppressed until user chooses to edit
      expect(screen.queryAllByRole('textbox')).toHaveLength(0);
      // Main action buttons exist
      expect(screen.getByRole('button', { name: 'Duyệt kế hoạch' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Hủy|Từ chối/ })).toBeInTheDocument();

      // Clicking "Sửa qua Chat" reveals exactly 1 inline composer
      fireEvent.click(screen.getByRole('button', { name: 'Sửa qua Chat' }));
      expect(screen.getAllByRole('textbox')).toHaveLength(1);
    });

    it('renders exactly one textbox during clarification (Moment 3)', () => {
      useChatStore.setState({
        activeClarification: {
          question: 'Bạn muốn chọn kho GitHub nào?',
          options: ['VinhDat267/ATI_Project', 'VinhDat267/sandbox'],
        },
      });

      render(
        <PlanoraChatWorkspace
          services={sampleServices}
          servicesLoading={false}
          servicesError={null}
          onSendMessage={vi.fn()}
          onNewConversation={vi.fn()}
          onSelectConversation={vi.fn()}
          onSettings={vi.fn()}
          onApprove={vi.fn()}
          onCancel={vi.fn()}
          recovery={null}
        />
      );

      expect(screen.getAllByRole('textbox')).toHaveLength(1);
      expect(screen.getByRole('textbox', { name: /Nhập câu trả lời làm rõ yêu cầu|Mô tả công việc bạn muốn thực hiện/ })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'VinhDat267/ATI_Project' })).toBeInTheDocument();
    });

    it('clicking a suggestion pre-fills the single composer without auto-sending', () => {
      const onSendMessage = vi.fn();

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

      const suggestionBtn = screen.getByRole('button', { name: 'Tạo issue mới trên GitHub' });
      fireEvent.click(suggestionBtn);

      const textbox = screen.getByRole('textbox');
      expect(textbox).toHaveValue('Tạo issue mới trên GitHub');
      expect(onSendMessage).not.toHaveBeenCalled();
    });
  });

  describe('2. Keyboard interactions, IME and Enter handling', () => {
    it('does not send message on Enter when native IME composition is active', () => {
      const onSendMessage = vi.fn();

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

      const textbox = screen.getByRole('textbox');
      fireEvent.change(textbox, { target: { value: 'tiếng Việt đang gõ' } });

      // Simulate Enter with IME composing
      fireEvent.keyDown(textbox, {
        key: 'Enter',
        shiftKey: false,
        isComposing: true,
        keyCode: 229,
      });

      expect(onSendMessage).not.toHaveBeenCalled();
      expect(textbox).toHaveValue('tiếng Việt đang gõ');
    });

    it('does not send message on Shift+Enter (inserts newline)', () => {
      const onSendMessage = vi.fn();

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

      const textbox = screen.getByRole('textbox');
      fireEvent.change(textbox, { target: { value: 'Dòng 1' } });

      fireEvent.keyDown(textbox, {
        key: 'Enter',
        shiftKey: true,
        nativeEvent: { isComposing: false } as any,
      });

      expect(onSendMessage).not.toHaveBeenCalled();
    });

    it('sends message on Enter without Shift and clears draft', () => {
      const onSendMessage = vi.fn();

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

      const textbox = screen.getByRole('textbox');
      fireEvent.change(textbox, { target: { value: 'Gửi yêu cầu tổng hợp' } });

      fireEvent.keyDown(textbox, {
        key: 'Enter',
        shiftKey: false,
        nativeEvent: { isComposing: false } as any,
      });

      expect(onSendMessage).toHaveBeenCalledWith('Gửi yêu cầu tổng hợp');
      expect(textbox).toHaveValue('');
    });
  });

  describe('3. Conversation Feed & Scheduled Run attribution', () => {
    it('renders user messages with label "Bạn" and timestamps', () => {
      const messages: ChatMessage[] = [
        {
          id: 'msg-1',
          role: 'user',
          content: 'Kiểm tra PR mới',
          created_at: '2026-11-04T08:30:00.000Z',
        },
      ];

      render(<PlanoraConversationFeed messages={messages} />);

      const log = screen.getByRole('log', { name: 'Hội thoại' });
      expect(within(log).getByText('Kiểm tra PR mới')).toBeInTheDocument();
      expect(within(log).getByText(/Bạn/)).toBeInTheDocument();
    });

    it('renders scheduled run message with actual scheduled run source, NOT "Bạn"', () => {
      const messages: ChatMessage[] = [
        {
          id: 'msg-sched-1',
          role: 'user',
          content: 'Tổng hợp GitHub lúc 08:00',
          metadata: {
            type: 'schedule_run',
            name: 'Digest sáng hàng ngày',
            dueAt: '2026-11-04T08:00:00.000Z',
          },
          created_at: '2026-11-04T08:00:01.000Z',
        },
      ];

      render(<PlanoraConversationFeed messages={messages} />);

      const log = screen.getByRole('log', { name: 'Hội thoại' });
      // Should show schedule run attribution
      expect(within(log).getByText(/Lịch "Digest sáng hàng ngày" tự gửi lúc/)).toBeInTheDocument();
      expect(within(log).queryByText(/^Bạn$/)).toBeNull();
    });

    it('renders historical plan summary without active approval buttons', () => {
      const messages: ChatMessage[] = [
        {
          id: 'msg-plan-hist',
          role: 'assistant',
          content: 'Kế hoạch: Tạo thẻ Trello',
          metadata: {
            type: 'plan',
            plan: samplePlan,
          },
          created_at: '2026-11-04T08:31:00.000Z',
        },
      ];

      render(<PlanoraConversationFeed messages={messages} />);

      const log = screen.getByRole('log', { name: 'Hội thoại' });
      expect(within(log).getByText(/Kế hoạch 2 việc đã sẵn sàng/)).toBeInTheDocument();
      // Must NOT contain active approval button
      expect(within(log).queryByRole('button', { name: 'Duyệt kế hoạch' })).toBeNull();
    });
  });

  describe('4. Auto-scroll behavior', () => {
    it('tracks near-bottom state and updates scroll position accordingly', () => {
      const messages: ChatMessage[] = [
        { id: 'm1', role: 'user', content: 'Tin 1' },
      ];

      const { rerender } = render(<PlanoraConversationFeed messages={messages} />);
      const container = screen.getByRole('log', { name: 'Hội thoại' });

      // Mock scroll dimensions
      Object.defineProperty(container, 'scrollHeight', { value: 1000, configurable: true });
      Object.defineProperty(container, 'clientHeight', { value: 400, configurable: true });
      Object.defineProperty(container, 'scrollTop', { value: 600, writable: true, configurable: true });

      // User scrolls near bottom: scrollHeight(1000) - clientHeight(400) - scrollTop(600) = 0 < 120
      fireEvent.scroll(container);

      // Add a message
      rerender(<PlanoraConversationFeed messages={[...messages, { id: 'm2', role: 'assistant', content: 'Tin 2' }]} />);
      expect(container.scrollTop).toBe(1000);

      // Now simulate user scrolling UP to read history (scrollTop = 100, remaining = 500 >= 120)
      container.scrollTop = 100;
      fireEvent.scroll(container);

      // Add another message while reading history
      rerender(
        <PlanoraConversationFeed
          messages={[
            ...messages,
            { id: 'm2', role: 'assistant', content: 'Tin 2' },
            { id: 'm3', role: 'assistant', content: 'Tin 3' },
          ]}
        />
      );
      // Scroll position should NOT jump to bottom!
      expect(container.scrollTop).toBe(100);
    });
  });

  describe('5. Reopening saved conversation (PBI-03)', () => {
    it('displays SavedConversation card when opening settled conversation', () => {
      const messages: ChatMessage[] = [
        { id: 'm-req', role: 'user', content: 'Yêu cầu cũ đã lưu', created_at: '2026-11-04T07:00:00.000Z' },
        { id: 'm-plan', role: 'assistant', content: 'Kế hoạch đã hết hạn', metadata: { type: 'plan', plan: samplePlan }, created_at: '2026-11-04T07:01:00.000Z' },
      ];

      useChatStore.setState({
        conversationId: 'conv-settled-1',
        messages,
        activePlan: null,
        planStatus: 'idle',
      });

      render(
        <PlanoraChatWorkspace
          services={sampleServices}
          servicesLoading={false}
          servicesError={null}
          onSendMessage={vi.fn()}
          onNewConversation={vi.fn()}
          onSelectConversation={vi.fn()}
          onSettings={vi.fn()}
          onApprove={vi.fn()}
          onCancel={vi.fn()}
          recovery={null}
        />
      );

      const savedRegion = screen.getByRole('region', { name: 'Hội thoại đã lưu' });
      expect(savedRegion).toBeInTheDocument();
      expect(within(savedRegion).getByText('Yêu cầu cũ đã lưu')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Dùng lại yêu cầu này' })).toBeInTheDocument();
    });
  });
});
