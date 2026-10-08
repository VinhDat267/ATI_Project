import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../src/App';
import { apiClient } from '../src/services/api-client';
import { authStorage } from '../src/services/auth-storage';
import { useChatStore } from '../src/store/chat-store';
import { UserNavMenu } from '../src/components/layout/UserNavMenu';

const member = { id: 'u1', email: 'member@example.test', name: 'Member', role: 'member' as const, hasPassword: true, hasGoogle: false };
const profile = (extra: object = {}) => ({ id: 'u1', email: 'member@example.test', name: 'Member', role: 'member', createdAt: '2026-10-01T03:00:00Z',
  hasPassword: true, hasGoogle: false, googleEmail: null, ...extra });
const sessions = [
  { id: 's1', device: 'Chrome trên Windows', createdAt: '2026-10-04T01:00:00Z', lastUsedAt: '2026-10-04T02:00:00Z', current: true },
  { id: 's2', device: 'Safari trên iOS', createdAt: '2026-10-03T01:00:00Z', lastUsedAt: '2026-10-03T02:00:00Z', current: false },
];
const posts = () => vi.mocked(apiClient.request).mock.calls.filter(([, options]) => ['POST', 'PATCH'].includes(options?.method ?? ''));
function serve(account: object, extra: (url: string, options?: RequestInit) => unknown = () => undefined) {
  vi.spyOn(apiClient, 'request').mockImplementation(async (url: string, options?: RequestInit) => {
    const answer = extra(url, options);
    if (answer !== undefined) return answer instanceof Error ? Promise.reject(answer) : answer;
    if (url === '/api/account') return { account };
    if (url === '/api/account/sessions') return { sessions };
    if (url === '/api/account/profile') return { user: { ...member, name: JSON.parse(String(options?.body)).name } };
    if (url === '/api/account/sessions/revoke-others') return { revoked: 1 };
    if (url === '/api/account/sessions/s2/revoke') return { success: true };
    if (url === '/api/account/change-password') return { message: 'ok' };
    throw new Error(`unexpected ${url}`);
  });
}
beforeEach(() => {
  window.history.replaceState({}, '', '/account');
  authStorage.clearStoredTokens(); useChatStore.getState().reset();
  authStorage.setStoredTokens({ accessToken: 'access', refreshToken: 'refresh', user: member });
  vi.spyOn(apiClient, 'getMe').mockResolvedValue({ user: member });
  vi.spyOn(apiClient, 'getAuthConfig').mockResolvedValue({ signupEnabled: true, googleEnabled: true });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); authStorage.clearStoredTokens(); });

