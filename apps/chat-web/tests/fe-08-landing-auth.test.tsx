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

it('does not move focus back to email after the user starts editing the password', async () => {
  vi.useFakeTimers();
  open('/login');
  const email = screen.getByLabelText('Email', { exact: true });
  const password = screen.getByLabelText('Mật khẩu', { exact: true });
  email.focus();
  fireEvent.change(email, { target: { value: 'focus@example.test' } });
  password.focus();
  await act(async () => { vi.advanceTimersByTime(100); });
  expect(password).toHaveFocus();
});

it.each([
  ['/login', 'Email'], ['/signup', 'Họ tên'], ['/forgot-password', 'Email'],
])('focuses the first available field before interaction on %s', async (path, label) => {
  open(path);
  expect(await screen.findByLabelText(label, { exact: true })).toHaveFocus();
});

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
  fireEvent.change(await screen.findByLabelText(/^Họ/, {}, { timeout: 5_000 }), { target: { value: 'User' } });
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

it.each([
  ['btn-header-login', 'Escape'],
  ['btn-hero-signup', 'close'],
  ['btn-footer-cta-signup', 'forgot'],
])('returns focus to the actual %s opener after %s closes its routed modal', async (id, method) => {
  const { container } = open('/');
  const opener = container.querySelector<HTMLAnchorElement>(`[data-od-id="${id}"]`)!;
  opener.focus(); fireEvent.click(opener);
  await waitFor(() => expect(screen.getByLabelText(id.includes('signup') ? 'Họ tên' : 'Email', { exact: true })).toHaveFocus());
  if (method === 'forgot') {
    fireEvent.click(screen.getByRole('tab', { name: 'Đăng nhập' }));
    fireEvent.click(screen.getByRole('button', { name: 'Quên mật khẩu?' }));
    await waitFor(() => expect(window.location.pathname).toBe('/forgot-password'));
  }
  if (method === 'close') fireEvent.click(screen.getByRole('button', { name: 'Đóng cửa sổ' }));
  else fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(window.location.pathname).toBe('/'));
  expect(container.querySelector(`[data-od-id="${id}"]`)).toHaveFocus();
});

it('shows the root Google transfer modal for a real pending HTTP response and discards it after close', async () => {
  let finish!: (response: Response) => void;
  const transport = vi.fn((url: string) => url.endsWith('/config')
    ? Promise.resolve(new Response(JSON.stringify({ signupEnabled: true, googleEnabled: true })))
    : new Promise<Response>(resolve => { finish = resolve; }));
  vi.stubGlobal('fetch', transport);
  const { container } = open('/');
  await waitFor(() => expect(transport).toHaveBeenCalledWith('/api/auth/config'));
  const opener = container.querySelector<HTMLAnchorElement>('[data-od-id="btn-hero-google"]')!;
  opener.focus(); fireEvent.click(opener);
  expect(container.querySelector('#auth-modal')).toHaveClass('opacity-100');
  expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(container.querySelector('#auth-modal')).toBeNull();
  expect(opener).toHaveFocus();
  await act(async () => { finish(new Response(JSON.stringify({ url: 'https://accounts.google.com/authorize' }))); });
  expect(window.location.pathname).toBe('/');
  expect(transport.mock.calls.filter(([url]) => url.endsWith('/google/start'))).toHaveLength(1);
});

it.each(['/login', '/signup', '/forgot-password'])('has one accessible primary heading on %s', async path => {
  open(path);
  await waitFor(() => expect(calls).toContain('/api/auth/config'));
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
});

it('does not restore a modal opener on an unrelated route change', async () => {
  const { container } = open('/');
  fireEvent.click(container.querySelector('[data-od-id="btn-header-login"]')!);
  await waitFor(() => expect(screen.getByLabelText('Email', { exact: true })).toHaveFocus());
  window.history.replaceState({}, '', '/guide'); fireEvent.popState(window);
  expect(await screen.findByRole('heading', { name: 'Cẩm nang kết nối & Mẫu câu lệnh ATI', level: 1 })).toBeVisible();
  window.history.replaceState({}, '', '/'); fireEvent.popState(window);
  expect(container.querySelector('[data-od-id="btn-header-login"]')).not.toHaveFocus();
});

it('does not invent the email-verification status for a pending email account', async () => {
  loginStatus = 403;
  const { container } = open('/login');
  fireEvent.change(screen.getByLabelText('Email', { exact: true }), { target: { value: 'user@example.test' } });
  fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'password' } });
  fireEvent.submit(container.querySelector('form')!);
  expect(await screen.findByText('Nếu chưa hoàn tất')).toBeVisible();
  expect(document.body).not.toHaveTextContent('Cần xác minh');
});

it('keeps one accessible primary heading after signup succeeds', async () => {
  const { container } = open('/signup');
  await waitFor(() => expect(calls).toContain('/api/auth/config'));
  fireEvent.change(screen.getByLabelText('Họ tên', { exact: true }), { target: { value: 'User' } });
  fireEvent.change(screen.getByLabelText('Email', { exact: true }), { target: { value: 'user@example.test' } });
  fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'NewUser!password' } });
  fireEvent.submit(container.querySelector('form')!);
  expect(await screen.findByRole('heading', { level: 1, name: 'Đã gửi yêu cầu đăng ký!' })).toBeVisible();
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
});
