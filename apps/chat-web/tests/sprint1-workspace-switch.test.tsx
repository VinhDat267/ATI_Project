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

  it('giữ nguyên /history và tải lại cả mục Lịch chạy lẫn danh sách hội thoại của không gian mới', async () => {
    vi.spyOn(apiClient, 'getRuntime').mockResolvedValue({ runtimeMode: 'sandbox', schedulesEnabled: true } as never);
    vi.spyOn(apiClient, 'getSchedules').mockImplementation(async () => ({
      schedules: getActiveWorkspaceId() === 'personal'
        ? [{ id: 's-personal', convId: 'c-p', version: 1, name: 'Lịch riêng cá nhân', request: 'Lịch riêng', recurrence: { type: 'daily', time: '08:00' }, services: ['slack'], status: 'active', pauseReason: null, nextRuns: ['2026-11-03T01:00:00Z'], lastRun: null }]
        : [],
    }) as never);
    vi.spyOn(apiClient, 'getConversations').mockImplementation(async () => ({
      conversations: getActiveWorkspaceId() === 'personal'
        ? [{ id: 'conv-personal', title: 'Hội thoại cá nhân' }]
        : [{ id: 'conv-shared', title: 'Hội thoại nhóm chung' }],
    }) as never);

    window.history.replaceState({}, '', '/history');
    render(<App />);
    const scheduleRegion = await screen.findByRole('region', { name: 'Lịch chạy' });
    expect(await within(scheduleRegion).findByText('Lịch riêng cá nhân')).toBeInTheDocument();
    expect(await screen.findByText('Hội thoại cá nhân')).toBeInTheDocument();

    await act(async () => { await switchTo(/^Không gian Chung$/); });
    expect(window.location.pathname).toBe('/history');
    expect(await within(scheduleRegion).findByText('Chưa có lịch chạy nào')).toBeInTheDocument();
    expect(within(scheduleRegion).queryByText('Lịch riêng cá nhân')).toBeNull();
    expect(await screen.findByText('Hội thoại nhóm chung')).toBeInTheDocument();
    expect(screen.queryByText('Hội thoại cá nhân')).toBeNull();
  });
});

async function createOrgViaMenu(name: string) {
  fireEvent.click(screen.getByRole('button', { name: /Không gian làm việc:/ }));
  const menu = await screen.findByRole('menu', { name: 'Danh sách không gian làm việc' });
  fireEvent.click(within(menu).getByRole('button', { name: /\+ Tạo không gian tổ chức mới/i }));
  const input = await screen.findByPlaceholderText(/Nhập tên tổ chức/i);
  fireEvent.change(input, { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: /Xác nhận tạo/i }));
}

async function joinOrgViaMenu(code: string) {
  fireEvent.click(screen.getByRole('button', { name: /Không gian làm việc:/ }));
  const menu = await screen.findByRole('menu', { name: 'Danh sách không gian làm việc' });
  fireEvent.click(within(menu).getByRole('button', { name: /🔑 Tham gia tổ chức bằng mã mời/i }));
  const input = await screen.findByPlaceholderText(/ATI-XXXX-XXXX/i);
  fireEvent.change(input, { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: /Tham gia ngay/i }));
}

