/** @vitest-environment jsdom */
// Redesign 11/2026 bước 5a: hội thoại gần đây và nút "Yêu cầu mới" ở thanh bên, một lối vào cho mọi trang.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MainNav } from '../src/components/layout/MainNav';
import { apiClient } from '../src/services/api-client';
import { resetWorkspaceStorage, setActiveWorkspaceId } from '../src/services/workspace-storage';
import { useChatStore } from '../src/store/chat-store';
import type { Conversation } from '../src/types';

const user = { id: 'u1', name: 'Lan Nguyễn', email: 'lan@example.test', role: 'member' as const };
const rows = (titles: string[]): Conversation[] => titles.map((title, index) => ({ id: `c${index + 1}`, title }));
const recent = () => screen.getByRole('region', { name: 'Gần đây' });

beforeEach(() => { vi.spyOn(apiClient, 'getRuntime').mockResolvedValue({ runtimeMode: 'sandbox' }); });
afterEach(() => { cleanup(); resetWorkspaceStorage(); useChatStore.getState().reset(); window.history.replaceState({}, '', '/'); vi.restoreAllMocks(); });

it('lists at most six recent conversations as links, marks the open one, and navigates inside the app', async () => {
  vi.spyOn(apiClient, 'getConversations').mockResolvedValue({ conversations: rows(['Một', 'Hai', 'Ba', 'Bốn', 'Năm', 'Sáu', 'Bảy']), nextCursor: 'more' });
  window.history.replaceState({}, '', '/c/c2');
  const navigate = vi.fn();
  render(<MainNav user={user} current="workspace" navigate={navigate} onLogout={vi.fn()} />);
  await screen.findByRole('region', { name: 'Gần đây' });
  const links = within(recent()).getAllByRole('link');
  expect(links.map(link => link.textContent)).toEqual(['Một', 'Hai', 'Ba', 'Bốn', 'Năm', 'Sáu']);
  expect(links[1]).toHaveAttribute('aria-current', 'page');
  expect(links[1]).toHaveAttribute('href', '/c/c2');
  fireEvent.click(links[2]);
  expect(navigate).toHaveBeenCalledWith('/c/c3');
});

it('shows nothing when there is no conversation yet', async () => {
  const getConversations = vi.spyOn(apiClient, 'getConversations').mockResolvedValue({ conversations: [], nextCursor: null });
  render(<MainNav user={user} current="workspace" navigate={vi.fn()} onLogout={vi.fn()} />);
  await waitFor(() => expect(getConversations).toHaveBeenCalled());
  expect(screen.queryByRole('region', { name: 'Gần đây' })).toBeNull();
});

it('reloads for the new workspace and ignores a late answer from the previous one', async () => {
  let resolvePersonal!: (value: { conversations: Conversation[]; nextCursor: null }) => void;
  const personal = new Promise<{ conversations: Conversation[]; nextCursor: null }>(resolve => { resolvePersonal = resolve; });
  vi.spyOn(apiClient, 'getConversations')
    .mockReturnValueOnce(personal)
    .mockResolvedValue({ conversations: rows(['Của tổ chức']), nextCursor: null });
  render(<MainNav user={user} current="workspace" navigate={vi.fn()} onLogout={vi.fn()} />);
  act(() => setActiveWorkspaceId('organization'));
  await screen.findByText('Của tổ chức');
  await act(async () => resolvePersonal({ conversations: rows(['Của cá nhân']), nextCursor: null }));
  expect(screen.queryByText('Của cá nhân')).toBeNull();
});

it('"Yêu cầu mới" uses the page\'s own handler, otherwise clears the conversation and goes home', async () => {
  vi.spyOn(apiClient, 'getConversations').mockResolvedValue({ conversations: [], nextCursor: null });
  const onNewRequest = vi.fn();
  const view = render(<MainNav user={user} current="workspace" navigate={vi.fn()} onLogout={vi.fn()} onNewRequest={onNewRequest} />);
  fireEvent.click(screen.getByRole('button', { name: 'Yêu cầu mới' }));
  expect(onNewRequest).toHaveBeenCalledTimes(1);
  view.unmount();

  useChatStore.getState().setConversationId('c9');
  const navigate = vi.fn();
  render(<MainNav user={user} current="settings" navigate={navigate} onLogout={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Yêu cầu mới' }));
  expect(useChatStore.getState().conversationId).toBeNull();
  expect(navigate).toHaveBeenCalledWith('/');
});
