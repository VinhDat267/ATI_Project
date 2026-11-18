/** @vitest-environment jsdom */
// Redesign 11/2026 bước 4: trang chủ hiện việc đang chờ bạn và hội thoại gần đây.
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { HomeQueue } from '../src/pages/Cockpit/HomeQueue';
import { apiClient } from '../src/services/api-client';
import type { AttentionSummary } from '../src/types';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
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
