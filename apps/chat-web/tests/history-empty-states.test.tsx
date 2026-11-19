/** @vitest-environment jsdom */
// Redesign 11/2026 bước 5a: trang Nhật ký nói đúng lý do danh sách trống và chỉ đưa nút hợp với lý do đó.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { HistoryPage } from '../src/pages/History/HistoryPage';
import { apiClient } from '../src/services/api-client';
import { resetWorkspaceStorage } from '../src/services/workspace-storage';
import type { Conversation } from '../src/types';

const user = { id: 'u1', name: 'Lan Nguyễn', email: 'lan@example.test', role: 'member' as const };
const saved = { id: 'c1', title: 'Báo cáo tuần', status: 'chatting', updatedAt: '2026-11-18T09:00:00.000Z' } satisfies Conversation;
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

it('refreshes recent conversations after renaming a conversation in history', async () => {
  let conversation: Conversation = saved;
  vi.spyOn(apiClient, 'getConversations').mockImplementation(async () => ({
    conversations: [conversation], nextCursor: null,
  }));
  vi.spyOn(apiClient, 'renameConversation').mockImplementation(async (_id, title) => {
    conversation = { ...conversation, title };
    return { conversation };
  });
  renderPage();
  const recent = await screen.findByRole('region', { name: 'Gần đây' });
  expect(within(recent).getByRole('link', { name: saved.title })).toBeInTheDocument();
  fireEvent.click(within(main()).getByRole('button', { name: `Đổi tên ${saved.title}` }));
  fireEvent.change(within(main()).getByRole('textbox', { name: 'Tiêu đề hội thoại' }), { target: { value: 'Kế hoạch tuần' } });
  fireEvent.click(within(main()).getByRole('button', { name: 'Lưu' }));
  expect(await within(main()).findByRole('heading', { name: 'Kế hoạch tuần' })).toBeInTheDocument();
  expect(await within(recent).findByRole('link', { name: 'Kế hoạch tuần' })).toBeInTheDocument();
  expect(within(recent).queryByRole('link', { name: saved.title })).toBeNull();
});

it('a failed load shows the error, not an empty list', async () => {
  vi.spyOn(apiClient, 'getConversations').mockRejectedValue(new Error('offline'));
  renderPage();
  expect(await within(main()).findByRole('alert')).toBeInTheDocument();
  expect(within(main()).queryByText('Chưa có hội thoại nào')).toBeNull();
});

it('requires confirmation and removes a deleted conversation from history and recent links', async () => {
  const rows: Conversation[] = [saved];
  mockList(rows);
  const request = vi.spyOn(apiClient, 'request').mockImplementation(async (path, options) => {
    if (path === '/api/conversations/c1' && options?.method === 'DELETE') rows.splice(0, 1);
    return null as any;
  });
  renderPage();
  const remove = await within(main()).findByRole('button', { name: `Xoá ${saved.title}` });
  await screen.findByRole('region', { name: 'Gần đây' });
  remove.focus();
  fireEvent.click(remove);
  const dialog = () => within(screen.getByRole('alertdialog'));
  expect(dialog().getByRole('button', { name: 'Huỷ' })).toHaveFocus();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(remove).toHaveFocus();
  expect(request.mock.calls.some(([, options]) => options?.method === 'DELETE')).toBe(false);
  fireEvent.click(remove);
  fireEvent.click(dialog().getByRole('button', { name: 'Xác nhận xoá' }));
  expect(await within(main()).findByText('Chưa có hội thoại nào')).toBeInTheDocument();
  expect(within(main()).getByText('Đã xoá hội thoại.')).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole('link', { name: saved.title })).toBeNull());
  expect(request.mock.calls.filter(([, options]) => options?.method === 'DELETE')).toEqual([
    ['/api/conversations/c1', { method: 'DELETE', headers: { 'X-Workspace-Id': 'personal' } }],
  ]);
});

it('removes the deleted row from a history page that reopened during the request', async () => {
  const rows = [{ ...saved, id: 'c-reopened' }];
  mockList(rows);
  let finishDelete!: () => void;
  vi.spyOn(apiClient, 'request').mockImplementation(async (_path, options) => {
    if (options?.method === 'DELETE') {
      await new Promise<void>(resolve => { finishDelete = resolve; });
      rows.splice(0, 1);
    }
    return null as any;
  });
  const first = renderPage();
  fireEvent.click(await within(main()).findByRole('button', { name: `Xoá ${saved.title}` }));
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Xác nhận xoá' }));
  first.unmount();
  renderPage();
  await within(main()).findByRole('heading', { name: saved.title });
  await act(async () => finishDelete());
  expect(await within(main()).findByText('Chưa có hội thoại nào')).toBeInTheDocument();
});

it('keeps a protected conversation visible when deletion is denied', async () => {
  mockList([saved]);
  vi.spyOn(apiClient, 'request').mockRejectedValue(Object.assign(new Error('Hội thoại có lịch tự động.'), { status: 409 }));
  renderPage();
  fireEvent.click(await within(main()).findByRole('button', { name: `Xoá ${saved.title}` }));
  const dialog = within(screen.getByRole('alertdialog'));
  fireEvent.click(dialog.getByRole('button', { name: 'Xác nhận xoá' }));
  expect(await dialog.findByRole('alert')).toHaveTextContent('Hội thoại có lịch tự động.');
  fireEvent.click(dialog.getByRole('button', { name: 'Huỷ' }));
  expect(within(main()).getByRole('heading', { name: saved.title })).toBeInTheDocument();
});
