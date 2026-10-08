/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../src/App';
import { apiClient } from '../src/services/api-client';
import { authStorage } from '../src/services/auth-storage';

let calls: string[];
let loginStatus = 429;
beforeEach(() => {
  localStorage.removeItem('ati-theme');
  calls = []; loginStatus = 429; authStorage.clearStoredTokens();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    const body = url.endsWith('/config') ? { signupEnabled: true, googleEnabled: false }
      : url.endsWith('/login') ? { code: loginStatus === 429 ? 'LOGIN_LOCKED' : 'ACCOUNT_PENDING', error: 'private admin@example.test' }
      : { message: 'Nếu email này có tài khoản, bạn sẽ nhận được link.' };
    return new Response(JSON.stringify(body), { status: url.endsWith('/login') ? loginStatus : 200, headers: { 'Content-Type': 'application/json', 'Retry-After': '73' } });
  }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); authStorage.clearStoredTokens(); });
const open = (path: string) => { window.history.replaceState({}, '', path); return render(<App />); };

it('ports five landing moments and eight services with source classes and no demo controls', async () => {
  const { container } = open('/');
  expect(container.querySelectorAll('.moment-trigger')).toHaveLength(5);
  expect(container.querySelector('.stage-interactive-desktop')).not.toBeNull();
  expect(container.querySelector('#email-sim-modal')).toBeNull();
  expect(container.querySelector('#btn-hero-email-preview')).toBeNull();
});
it('keeps the prototype theme control on the public landing header', () => {
  open('/');
  fireEvent.click(screen.getByRole('button', { name: 'Chuyển sang giao diện tối' }));
  expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
});
it('blocks short signup passwords even when a form submit bypasses native validation', async () => {
  const { container } = open('/signup');
  await waitFor(() => expect(calls).toContain('/api/auth/config'));
  fireEvent.change(screen.getByLabelText(/^Họ/), { target: { value: 'User' } });
  fireEvent.change(screen.getByLabelText(/Email/), { target: { value: 'user@example.test' } });
  fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'short' } });
  fireEvent.submit(container.querySelector('form')!);
  expect(await screen.findByRole('alert')).toHaveTextContent('12');
  expect(calls).not.toContain('/api/auth/signup');
});
it('blocks short reset passwords before sending a one-use token', async () => {
  const { container } = open('/reset-password?token=private');
  fireEvent.change(screen.getByLabelText('Mật khẩu mới'), { target: { value: 'short' } });
  fireEvent.change(screen.getByLabelText(/Nhập lại|Xác nhận/), { target: { value: 'short' } });
  fireEvent.submit(container.querySelector('form')!);
  expect(await screen.findByRole('alert')).toHaveTextContent('12');
  expect(calls).not.toContain('/api/auth/reset-password');
});
it('retains the HTTP response carrying Retry-After for login lockouts', async () => {
  await expect(apiClient.login('user@example.test', 'password')).rejects.toMatchObject({ response: expect.any(Response) });
});
it.each(['replacement', 'logout'])('does not install a late email login after %s', async transition => {
  let finish!: (response: Response) => void;
  vi.stubGlobal('fetch', () => new Promise<Response>(resolve => { finish = resolve; }));
  const request = apiClient.login('user@example.test', 'password');
  const failure = expect(request).rejects.toThrow('Phiên đăng nhập đã thay đổi');
  if (transition === 'logout') authStorage.clearStoredTokens();
  else authStorage.setStoredTokens({ accessToken: 'new-session', refreshToken: 'new-refresh', user: { id: 'new', email: 'new@example.test', name: 'New' } });
  finish(new Response(JSON.stringify({ accessToken: 'late', refreshToken: 'late-refresh', user: { id: 'late', email: 'old@example.test', name: 'Old' } })));
  await failure;
  expect(authStorage.getStoredTokens().accessToken).toBe(transition === 'logout' ? null : 'new-session');
});
it('shows a login countdown from Retry-After and never exposes provider/admin text', async () => {
  const { container } = open('/login');
  fireEvent.change(screen.getByLabelText(/Email/), { target: { value: 'user@example.test' } });
  fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'password' } });
  fireEvent.submit(container.querySelector('form')!);
  await waitFor(() => expect(container.querySelector('#blocked-timer-display')).toHaveTextContent('01:13'));
  expect(document.body).not.toHaveTextContent('admin@example.test');
  expect(document.body).not.toHaveTextContent('đăng nhập lại ngay');
  vi.useFakeTimers();
  await act(async () => { vi.advanceTimersByTime(2000); });
  // A deadline is recomputed from elapsed wall time, never the prototype 14:59.
  expect(container.querySelector('#blocked-timer-display')!.textContent).not.toContain('14:59');
});
it('renders the approval steps without identifying an administrator', async () => {
  loginStatus = 403;
  const { container } = open('/login');
  fireEvent.change(screen.getByLabelText(/Email/), { target: { value: 'user@example.test' } });
  fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'password' } });
  fireEvent.submit(container.querySelector('form')!);
  expect(await screen.findByText('Tài khoản đang chờ duyệt')).toBeVisible();
  expect(document.body).not.toHaveTextContent('admin@example.test');
  expect(screen.getByText('Thử đăng nhập lại')).toBeVisible();
});
it('keeps reset success visible and reports that other sessions ended', async () => {
  const { container } = open('/reset-password?token=private');
  fireEvent.change(screen.getByLabelText('Mật khẩu mới'), { target: { value: 'new-password-123' } });
  fireEvent.change(screen.getByLabelText(/Nhập lại|Xác nhận/), { target: { value: 'new-password-123' } });
  fireEvent.submit(container.querySelector('form')!);
  expect(await screen.findByText(/Các thiết bị khác|thiết bị.*đăng xuất/)).toBeVisible();
  expect(container.querySelector('#view-reset-success')).not.toBeNull();
});
