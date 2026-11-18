/** @vitest-environment jsdom */
// Redesign 11/2026 bước 4: trang chủ hiện việc đang chờ bạn và hội thoại gần đây.
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { HomeQueue } from '../src/pages/Cockpit/HomeQueue';
import { apiClient } from '../src/services/api-client';
import { resetWorkspaceStorage, setActiveWorkspaceId } from '../src/services/workspace-storage';
import type { AttentionSummary, Conversation } from '../src/types';

afterEach(() => { cleanup(); resetWorkspaceStorage(); vi.restoreAllMocks(); });
const user = { id: 'u1', email: 'lan@example.test', name: 'Lan' };
const summary: AttentionSummary = {
  pendingPlans: [{ conversationId: 'c1', title: 'Tạo thẻ Trello', planId: 'p1', summary: 'Kế hoạch 3 việc', stepCount: 3, expiresAt: '2026-11-18T10:30:00.000Z' }],
  needsAttention: [{ conversationId: 'c2', title: 'Báo Slack', planId: 'p2', status: 'unknown', updatedAt: '2026-11-18T09:00:00.000Z' }],
};
function mockApi(attention: AttentionSummary | Error, conversations = [
  { id: 'c1', title: 'Tạo thẻ Trello', updatedAt: '2026-11-18T10:00:00.000Z' },
  { id: 'c3', title: 'Tổng hợp PR', updatedAt: '2026-11-18T08:00:00.000Z' },
]) {
  const getAttention = vi.spyOn(apiClient, 'getAttention').mockImplementation(async () => { if (attention instanceof Error) throw attention; return attention; });
  vi.spyOn(apiClient, 'getConversations').mockResolvedValue({ conversations, nextCursor: null });
  return getAttention;
}

it('lists pending plans and runs that need a person, and opens their conversation', async () => {
  mockApi(summary);
  const open = vi.fn();
  render(<HomeQueue user={user} navigate={vi.fn()} onOpenConversation={open} />);
  const queue = await screen.findByRole('region', { name: 'Cần bạn' });
  expect(within(queue).getByText('Tạo thẻ Trello')).toBeInTheDocument();
  expect(within(queue).getByText(/Chờ duyệt · 3 bước · hết hạn/)).toBeInTheDocument();
  expect(within(queue).getByText('Chưa rõ kết quả')).toBeInTheDocument();
  fireEvent.click(within(queue).getByRole('button', { name: /Báo Slack/ }));
  expect(open).toHaveBeenCalledWith('c2');
});

it('recent conversations skip the ones already waiting, and "Xem tất cả" opens the log', async () => {
  mockApi(summary);
  const navigate = vi.fn();
  render(<HomeQueue user={user} navigate={navigate} onOpenConversation={vi.fn()} />);
  const recent = await screen.findByRole('region', { name: 'Gần đây' });
  expect(within(recent).getByText('Tổng hợp PR')).toBeInTheDocument();
  expect(within(recent).queryByText('Tạo thẻ Trello')).toBeNull();
  fireEvent.click(within(recent).getByRole('link', { name: 'Xem tất cả' }));
  expect(navigate).toHaveBeenCalledWith('/history');
});

it('shows no "Cần bạn" block when nothing is waiting', async () => {
  mockApi({ pendingPlans: [], needsAttention: [] });
  render(<HomeQueue user={user} navigate={vi.fn()} onOpenConversation={vi.fn()} />);
  await screen.findByRole('region', { name: 'Gần đây' });
  expect(screen.queryByRole('region', { name: 'Cần bạn' })).toBeNull();
});

it('a failed load says so inside the block and retries on request', async () => {
  const getAttention = mockApi(new Error('offline'));
  render(<HomeQueue user={user} navigate={vi.fn()} onOpenConversation={vi.fn()} />);
  expect(await screen.findByText('Không tải được việc đang chờ.')).toBeInTheDocument();
  getAttention.mockResolvedValue(summary);
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
  expect(await screen.findByRole('region', { name: 'Cần bạn' })).toBeInTheDocument();
});

it('hides the previous workspace immediately and ignores its late results after a switch', async () => {
  const empty = { pendingPlans: [], needsAttention: [] };
  let resolveOrganization!: (value: AttentionSummary) => void;
  const organization = new Promise<AttentionSummary>(resolve => { resolveOrganization = resolve; });
  const getAttention = vi.spyOn(apiClient, 'getAttention')
    .mockResolvedValueOnce(summary)
    .mockReturnValueOnce(organization)
    .mockResolvedValue(empty);
  vi.spyOn(apiClient, 'getConversations')
    .mockResolvedValueOnce({ conversations: [{ id: 'c3', title: 'Hội thoại cá nhân' }] })
    .mockResolvedValueOnce({ conversations: [{ id: 'c4', title: 'Hội thoại tổ chức' }] })
    .mockResolvedValue({ conversations: [{ id: 'c5', title: 'Cá nhân mới nhất' }] });
  render(<HomeQueue user={user} navigate={vi.fn()} onOpenConversation={vi.fn()} />);
  await screen.findByText('Hội thoại cá nhân');

  act(() => setActiveWorkspaceId('organization'));
  expect(screen.queryByText('Hội thoại cá nhân')).toBeNull();
  expect(screen.queryByText('Tạo thẻ Trello')).toBeNull();
  await waitFor(() => expect(getAttention).toHaveBeenCalledTimes(2));
  act(() => setActiveWorkspaceId('personal'));
  await screen.findByText('Cá nhân mới nhất');
  await act(async () => resolveOrganization(summary));
  expect(screen.queryByText('Hội thoại tổ chức')).toBeNull();
  expect(screen.queryByText('Tạo thẻ Trello')).toBeNull();
});

it('continues through the conversation cursor to fill five recent rows after exclusions', async () => {
  const row = (id: string): Conversation => ({ id, title: id });
  vi.spyOn(apiClient, 'getAttention').mockResolvedValue(summary);
  const getConversations = vi.spyOn(apiClient, 'getConversations')
    .mockResolvedValueOnce({
      conversations: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'].map(row),
      nextCursor: 'page-two',
    })
    .mockResolvedValueOnce({ conversations: ['c6', 'c7', 'c8'].map(row), nextCursor: null });
  render(<HomeQueue user={user} navigate={vi.fn()} onOpenConversation={vi.fn()} />);

  const recent = await screen.findByRole('region', { name: 'Gần đây' });
  expect(within(recent).getAllByRole('button').map(button => button.textContent?.trim())).toEqual(['c3', 'c4', 'c5', 'c6', 'c7']);
  expect(getConversations).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'page-two' }));
});
