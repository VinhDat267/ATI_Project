/** @vitest-environment jsdom */
// Redesign 11/2026 bước 4: trang chủ hiện việc đang chờ bạn. Bước 5a: hội thoại gần đây chuyển lên thanh bên.
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { HomeQueue } from '../src/pages/Cockpit/HomeQueue';
import { apiClient } from '../src/services/api-client';
import { resetWorkspaceStorage, setActiveWorkspaceId } from '../src/services/workspace-storage';
import type { AttentionSummary } from '../src/types';

afterEach(() => { cleanup(); resetWorkspaceStorage(); vi.restoreAllMocks(); });
const user = { id: 'u1', email: 'lan@example.test', name: 'Lan' };
const summary: AttentionSummary = {
  pendingPlans: [{ conversationId: 'c1', title: 'Tạo thẻ Trello', planId: 'p1', summary: 'Kế hoạch 3 việc', stepCount: 3, expiresAt: '2026-11-18T10:30:00.000Z' }],
  needsAttention: [{ conversationId: 'c2', title: 'Báo Slack', planId: 'p2', status: 'unknown', updatedAt: '2026-11-18T09:00:00.000Z' }],
};
const empty: AttentionSummary = { pendingPlans: [], needsAttention: [] };
function mockApi(attention: AttentionSummary | Error) {
  return vi.spyOn(apiClient, 'getAttention').mockImplementation(async () => { if (attention instanceof Error) throw attention; return attention; });
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

it('renders nothing when nothing is waiting, and no longer lists recent conversations on home', async () => {
  const getAttention = mockApi(empty);
  const getConversations = vi.spyOn(apiClient, 'getConversations');
  const { container } = render(<HomeQueue user={user} navigate={vi.fn()} onOpenConversation={vi.fn()} />);
  await waitFor(() => expect(getAttention).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
  expect(screen.queryByRole('region', { name: 'Gần đây' })).toBeNull();
  expect(getConversations).not.toHaveBeenCalled();
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
  let resolveOrganization!: (value: AttentionSummary) => void;
  const organization = new Promise<AttentionSummary>(resolve => { resolveOrganization = resolve; });
  const getAttention = vi.spyOn(apiClient, 'getAttention')
    .mockResolvedValueOnce(summary)
    .mockReturnValueOnce(organization)
    .mockResolvedValue(empty);
  render(<HomeQueue user={user} navigate={vi.fn()} onOpenConversation={vi.fn()} />);
  await screen.findByText('Tạo thẻ Trello');

  act(() => setActiveWorkspaceId('organization'));
  expect(screen.queryByText('Tạo thẻ Trello')).toBeNull();
  await waitFor(() => expect(getAttention).toHaveBeenCalledTimes(2));
  act(() => setActiveWorkspaceId('personal'));
  await waitFor(() => expect(getAttention).toHaveBeenCalledTimes(3));
  await act(async () => resolveOrganization(summary));
  expect(screen.queryByText('Tạo thẻ Trello')).toBeNull();
});
