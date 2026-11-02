// PBI-04 (Sprint 1): đổi không gian làm việc trên header không được đá người dùng khỏi trang
// đang đứng (vd. /settings). Chỉ trang hội thoại /c/:id mới về "/", vì một hội thoại thuộc về
// đúng một không gian.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../src/App';
import { apiClient } from '../src/services/api-client';
import { authStorage } from '../src/services/auth-storage';
import { getActiveWorkspaceId, resetWorkspaceStorage, setCachedOrganizations } from '../src/services/workspace-storage';
import { useChatStore } from '../src/store/chat-store';
import type { WorkspaceSummary } from '../src/types';

vi.mock('../src/hooks/use-sse', () => ({ useSSE: vi.fn(() => ({ disconnected: false })) }));

const user = { id: 'u1', email: 'owner@example.test', name: 'Owner', role: 'member' as const };
const shared: WorkspaceSummary = { id: 'ws-shared', name: 'Không gian Chung', role: 'member', status: 'active' };
const catalogue = (workspace: string) => ({
  canConfigure: true,
  services: [{ id: 'slack', name: workspace === 'ws-shared' ? 'Slack nhóm chung' : 'Slack cá nhân', configured: true, connected: true, connectionStatus: 'healthy' as const, credentialFields: [{ key: 'botToken', label: 'Bot token' }] }],
});

beforeEach(() => {
  resetWorkspaceStorage();
  setCachedOrganizations([shared]);
  authStorage.clearStoredTokens(); authStorage.setStoredTokens({ accessToken: 'access', user });
  useChatStore.getState().reset();
  vi.spyOn(apiClient, 'getRuntime').mockResolvedValue({ runtimeMode: 'sandbox' });
  vi.spyOn(apiClient, 'getMe').mockResolvedValue({ user });
  vi.spyOn(apiClient, 'getWorkspaces').mockResolvedValue({ personal: { id: 'personal', name: 'Không gian Cá nhân', role: 'admin', status: 'active' }, organizations: [shared] });
  vi.spyOn(apiClient, 'getConversations').mockResolvedValue({ conversations: [] });
  vi.spyOn(apiClient, 'getSchedulePendingCount').mockResolvedValue({ count: 0 });
  // The catalogue answers for whichever workspace is active when the request is made.
  vi.spyOn(apiClient, 'getServices').mockImplementation(async () => catalogue(getActiveWorkspaceId()) as never);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); authStorage.clearStoredTokens(); resetWorkspaceStorage(); window.history.replaceState({}, '', '/'); });

async function switchTo(name: RegExp) {
  fireEvent.click(screen.getByRole('button', { name: /Không gian làm việc:/ }));
  const menu = await screen.findByRole('menu', { name: 'Danh sách không gian làm việc' });
  fireEvent.click(within(menu).getByText(name));
}

describe('PBI-04: chuyển không gian trên /settings', () => {
  it('giữ nguyên /settings và tải lại thẻ dịch vụ của không gian vừa chọn (Cá nhân → Chung → Cá nhân)', async () => {
    window.history.replaceState({}, '', '/settings');
    render(<App />);
    expect(await screen.findByText('Slack cá nhân')).toBeInTheDocument();
    const calls = vi.mocked(apiClient.getServices).mock.calls.length;

    await act(async () => { await switchTo(/^Không gian Chung$/); });
    expect(window.location.pathname).toBe('/settings');
    expect(getActiveWorkspaceId()).toBe('ws-shared');
    expect(await screen.findByText('Slack nhóm chung')).toBeInTheDocument();
    expect(screen.queryByText('Slack cá nhân')).toBeNull();
    expect(vi.mocked(apiClient.getServices).mock.calls.length).toBeGreaterThan(calls);

    await act(async () => { await switchTo(/^Không gian Cá nhân$/); });
    expect(window.location.pathname).toBe('/settings');
    expect(getActiveWorkspaceId()).toBe('personal');
    expect(await screen.findByText('Slack cá nhân')).toBeInTheDocument();
  });

  it('vẫn rời /c/:id về "/" khi đổi không gian, vì hội thoại thuộc về không gian cũ', async () => {
    vi.spyOn(apiClient, 'getConversation').mockResolvedValue({ conversation: { id: 'c1' }, messages: [{ id: 'm1', role: 'user', content: 'Yêu cầu riêng' }] } as never);
    vi.spyOn(apiClient, 'getActivePlan').mockResolvedValue(null);
    vi.spyOn(apiClient, 'getLatestExecutionSnapshot').mockResolvedValue(null);
    window.history.replaceState({}, '', '/c/c1');
    render(<App />);
    await waitFor(() => expect(useChatStore.getState().conversationId).toBe('c1'));
    await act(async () => { await switchTo(/^Không gian Chung$/); });
    await waitFor(() => expect(window.location.pathname).toBe('/'));
    expect(useChatStore.getState().conversationId).toBeNull();
  });
});
