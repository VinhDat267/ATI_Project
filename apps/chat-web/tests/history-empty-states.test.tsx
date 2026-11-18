/** @vitest-environment jsdom */
// Redesign 11/2026 bước 5a: trang Nhật ký nói đúng lý do danh sách trống và chỉ đưa nút hợp với lý do đó.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { HistoryPage } from '../src/pages/History/HistoryPage';
import { apiClient } from '../src/services/api-client';
import { resetWorkspaceStorage } from '../src/services/workspace-storage';
import type { Conversation } from '../src/types';

const user = { id: 'u1', name: 'Lan Nguyễn', email: 'lan@example.test', role: 'member' as const };
const saved: Conversation = { id: 'c1', title: 'Báo cáo tuần', status: 'chatting', updatedAt: '2026-11-18T09:00:00.000Z' };
const main = () => screen.getByRole('main');
function mockList(rows: Conversation[]) {
  return vi.spyOn(apiClient, 'getConversations').mockImplementation(async options => ({
    conversations: options?.search ? rows.filter(row => row.title?.includes(options.search!)) : rows,
    nextCursor: null,
  }));
}
const renderPage = () => render(<HistoryPage user={user} navigate={vi.fn()} onLogout={vi.fn()} />);

beforeEach(() => { vi.spyOn(apiClient, 'getRuntime').mockResolvedValue({ runtimeMode: 'sandbox' }); });
afterEach(() => { cleanup(); resetWorkspaceStorage(); vi.restoreAllMocks(); });

it('a new account sees that nothing exists yet, without a search hint or a clear button', async () => {
  mockList([]);
  renderPage();
  expect(await within(main()).findByText('Chưa có hội thoại nào')).toBeInTheDocument();
  expect(within(main()).queryByText(/từ khóa/)).toBeNull();
  expect(within(main()).queryByRole('button', { name: 'Xoá từ khóa tìm kiếm' })).toBeNull();
  expect(screen.queryByText(/Minh bạch/)).toBeNull();
});

it('a search with no match says so and clearing it brings the list back', async () => {
  const list = mockList([saved]);
  renderPage();
  expect(await within(main()).findByRole('heading', { name: 'Báo cáo tuần' })).toBeInTheDocument();
  expect(within(main()).queryByText('Chưa có hội thoại nào')).toBeNull();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'không có' } });
  expect(await within(main()).findByText('Không tìm thấy hội thoại phù hợp')).toBeInTheDocument();
  fireEvent.click(within(main()).getByRole('button', { name: 'Xoá từ khóa tìm kiếm' }));
  await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ search: '' })));
  expect(await within(main()).findByRole('heading', { name: 'Báo cáo tuần' })).toBeInTheDocument();
});

it('a status filter with no match offers to show everything again', async () => {
  mockList([saved]);
  renderPage();
  await within(main()).findByRole('heading', { name: 'Báo cáo tuần' });
  fireEvent.click(screen.getByRole('button', { name: 'Hoàn thành' }));
  expect(within(main()).getByText('Không có hội thoại nào ở bộ lọc này')).toBeInTheDocument();
  fireEvent.click(within(main()).getByRole('button', { name: 'Xem tất cả' }));
  expect(within(main()).getByRole('heading', { name: 'Báo cáo tuần' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Tất cả' })).toHaveAttribute('aria-pressed', 'true');
});

it('a failed load shows the error, not an empty list', async () => {
  vi.spyOn(apiClient, 'getConversations').mockRejectedValue(new Error('offline'));
  renderPage();
  expect(await within(main()).findByRole('alert')).toBeInTheDocument();
  expect(within(main()).queryByText('Chưa có hội thoại nào')).toBeNull();
});
