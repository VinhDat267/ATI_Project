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

      // In Moment 4 preview, exactly 1 textbox is rendered (One-Composer Policy)
      expect(screen.getAllByRole('textbox')).toHaveLength(1);
      // Main action buttons exist
      expect(screen.getByRole('button', { name: 'Duyệt kế hoạch' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Hủy|Từ chối/ })).toBeInTheDocument();

      // Clicking "Sửa qua Chat" switches to inline composer while maintaining exactly 1 textbox
      fireEvent.click(screen.getByRole('button', { name: 'Sửa qua Chat' }));
      expect(screen.getAllByRole('textbox')).toHaveLength(1);

      // Closing inline composer returns to dock composer, still exactly 1 textbox
      fireEvent.click(screen.getByRole('button', { name: 'Đóng ô sửa' }));
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

    it('F1 regression: clicking "Sửa yêu cầu" after planning error preserves exactly 1 composer and allows editing and resending without auto-sending', () => {
      const onSendMessage = vi.fn();
      const userMessage: ChatMessage = {
        id: 'user-req-1',
        role: 'user',
        content: 'Tạo thẻ Trello',
        created_at: '2026-11-04T07:00:00.000Z',
      };
      const errorMessage: ChatMessage = {
        id: 'sys-err-1',
        role: 'system',
        content: 'Không thể lập kế hoạch',
        metadata: { type: 'planning_error' },
        created_at: '2026-11-04T07:00:05.000Z',
      };

      useChatStore.setState({
        conversationId: 'c1',
        messages: [userMessage, errorMessage],
        activePlan: null,
        planStatus: 'idle',
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

      // Before edit: exactly 1 composer (in bottom dock)
      expect(screen.getAllByRole('textbox')).toHaveLength(1);
      const editBtn = screen.getByRole('button', { name: 'Sửa yêu cầu' });
      expect(editBtn).toBeInTheDocument();

      // Click "Sửa yêu cầu"
      fireEvent.click(editBtn);

      // Does NOT auto-send
      expect(onSendMessage).not.toHaveBeenCalled();

      // Exactly 1 composer remains visible (now inside RequestMoment on stage)
      const textboxes = screen.getAllByRole('textbox');
      expect(textboxes).toHaveLength(1);
      const input = textboxes[0];
      // Input is pre-filled with the request
      expect(input).toHaveValue('Tạo thẻ Trello');

      // Edit content and send
      fireEvent.change(input, { target: { value: 'Tạo thẻ Trello trên bảng Marketing' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      // Sent with edited text
      expect(onSendMessage).toHaveBeenCalledWith('Tạo thẻ Trello trên bảng Marketing');
    });

    it('F3 regression: renders exactly one composer across all moments and states', () => {
      const user: ChatMessage = { id: 'u1', role: 'user', content: 'Tạo thẻ', created_at: '2026-11-04T07:00:00.000Z' };
      const states: [string, Record<string, any>][] = [
        ['idle (m1)', { messages: [] }],
        ['planning (m2)', { messages: [user], isPlanning: true }],
        ['clarification (m3)', { messages: [user], activeClarification: { question: 'Chọn nơi', options: ['A'] } }],
        ['preview (m4)', { messages: [user], activePlan: samplePlan, planStatus: 'preview' }],
        ['executing (m5)', { messages: [user], activePlan: samplePlan, planStatus: 'executing' }],
        ['completed (m6)', { messages: [user], activePlan: samplePlan, planStatus: 'completed' }],
        ['recovery (m7)', { messages: [user], activePlan: samplePlan, planStatus: 'partial', stepStatuses: { 'step-1': 'failed' } }],
        ['refusal', { messages: [user, { id: 'r1', role: 'assistant', content: 'Từ chối', metadata: { type: 'refusal' } }] }],
        ['unsuccessful', { messages: [user], planStatus: 'stopped' }],
        ['answer', { messages: [user, { id: 'a1', role: 'assistant', content: 'Trả lời', metadata: { type: 'answer' } }] }],
        ['schedule', { conversationId: 's1', messages: [user, { id: 's1', role: 'assistant', content: '', metadata: { type: 'schedule_state', schedule: { id: 'sch-1', convId: 's1', name: 'Lịch', request: 'Tạo thẻ', recurrence: { type: 'daily', time: '08:00' }, services: ['trello'], status: 'active', version: 1, nextRuns: [], lastRun: null, pauseReason: null } } }] }],
      ];

      for (const [name, st] of states) {
        useChatStore.getState().reset();
        useChatStore.setState(st);
        const { unmount } = render(
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
        expect(screen.getAllByRole('textbox'), `Failed for state ${name}`).toHaveLength(1);
        unmount();
      }
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

    it('F2 regression: moment transition does not reset scroll position when user is reading history', () => {
      const messages: ChatMessage[] = Array.from({ length: 40 }, (_, i) => ({
        id: `msg-${i}`,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Nội dung hội thoại kiểm tra cuộn tin ${i}`,
      }));

      useChatStore.setState({
        conversationId: 'c1',
        messages,
        isPlanning: true,
        planningByConversation: { c1: { startedAt: new Date().toISOString() } },
      });

      const { rerender } = render(
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

      // Verify the chat feed container has the required contract classes
      const feed = document.querySelector('.planora-conversation-feed') as HTMLElement;
      expect(feed).toBeInTheDocument();
      expect(feed).toHaveClass('planora-chat-feed');
      expect(feed).toHaveClass('overflow-y-auto');
      expect(feed).toHaveClass('min-h-0');
      expect(feed).toHaveClass('flex-1');

      // Mock scroll properties on feed (JSDOM does not calculate layout geometry)
      Object.defineProperty(feed, 'scrollHeight', { value: 3000, configurable: true });
      Object.defineProperty(feed, 'clientHeight', { value: 600, configurable: true });
      Object.defineProperty(feed, 'scrollTop', { value: 500, writable: true, configurable: true });
      fireEvent.scroll(feed);

      // Transition from moment 2 (planning) to moment 4 (preview)
      useChatStore.setState({
        isPlanning: false,
        activePlan: samplePlan,
        planStatus: 'preview',
      });

      rerender(
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

      // Moment transition MUST NOT forcibly reset feed scroll to 0
      expect(feed.scrollTop).toBe(500);
    });

    it('R1 regression: feed container has independent scroll layout and bottom spacing for dock', () => {
      const messages: ChatMessage[] = [
        { id: 'm1', role: 'user', content: 'Tin 1' },
      ];

      render(<PlanoraConversationFeed messages={messages} />);
      const feed = document.querySelector('.planora-conversation-feed') as HTMLElement;
      expect(feed).toBeInTheDocument();
      expect(feed).toHaveClass('overflow-y-auto');
      expect(feed).toHaveClass('min-h-0');
      expect(feed).toHaveClass('flex-1');
      // Must contain sufficient bottom padding to prevent overlap with #global-bottom-bar
      expect(feed.className).toMatch(/pb-(28|32)/);
      // R4: Dynamic reserve for multiline composer
      expect(feed.style.paddingBottom).toBe('calc(var(--cockpit-bottom-space, 112px) + 24px)');
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

  describe('6. Viewport responsiveness and desktop sidebar offset (F5)', () => {
    it('F5 regression: composer bottom bar includes desktop sidebar offset', () => {
      useChatStore.setState({
        conversationId: 'c1',
        messages: [{ id: 'u1', role: 'user', content: 'Tạo task' }],
        isPlanning: true,
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

      const bottomBar = document.getElementById('global-bottom-bar');
      expect(bottomBar).toBeInTheDocument();
      expect(bottomBar).toHaveClass('fixed', 'bottom-0');
      expect(bottomBar?.className).toContain('lg:left-');
    });
  });

  describe('7. Business-First UX & One-Composer Refactor (Design Brief v2.0 Mẫu 3)', () => {
    it('One-Composer Policy: exactly one submit button in workspace, changing label to "Xác nhận và tiếp tục →" upon clarification selection with two-way sync', () => {
      useChatStore.setState({
        conversationId: 'c-clarify',
        messages: [{ id: 'u1', role: 'user', content: 'Gửi báo cáo' }],
        activeClarification: {
          question: 'Bạn muốn gửi báo cáo qua kênh nào?',
          options: ['Kênh #marketing trên Slack', 'Email đến marketing@example.com'],
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

      // Exactly ONE submit button in the entire workspace
      const submitButtons = screen.getAllByRole('button', { name: /Gửi|Xác nhận và tiếp tục/ });
      expect(submitButtons).toHaveLength(1);
      const submitBtn = submitButtons[0];
      expect(submitBtn).toHaveTextContent('Gửi');

      // Click a radio option
      const radio = screen.getByRole('radio', { name: /Kênh #marketing trên Slack/ });
      fireEvent.click(radio);

      // Submit button text changes to "Xác nhận và tiếp tục →"
      expect(submitBtn).toHaveTextContent('Xác nhận và tiếp tục →');
      // The single textarea is prefilled with the option text
      const textbox = screen.getByRole('textbox');
      expect(textbox).toHaveValue('Kênh #marketing trên Slack');

      // Still exactly ONE submit button (no duplicate button on clarification card body)
      expect(screen.getAllByRole('button', { name: /Gửi|Xác nhận và tiếp tục/ })).toHaveLength(1);

      // Two-way sync: user clears textbox -> radio unselects, button reverts to "Gửi"
      fireEvent.change(textbox, { target: { value: '' } });
      expect(radio).toHaveAttribute('aria-checked', 'false');
      expect(submitBtn).toHaveTextContent('Gửi');

      // Re-select option
      fireEvent.click(radio);
      expect(submitBtn).toHaveTextContent('Xác nhận và tiếp tục →');
      expect(radio).toHaveAttribute('aria-checked', 'true');

      // User types a completely different message -> radio unselects, button reverts to "Gửi"
      fireEvent.change(textbox, { target: { value: 'Một nội dung hoàn toàn khác' } });
      expect(radio).toHaveAttribute('aria-checked', 'false');
      expect(submitBtn).toHaveTextContent('Gửi');
    });

    it('Zero-Duplicate Rule: user request appears once in feed and is not duplicated inside interactive card', () => {
      useChatStore.setState({
        conversationId: 'c-zero-dup',
        messages: [{ id: 'u-unique-123', role: 'user', content: 'Yêu cầu kiểm thử độc bản 123' }],
        activeClarification: {
          question: 'Bạn muốn chọn kho nào?',
          options: ['Repo A', 'Repo B'],
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

      // The user request string appears exactly once across the workspace
      const requestMatches = screen.getAllByText('Yêu cầu kiểm thử độc bản 123');
      expect(requestMatches).toHaveLength(1);
      // It is rendered inside the feed log
      const log = screen.getByRole('log', { name: 'Hội thoại' });
      expect(within(log).getByText('Yêu cầu kiểm thử độc bản 123')).toBeInTheDocument();
      // No request echo inside the interactive card
      expect(document.querySelector('[data-request-echo]')).toBeNull();
    });

    it('Removes all orange #FF5701, old brand classes, and "ATI" strings, adopting Planora forest green and safety message', () => {
      useChatStore.setState({
        conversationId: 'c-clean-brand',
        isPlanning: true,
        messages: [
          { id: 'u1', role: 'user', content: 'Xin chào' },
          { id: 'a1', role: 'assistant', content: 'Tôi là trợ lý Planora' },
        ],
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

      // 1. Assistant message sender is "Planora" and avatar is "P"
      const log = screen.getByRole('log', { name: 'Hội thoại' });
      expect(within(log).getByText('Planora')).toBeInTheDocument();
      expect(within(log).queryByText('ATI')).toBeNull();
      expect(within(log).getByText('P')).toBeInTheDocument();

      // 2. Safety message at composer footer
      expect(
        screen.getByText(/Planora luôn yêu cầu bạn duyệt trước khi ghi hoặc gửi dữ liệu ra bên ngoài/)
      ).toBeInTheDocument();
      expect(screen.queryByText(/ATI chỉ đọc và ghi/)).toBeNull();

      // 3. No orange #FF5701 on feed or composer
      const feed = document.querySelector('.planora-conversation-feed')!;
      const composer = document.getElementById('global-bottom-bar')!;
      expect(feed.innerHTML).not.toContain('#FF5701');
      expect(feed.innerHTML).not.toContain('bg-brand-primary');
      expect(composer.innerHTML).not.toContain('#FF5701');
      expect(composer.innerHTML).not.toContain('bg-brand-primary');

      // 4. Submit button uses Planora primary green
      const submitBtn = screen.getByRole('button', { name: /Gửi/ });
      expect(submitBtn.className).toContain('var(--planora-primary)');
    });

    it('Layout Anti-Overlap: feed has scroll-padding-bottom and bottom padding to avoid dock overlap', () => {
      render(
        <PlanoraConversationFeed
          messages={[{ id: 'm1', role: 'user', content: 'Tin test padding' }]}
        />
      );

      const feed = document.querySelector('.planora-conversation-feed') as HTMLElement;
      expect(feed).toBeInTheDocument();
      expect(feed.style.scrollPaddingBottom).toContain('var(--composer-dock-height, 120px) + 24px');
    });
  });
});
