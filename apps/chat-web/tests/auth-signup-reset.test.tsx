/** @vitest-environment jsdom */
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../src/App';
import { authStorage } from '../src/services/auth-storage';

let signupEnabled = true;
let calls: { url: string; data?: unknown }[];
beforeEach(() => {
  authStorage.clearStoredTokens(); calls = []; signupEnabled = true;
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    const data = options?.body ? JSON.parse(options.body as string) : undefined; calls.push({ url, data });
    const body = url === '/api/auth/config' ? { signupEnabled, googleEnabled: false }
      : url.endsWith('verify-email') ? { message: 'Email đã xác minh, chờ quản trị viên duyệt.' }
      : url.endsWith('signup') ? { message: 'Kiểm tra email để xác minh tài khoản.' }
      : url.endsWith('reset-password') ? { message: 'Đã đặt lại mật khẩu. Vui lòng đăng nhập lại.' }
      : { message: 'Nếu email có trong hệ thống, bạn sẽ nhận được link.' };
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); authStorage.clearStoredTokens(); });

describe('AUTH-02 public account flows', () => {
  it('shows signup only when enabled and submits the Vietnamese signup form', async () => {
    window.history.replaceState(null, '', '/login'); render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Tạo tài khoản' }));
    fireEvent.change(screen.getByLabelText('Họ tên'), { target: { value: 'Người dùng' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.test' } });
    fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'Auth02!new-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tạo tài khoản' }));
    expect(await screen.findByText('Kiểm tra email để xác minh tài khoản.')).toBeDefined();
    expect(calls).toContainEqual({ url: '/api/auth/signup', data: { name: 'Người dùng', email: 'user@example.test', password: 'Auth02!new-password' } });
  });
  it('keeps signup hidden when the server has closed registration and still opens forgotten password', async () => {
    signupEnabled = false; window.history.replaceState(null, '', '/login'); render(<App />);
    await waitFor(() => expect(calls.some(call => call.url === '/api/auth/config')).toBe(true));
    expect(screen.queryByRole('button', { name: 'Tạo tài khoản' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Quên mật khẩu?' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'unknown@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi link đặt lại mật khẩu' }));
    expect(await screen.findByText('Nếu email có trong hệ thống, bạn sẽ nhận được link.')).toBeDefined();
    expect(calls).toContainEqual({ url: '/api/auth/forgot-password', data: { email: 'unknown@example.test' } });
  });
  it('removes a verification token immediately and sends it once even with React StrictMode', async () => {
    window.history.replaceState(null, '', '/?view=verify-email&token=private-verification-token');
    render(<StrictMode><App /></StrictMode>);
    expect(window.location.search).not.toContain('token');
    expect(await screen.findByText('Email đã xác minh, chờ quản trị viên duyệt.')).toBeDefined();
    expect(calls.filter(call => call.url === '/api/auth/verify-email')).toEqual([{ url: '/api/auth/verify-email', data: { token: 'private-verification-token' } }]);
    expect(JSON.stringify(localStorage)).not.toContain('private-verification-token');
  });
  it('removes a reset token before submission, checks confirmation and returns to login after resetting', async () => {
    window.history.replaceState(null, '', '/?view=reset-password&token=private-reset-token'); render(<App />);
    expect(window.location.search).not.toContain('token');
    fireEvent.change(screen.getByLabelText('Mật khẩu mới'), { target: { value: 'Auth02!new-password' } });
    fireEvent.change(screen.getByLabelText('Nhập lại mật khẩu'), { target: { value: 'DoesNotMatch!123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Đặt lại mật khẩu' }));
    expect(await screen.findByRole('alert')).toBeDefined();
    expect(calls.some(call => call.url === '/api/auth/reset-password')).toBe(false);
    fireEvent.change(screen.getByLabelText('Nhập lại mật khẩu'), { target: { value: 'Auth02!new-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Đặt lại mật khẩu' }));
    await waitFor(() => expect(window.location.pathname).toBe('/login'));
    expect(calls).toContainEqual({ url: '/api/auth/reset-password', data: { token: 'private-reset-token', password: 'Auth02!new-password' } });
    expect(screen.getByRole('button', { name: 'Đăng nhập' })).toBeDefined();
  });
  it('provides a rate-limited resend form from login and does not submit a missing token', async () => {
    window.history.replaceState(null, '', '/login'); render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Gửi lại email xác minh' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'pending@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi lại email xác minh' }));
    expect(await screen.findByText('Nếu email có trong hệ thống, bạn sẽ nhận được link.')).toBeDefined();
    expect(calls).toContainEqual({ url: '/api/auth/resend-verification', data: { email: 'pending@example.test' } });
    cleanup(); window.history.replaceState(null, '', '/verify-email'); render(<App />);
    expect(await screen.findByRole('alert')).toBeDefined();
    expect(calls.some(call => call.url === '/api/auth/verify-email')).toBe(false);
  });
});