it('opens from the user menu', () => {
  const open = vi.fn();
  render(<UserNavMenu user={member} onOpenSettings={() => {}} onLogout={() => {}} onOpenAccount={open} />);
  fireEvent.click(screen.getByRole('button', { name: /Menu người dùng/ }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Tài khoản' }));
  expect(open).toHaveBeenCalledTimes(1);
});

it('shows the profile, sign-in methods, open sessions and that deletion goes through an admin', async () => {
  serve(profile({ hasGoogle: true, googleEmail: 'personal@gmail.test' }));
  render(<App />);
  expect(await screen.findByText('member@example.test')).toBeInTheDocument();
  expect(screen.getByLabelText('Tên hiển thị')).toHaveValue('Member');
  expect(screen.getByText('Thành viên')).toBeInTheDocument();
  expect(screen.getByText(/personal@gmail\.test/)).toBeInTheDocument();
  const current = screen.getByText('Chrome trên Windows').closest('li')!;
  expect(within(current).getByText('Phiên này')).toBeInTheDocument();
  expect(within(current).queryByRole('button')).toBeNull();
  expect(within(screen.getByText('Safari trên iOS').closest('li')!).getByRole('button', { name: 'Đăng xuất phiên này' })).toBeEnabled();
  expect(screen.getByText(/nhờ quản trị viên khóa tài khoản/)).toBeInTheDocument();
});

it('shows a Google-only account the recovery guidance instead of a current-password field, with unlink locked', async () => {
  serve(profile({ hasPassword: false, hasGoogle: true, googleEmail: 'personal@gmail.test' }));
  render(<App />);
  expect(await screen.findByText(/chưa có mật khẩu/)).toBeInTheDocument();
  expect(screen.queryByLabelText('Mật khẩu hiện tại')).toBeNull();
  expect(screen.getByRole('button', { name: 'Đặt mật khẩu qua email' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Gỡ liên kết' })).toBeDisabled();
});

it('lets an account with a password unlink Google and offers linking when not linked', async () => {
  serve(profile({ hasGoogle: true, googleEmail: 'personal@gmail.test' }));
  vi.spyOn(apiClient, 'unlinkGoogle').mockResolvedValue({ success: true });
  vi.spyOn(window, 'prompt').mockReturnValue('Current!fixture-password');
  render(<App />);
  expect(await screen.findByLabelText('Mật khẩu hiện tại')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Gỡ liên kết' }));
  await waitFor(() => expect(apiClient.unlinkGoogle).toHaveBeenCalledWith('Current!fixture-password'));
  cleanup(); vi.restoreAllMocks();
  vi.spyOn(apiClient, 'getMe').mockResolvedValue({ user: member });
  vi.spyOn(apiClient, 'getAuthConfig').mockResolvedValue({ signupEnabled: true, googleEnabled: true });
  serve(profile());
  const start = vi.spyOn(apiClient, 'startGoogleAuth').mockReturnValue(new Promise(() => {}));
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Liên kết Google' }));
  expect(start).toHaveBeenCalledWith('link');
});

it('keeps the Google link when current-password entry is cancelled', async () => {
  serve(profile({ hasGoogle: true, googleEmail: 'personal@gmail.test' }));
  const unlink = vi.spyOn(apiClient, 'unlinkGoogle').mockResolvedValue({ success: true });
  vi.spyOn(window, 'prompt').mockReturnValue(null);
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Gỡ liên kết' }));
  expect(unlink).not.toHaveBeenCalled();
  expect(screen.getByText(/personal@gmail\.test/)).toBeInTheDocument();
});

it('hides the Google section when Google sign-in is not configured', async () => {
  vi.mocked(apiClient.getAuthConfig).mockResolvedValue({ signupEnabled: true, googleEnabled: false });
  serve(profile());
  render(<App />);
  await screen.findByText('Chrome trên Windows');
  expect(screen.queryByRole('heading', { name: 'Phương thức đăng nhập' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Liên kết Google' })).toBeNull();
});

it('saves a new name and hands it to the signed-in user for the navigation menu', async () => {
  serve(profile());
  render(<App />);
  const input = await screen.findByLabelText('Tên hiển thị');
  fireEvent.change(input, { target: { value: 'Tên mới' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu tên' }));
  await waitFor(() => expect(authStorage.getStoredTokens().user?.name).toBe('Tên mới'));
  expect(posts()).toEqual([['/api/account/profile', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ name: 'Tên mới' }) })]]);
});

it('changes the password only with a matching new password of at least 12 characters, and keeps the session on a wrong current one', async () => {
  serve(profile(), url => url === '/api/account/change-password'
    ? Object.assign(new Error('Mật khẩu hiện tại không đúng.'), { status: 400, data: { code: 'INVALID_CURRENT_PASSWORD' } }) : undefined);
  render(<App />);
  fireEvent.change(await screen.findByLabelText('Mật khẩu hiện tại'), { target: { value: 'Wrong!password-123' } });
  fireEvent.change(screen.getByLabelText('Mật khẩu mới'), { target: { value: 'short' } });
  fireEvent.change(screen.getByLabelText('Nhập lại mật khẩu mới'), { target: { value: 'short' } });
  fireEvent.click(screen.getByRole('button', { name: 'Đổi mật khẩu' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('12 đến 128');
  fireEvent.change(screen.getByLabelText('Mật khẩu mới'), { target: { value: 'Auth05Changed!password' } });
  fireEvent.change(screen.getByLabelText('Nhập lại mật khẩu mới'), { target: { value: 'Auth05Other!password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Đổi mật khẩu' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('không khớp');
  expect(posts()).toEqual([]);
  fireEvent.change(screen.getByLabelText('Nhập lại mật khẩu mới'), { target: { value: 'Auth05Changed!password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Đổi mật khẩu' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Mật khẩu hiện tại không đúng.'));
  expect(posts()).toEqual([['/api/account/change-password', expect.objectContaining({ method: 'POST',
    body: JSON.stringify({ currentPassword: 'Wrong!password-123', newPassword: 'Auth05Changed!password' }) })]]);
  expect(authStorage.getStoredTokens().accessToken).toBe('access');
});

it('logs out one other session or every other device', async () => {
  serve(profile());
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Đăng xuất phiên này' }));
  await waitFor(() => expect(posts().map(([url]) => url)).toEqual(['/api/account/sessions/s2/revoke']));
  fireEvent.click(screen.getByRole('button', { name: 'Đăng xuất khỏi mọi thiết bị khác' }));
  await waitFor(() => expect(posts().map(([url]) => url)).toEqual(['/api/account/sessions/s2/revoke', '/api/account/sessions/revoke-others']));
});

it('returns to the account page after linking Google', async () => {
  const state = 'S'.repeat(43);
  window.history.replaceState({}, '', `/auth/google/callback?code=fixture-code&state=${state}`);
  vi.spyOn(apiClient, 'completeGoogleAuth').mockResolvedValue({ success: true });
  serve(profile({ hasGoogle: true, googleEmail: 'personal@gmail.test' }));
  render(<App />);
  expect(await screen.findByText('Đã liên kết tài khoản Google.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Về trang tài khoản' }));
  await waitFor(() => expect(window.location.pathname).toBe('/account'));
  expect(await screen.findByText(/personal@gmail\.test/)).toBeInTheDocument();
});