describe('PBI-06: tạo tổ chức mới & tham gia bằng mã mời giữ nguyên trang hiện tại', () => {
  it('tạo tổ chức mới khi đang ở /settings giữ nguyên /settings và chuyển sang tổ chức mới', async () => {
    const createdOrg: WorkspaceSummary = { id: 'ws-created', name: 'Tổ chức Mới', role: 'admin', status: 'active', inviteCode: 'ATI-NEWW-0001', requireApproval: true };
    vi.spyOn(apiClient, 'createWorkspace').mockResolvedValue({ workspace: createdOrg });
    vi.spyOn(apiClient, 'getServices').mockImplementation(async () => ({
      canConfigure: true,
      services: [{ id: 'slack', name: getActiveWorkspaceId() === 'ws-created' ? 'Slack tổ chức mới' : 'Slack cá nhân', configured: true, connected: true, connectionStatus: 'healthy' as const, credentialFields: [{ key: 'botToken', label: 'Bot token' }] }],
    }) as never);

    window.history.replaceState({}, '', '/settings');
    render(<App />);
    expect(await screen.findByText('Slack cá nhân')).toBeInTheDocument();

    await createOrgViaMenu('Tổ chức Mới');
    await waitFor(() => expect(getActiveWorkspaceId()).toBe('ws-created'));
    expect(window.location.pathname).toBe('/settings');
    expect(await screen.findByText('Slack tổ chức mới')).toBeInTheDocument();
  });

  it('tham gia tổ chức bằng mã mời khi đang ở /settings và /history giữ nguyên trang hiện tại', async () => {
    const joinedOrg: WorkspaceSummary = { id: 'ws-joined', name: 'Tổ chức Mã Mời', role: 'member', status: 'active', inviteCode: 'ATI-JOIN-9999' };
    const joinedOrgHistory: WorkspaceSummary = { id: 'ws-joined-hist', name: 'Tổ chức Lịch sử', role: 'member', status: 'active', inviteCode: 'ATI-HIST-8888' };
    vi.spyOn(apiClient, 'joinWorkspace').mockImplementation(async (code: string) => ({
      workspace: code === 'ATI-HIST-8888' ? joinedOrgHistory : joinedOrg,
      created: true,
    }));
    vi.spyOn(apiClient, 'getServices').mockImplementation(async () => ({
      canConfigure: true,
      services: [{ id: 'slack', name: getActiveWorkspaceId() === 'ws-joined' ? 'Slack tổ chức mã mời' : 'Slack cá nhân', configured: true, connected: true, connectionStatus: 'healthy' as const, credentialFields: [{ key: 'botToken', label: 'Bot token' }] }],
    }) as never);
    vi.spyOn(apiClient, 'getConversations').mockImplementation(async () => ({
      conversations: getActiveWorkspaceId() === 'ws-joined-hist' ? [{ id: 'c-hist', title: 'Hội thoại tổ chức mới' }] : [],
    }) as never);

    window.history.replaceState({}, '', '/settings');
    const { unmount } = render(<App />);
    expect(await screen.findByText('Slack cá nhân')).toBeInTheDocument();

    await joinOrgViaMenu('ATI-JOIN-9999');
    await waitFor(() => expect(getActiveWorkspaceId()).toBe('ws-joined'));
    expect(window.location.pathname).toBe('/settings');
    expect(await screen.findByText('Slack tổ chức mã mời')).toBeInTheDocument();
    unmount();

    window.history.replaceState({}, '', '/history');
    render(<App />);
    await joinOrgViaMenu('ATI-HIST-8888');
    await waitFor(() => expect(getActiveWorkspaceId()).toBe('ws-joined-hist'));
    expect(window.location.pathname).toBe('/history');
    expect(await screen.findByText('Hội thoại tổ chức mới')).toBeInTheDocument();
  });

  it('tạo hoặc tham gia tổ chức khi đang ở /c/conv-123 vẫn điều hướng về "/"', async () => {
    const createdOrg: WorkspaceSummary = { id: 'ws-created-2', name: 'Đội Beta', role: 'admin', status: 'active' };
    const joinedOrg: WorkspaceSummary = { id: 'ws-joined-2', name: 'Đội Gamma', role: 'member', status: 'active' };
    vi.spyOn(apiClient, 'createWorkspace').mockResolvedValue({ workspace: createdOrg });
    vi.spyOn(apiClient, 'joinWorkspace').mockResolvedValue({ workspace: joinedOrg, created: true });
    vi.spyOn(apiClient, 'getConversation').mockResolvedValue({ conversation: { id: 'conv-123' }, messages: [{ id: 'm1', role: 'user', content: 'Xin chào' }] } as never);
    vi.spyOn(apiClient, 'getActivePlan').mockResolvedValue(null);
    vi.spyOn(apiClient, 'getLatestExecutionSnapshot').mockResolvedValue(null);

    window.history.replaceState({}, '', '/c/conv-123');
    const { unmount } = render(<App />);
    await waitFor(() => expect(useChatStore.getState().conversationId).toBe('conv-123'));

    await createOrgViaMenu('Đội Beta');
    await waitFor(() => expect(window.location.pathname).toBe('/'));
    expect(getActiveWorkspaceId()).toBe('ws-created-2');
    expect(useChatStore.getState().conversationId).toBeNull();
    unmount();

    window.history.replaceState({}, '', '/c/conv-123');
    render(<App />);
    await waitFor(() => expect(useChatStore.getState().conversationId).toBe('conv-123'));

    await joinOrgViaMenu('ATI-GAMM-1234');
    await waitFor(() => expect(window.location.pathname).toBe('/'));
    expect(getActiveWorkspaceId()).toBe('ws-joined-2');
    expect(useChatStore.getState().conversationId).toBeNull();
  });
});

