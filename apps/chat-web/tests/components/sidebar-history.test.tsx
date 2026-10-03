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

    const onSelect = vi.fn();
    render(<SidebarHistory currentConversationId={null} onSelectConversation={onSelect} />);

    const item = await screen.findByText('Hội thoại 1');
    fireEvent.click(item);

    await waitFor(() => {
      expect(useChatStore.getState().conversationId).toBe('conv-1');
      expect(useChatStore.getState().messages).toHaveLength(2);
      expect(useChatStore.getState().activePlan?.id).toBe('plan-active-1');
      expect(useChatStore.getState().planStatus).toBe('preview');
      expect(useChatStore.getState().conversations).toHaveLength(1);
      expect(onSelect).toHaveBeenCalledWith('conv-1');
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
    const expectedTime = today.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false });
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

  it('searches Vietnamese titles without accents and clears without changing the open conversation', async () => {
    vi.spyOn(apiClient, 'getConversations').mockResolvedValue({ conversations: [
      { id: 'login', title: 'Cải thiện đăng nhập' },
      { id: 'slack', title: 'Thông báo Slack' },
    ] });
    const onSelect = vi.fn();
    render(<SidebarHistory currentConversationId="login" onSelectConversation={onSelect} />);
    await screen.findByText('Cải thiện đăng nhập');
    const search = screen.getByRole('searchbox', { name: 'Tìm hội thoại' });
    fireEvent.change(search, { target: { value: 'DANG NHAP' } });
    expect(screen.getByRole('button', { name: 'Cải thiện đăng nhập' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByText('Thông báo Slack')).toBeNull();
    fireEvent.change(search, { target: { value: 'không tìm thấy' } });
    expect(screen.getByText('Không tìm thấy hội thoại')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Xóa tìm kiếm' }));
    expect(search).toHaveFocus();
    expect(screen.getByText('Thông báo Slack')).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('groups and sorts real timestamps while keeping undated history separate', async () => {
    const today = new Date();
    today.setHours(10, 0, 0, 0);
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    const old = new Date(today); old.setDate(today.getDate() - 10);
    vi.spyOn(apiClient, 'getConversations').mockResolvedValue({ conversations: [
      { id: 'old', title: 'Cũ', updated_at: old.toISOString() },
      { id: 'missing', title: 'Không có ngày' },
      { id: 'yesterday', title: 'Hôm trước', created_at: yesterday.toISOString() },
      { id: 'today', title: 'Mới nhất', updatedAt: today.toISOString() },
    ] });
    render(<SidebarHistory currentConversationId={null} />);
    await screen.findByText('Mới nhất');
    expect(screen.getByRole('group', { name: 'Hôm nay' })).toHaveTextContent('Mới nhất');
    expect(screen.getByRole('group', { name: 'Hôm qua' })).toHaveTextContent('Hôm trước');
    expect(screen.getByRole('group', { name: 'Trước đây' })).toHaveTextContent('Cũ');
    expect(screen.getByRole('group', { name: 'Khác' })).toHaveTextContent('Không có ngày');
    const rows = screen.getAllByRole('button').filter(button => button.classList.contains('conversation-link'));
    expect(rows.map(row => row.getAttribute('aria-label'))).toEqual(['Mới nhất', 'Hôm trước', 'Cũ', 'Không có ngày']);
  });

  it('refreshes history without discarding the search or cached rows on failure', async () => {
    const list = vi.spyOn(apiClient, 'getConversations')
      .mockResolvedValueOnce({ conversations: [{ id: 'one', title: 'Trello sprint' }] })
      .mockRejectedValueOnce(new Error('Máy chủ chưa sẵn sàng'))
      .mockResolvedValueOnce({ conversations: [{ id: 'one', title: 'Trello sprint' }, { id: 'two', title: 'Trello mới' }] });
    render(<SidebarHistory currentConversationId="one" />);
    await screen.findByText('Trello sprint');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'trello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Làm mới lịch sử' }));
    await screen.findByRole('alert');
    expect(screen.getByText('Trello sprint')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại lịch sử' }));
    await screen.findByText('Trello mới');
    expect(screen.getByRole('searchbox')).toHaveValue('trello');
    expect(list).toHaveBeenCalledTimes(3);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
