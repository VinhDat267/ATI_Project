import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../src/App';
import { ApiClient, apiClient } from '../src/services/api-client';
import { authStorage } from '../src/services/auth-storage';
import { useChatStore } from '../src/store/chat-store';
import { UserNavMenu } from '../src/components/layout/UserNavMenu';

const admin = { id: 'a1', email: 'admin@example.test', name: 'Admin', role: 'admin' as const };
const candidate = { id: 'u1', email: 'candidate@example.test', name: 'Candidate', role: 'member', status: 'pending', emailVerified: true, hasPassword: true, hasGoogle: false, createdAt: '2026-10-04T01:00:00Z', openSessions: 0 };
beforeEach(() => {
  window.history.replaceState({}, '', '/admin/users');
  authStorage.clearStoredTokens(); useChatStore.getState().reset();
  authStorage.setStoredTokens({ accessToken: 'access', user: admin });
  vi.spyOn(apiClient, 'getMe').mockResolvedValue({ user: admin });
  vi.spyOn(apiClient, 'getAuthConfig').mockResolvedValue({ signupEnabled: false, googleEnabled: false });
  vi.spyOn(apiClient, 'request').mockResolvedValue({ users: [candidate], total: 1, pendingCount: 1, page: 1, limit: 20 });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); authStorage.clearStoredTokens(); });

it('loads a direct admin route and requires service-access confirmation before approving', async () => {
  render(<App />);
  expect(await screen.findByText('candidate@example.test')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Duyệt' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('Người này sẽ dùng được các service đã kết nối của nhóm');
  expect(vi.mocked(apiClient.request).mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Duyệt' }));
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận duyệt' }));
  await waitFor(() => expect(apiClient.request).toHaveBeenCalledWith('/api/admin/users/u1/approve', expect.objectContaining({ method: 'POST' })));
});

it('hides the admin entry and denies direct navigation for a member', async () => {
  const member = { ...admin, role: 'member' as const };
  authStorage.setStoredTokens({ accessToken: 'access', user: member });
  vi.mocked(apiClient.getMe).mockResolvedValue({ user: member });
  render(<App />);
  expect(await screen.findByRole('alert')).toHaveTextContent('quyền quản trị');
  expect(apiClient.request).not.toHaveBeenCalled();
  cleanup();
  render(<UserNavMenu user={member} onOpenSettings={() => {}} onLogout={() => {}} />);
  expect(screen.queryByText('Quản lý người dùng')).toBeNull();
});

it('shows the admin navigation entry only with the current admin role', () => {
  render(<UserNavMenu user={admin} onOpenSettings={() => {}} onLogout={() => {}} />);
  expect(screen.getByRole('button', { name: 'Quản lý người dùng' })).toBeInTheDocument();
});

it('searches within the pending tab and keeps server rejection visible without optimistic approval', async () => {
  render(<App />);
  await screen.findByText('candidate@example.test');
  fireEvent.click(screen.getByRole('tab', { name: /Chờ duyệt/ }));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Candidate' } });
  fireEvent.submit(screen.getByRole('search'));
  await waitFor(() => expect(apiClient.request).toHaveBeenCalledWith(expect.stringContaining('status=pending&search=Candidate')));
  vi.mocked(apiClient.request).mockRejectedValueOnce(Object.assign(new Error('Tài khoản chưa được xác minh email.'), { status: 409 }));
  fireEvent.click(screen.getByRole('button', { name: 'Duyệt' }));
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận duyệt' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('chưa được xác minh');
  expect(screen.getByText('candidate@example.test')).toBeInTheDocument();
});

it('shows the login page when a subsequent API request revokes the authenticated session', async () => {
  window.history.replaceState({}, '', '/');
  vi.spyOn(apiClient, 'getRuntime').mockResolvedValue({ runtimeMode: 'sandbox' });
  vi.spyOn(apiClient, 'getServices').mockResolvedValue({ services: [] });
  vi.spyOn(apiClient, 'getConversations').mockResolvedValue({ conversations: [] });
  render(<App />);
  await screen.findByPlaceholderText('Mô tả công việc bạn muốn thực hiện...');
  authStorage.setStoredTokens({ refreshToken: 'opaque' });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Phiên đã bị thu hồi.' }), { status: 401, headers: { 'Content-Type': 'application/json' } })));
  await act(async () => { await expect(new ApiClient().request('/api/services')).rejects.toMatchObject({ status: 401 }); });
  expect(await screen.findByLabelText('Email')).toBeInTheDocument();
  expect(window.location.pathname).toBe('/login');
});
