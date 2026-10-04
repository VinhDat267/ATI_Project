/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { SidebarHistory } from '../../src/components/layout/SidebarHistory';
import { useChatStore } from '../../src/store/chat-store';
import { apiClient } from '../../src/services/api-client';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  useChatStore.getState().reset();
  vi.spyOn(apiClient, 'getLatestExecutionSnapshot').mockResolvedValue(null);
});

describe('SidebarHistory Component', () => {
  it('loads conversations from API and renders them', async () => {
    vi.spyOn(apiClient, 'getConversations').mockResolvedValue({
      conversations: [
        { id: 'conv-1', title: 'Tạo board Trello', updatedAt: new Date().toISOString() },
        { id: 'conv-2', title: 'Thông báo Slack', updatedAt: new Date().toISOString() },
      ],
    });

    render(<SidebarHistory currentConversationId={null} />);

    expect(await screen.findByText('Tạo board Trello')).toBeInTheDocument();
    expect(screen.getByText('Thông báo Slack')).toBeInTheDocument();
  });

  it('loads messages and active plan when a conversation is clicked', async () => {
    vi.spyOn(apiClient, 'getConversations').mockResolvedValue({
      conversations: [
        { id: 'conv-1', title: 'Hội thoại 1', updatedAt: new Date().toISOString() },
      ],
    });

    vi.spyOn(apiClient, 'getConversation').mockResolvedValue({
      conversation: { id: 'conv-1', title: 'Hội thoại 1', updatedAt: new Date().toISOString() },
      messages: [
        { id: 'm1', role: 'user', content: 'Tin nhắn cũ' },
        { id: 'm2', role: 'assistant', content: 'Câu trả lời cũ' },
      ],
    });

    vi.spyOn(apiClient, 'getActivePlan').mockResolvedValue({
      id: 'plan-active-1',
      summary: 'Kế hoạch đã lưu',
      steps: [{ id: 's1', tool: 'trello.create_card', description: 'Step 1', args: {} }],
    });

    render(<SidebarHistory currentConversationId={null} />);

    const item = await screen.findByText('Hội thoại 1');
    fireEvent.click(item);

    await waitFor(() => {
      expect(useChatStore.getState().conversationId).toBe('conv-1');
      expect(useChatStore.getState().messages).toHaveLength(2);
      expect(useChatStore.getState().activePlan?.id).toBe('plan-active-1');
      expect(useChatStore.getState().planStatus).toBe('preview');
      expect(useChatStore.getState().conversations).toHaveLength(1);
    });
  });

  it('renders formatted timestamp when backend returns snake_case updated_at', async () => {
    const today = new Date();
    today.setHours(10, 30, 0, 0);

    vi.spyOn(apiClient, 'getConversations').mockResolvedValue({
      conversations: [
        {
          id: 'conv-snake',
          title: 'Hội thoại backend',
          updated_at: today.toISOString(),
        } as any,
      ],
    });

    render(<SidebarHistory currentConversationId={null} />);

    expect(await screen.findByText('Hội thoại backend')).toBeInTheDocument();
    // Expected time format "10:30"
    const expectedTime = '10:30';
    expect(screen.getByText(expectedTime)).toBeInTheDocument();
  });

  it('maps active plan status to executing when backend returns executing status', async () => {
    vi.spyOn(apiClient, 'getConversations').mockResolvedValue({
      conversations: [{ id: 'conv-exec', title: 'Đang chạy' }],
    });

    vi.spyOn(apiClient, 'getConversation').mockResolvedValue({
      conversation: { id: 'conv-exec', title: 'Đang chạy' },
      messages: [],
    });

    vi.spyOn(apiClient, 'getActivePlan').mockResolvedValue({
      id: 'plan-exec-1',
      summary: 'Kế hoạch đang chạy',
      status: 'executing',
      steps: [{ id: 's1', tool: 'slack.send_message', description: 'Step 1', args: {} }],
    } as any);

    render(<SidebarHistory currentConversationId={null} />);
    const item = await screen.findByText('Đang chạy');
    fireEvent.click(item);

    await waitFor(() => {
      expect(useChatStore.getState().planStatus).toBe('executing');
    });
  });
});
