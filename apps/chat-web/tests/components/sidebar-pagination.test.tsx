import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { SidebarHistory } from '../../src/components/layout/SidebarHistory';
import { apiClient } from '../../src/services/api-client';
import { useChatStore } from '../../src/store/chat-store';
beforeEach(() => { useChatStore.getState().setConversations([]); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('appends cursor pages on history scroll, de-duplicates rows and stops at the last page', async () => {
  const list = vi.spyOn(apiClient, 'getConversations').mockImplementation(async (options: any) => options?.cursor
    ? { conversations: [{ id: 'c1', title: 'Newest' }, { id: 'c2', title: 'Older' }], nextCursor: null }
    : { conversations: [{ id: 'c1', title: 'Newest' }], nextCursor: 'opaque-next' });
  render(<SidebarHistory currentConversationId={null} />); await screen.findByText('Newest');
  const history = screen.getByRole('region', { name: 'Danh sách hội thoại' });
  fireEvent.scroll(history);
  expect(await screen.findByText('Older')).toBeInTheDocument(); expect(screen.getAllByText('Newest')).toHaveLength(1);
  expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'opaque-next' }));
  fireEvent.scroll(history); expect(list).toHaveBeenCalledTimes(2);
});
it('searches literal titles from the first page and rejects stale search responses', async () => {
  let resolveOld!: (data: any) => void;
  vi.spyOn(apiClient, 'getConversations').mockImplementation(async (options: any) => options?.search === 'old'
    ? new Promise(resolve => { resolveOld = resolve; })
    : { conversations: options?.search === '%new_' ? [{ id: 'c2', title: '%new_ literal' }] : [{ id: 'c1', title: 'Original' }], nextCursor: null });
  render(<SidebarHistory currentConversationId={null} />); await screen.findByText('Original');
  const search = screen.getByRole('searchbox', { name: 'Tìm hội thoại theo tiêu đề' });
  fireEvent.change(search, { target: { value: 'old' } });
  await waitFor(() => expect(resolveOld).toBeDefined());
  fireEvent.change(search, { target: { value: '%new_' } }); await screen.findByText('%new_ literal');
  await act(async () => resolveOld({ conversations: [{ id: 'old', title: 'Stale search' }], nextCursor: 'stale' }));
  expect(screen.queryByText('Stale search')).toBeNull(); expect(screen.queryByText('Original')).toBeNull();
});
it('renames a conversation through PATCH and updates the displayed title', async () => {
  vi.spyOn(apiClient, 'getConversations').mockResolvedValue({ conversations: [{ id: 'c1', title: 'Original' }] });
  const request = vi.spyOn(apiClient, 'request').mockImplementation(async (url, options) => {
    if (url === '/api/conversations/c1' && options?.method === 'PATCH') return { conversation: { id: 'c1', title: 'Renamed' } };
    throw new Error('Unexpected request');
  });
  render(<SidebarHistory currentConversationId={null} />); await screen.findByText('Original');
  fireEvent.click(screen.getByRole('button', { name: 'Đổi tên Original' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Tiêu đề hội thoại' }), { target: { value: 'Renamed' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu tên hội thoại' }));
  expect(await screen.findByText('Renamed')).toBeInTheDocument();
  expect(request).toHaveBeenCalledWith('/api/conversations/c1', { method: 'PATCH', body: JSON.stringify({ title: 'Renamed' }) });
});
it('refreshes the automatic title after the server confirms the first message', async () => {
  vi.spyOn(apiClient, 'getConversations').mockResolvedValueOnce({ conversations: [{ id: 'c1', title: null }] })
    .mockResolvedValue({ conversations: [{ id: 'c1', title: 'First real message' }] });
  render(<SidebarHistory currentConversationId="c1" />); await screen.findByText('Hội thoại mới');
  act(() => { useChatStore.getState().addOptimisticMessage({ id: 'temp1', content: 'First real message' }); });
  expect(screen.getByText('Hội thoại mới')).toBeInTheDocument();
  act(() => useChatStore.getState().confirmMessage('temp1', 'server1'));
  expect(await screen.findByText('First real message')).toBeInTheDocument();
});
