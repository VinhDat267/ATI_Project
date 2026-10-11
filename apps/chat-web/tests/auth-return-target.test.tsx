/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../src/App';
import { authStorage } from '../src/services/auth-storage';
import { consumeAuthReturnTarget, saveAuthReturnTarget } from '../src/services/auth-return-target';

const firstUser = { id: 'user-1', email: 'one@example.test', name: 'One' };
const secondUser = { id: 'user-2', email: 'two@example.test', name: 'Two' };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function loginFetch(loginUser = firstUser) {
  return vi.fn(async (url: string) => {
    if (url === '/api/auth/config') return json({ signupEnabled: true, googleEnabled: false });
    if (url === '/api/auth/login') return json({ accessToken: `access-${loginUser.id}`, refreshToken: `refresh-${loginUser.id}`, user: loginUser });
    if (url === '/api/auth/me') return json({ user: firstUser });
    if (url === '/api/auth/logout') return json({ success: true });
    if (url === '/api/conversations') return json({ conversations: [] });
    if (url === '/api/services') return json({ services: [] });
    if (url.endsWith('/plans/active') || url.endsWith('/executions/latest')) return json({ error: 'Not found' }, 404);
    if (url === '/api/conversations/saved') return json({ conversation: { id: 'saved' }, messages: [] });
    return json({ runtimeMode: 'sandbox' });
  });
}

async function submitLogin() {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'one@example.test' } });
  fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'Current!password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
  await waitFor(() => expect(authStorage.getStoredTokens().accessToken).toBeTruthy());
}

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  window.history.replaceState({}, '', '/');
});
afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); localStorage.clear(); sessionStorage.clear();
  window.history.replaceState({}, '', '/');
});

it('returns to a protected settings URL including search and hash after login', async () => {
  vi.stubGlobal('fetch', loginFetch());
  window.history.replaceState({}, '', '/settings?tab=apps#notion');
  render(<App />);
  await submitLogin();
  await waitFor(() => expect(`${location.pathname}${location.search}${location.hash}`).toBe('/settings?tab=apps#notion'));
});

it('returns to the conversation only when the same user logs back in after session loss', async () => {
  authStorage.setStoredTokens({ accessToken: 'old-access', refreshToken: 'old-refresh', user: firstUser });
  vi.stubGlobal('fetch', loginFetch(firstUser));
  window.history.replaceState({}, '', '/c/saved');
  render(<App />);
  await screen.findByRole('textbox', { name: /Mô tả công việc|Nhập câu trả lời/ });
  act(() => authStorage.clearStoredTokens());
  await screen.findByText('Phiên đăng nhập đã hết hạn');
  await submitLogin();
  await waitFor(() => expect(location.pathname).toBe('/c/saved'));
});

it('discards the previous user return target when a different user logs in', async () => {
  authStorage.setStoredTokens({ accessToken: 'old-access', refreshToken: 'old-refresh', user: firstUser });
  vi.stubGlobal('fetch', loginFetch(secondUser));
  window.history.replaceState({}, '', '/c/saved');
  render(<App />);
  await screen.findByRole('textbox', { name: /Mô tả công việc|Nhập câu trả lời/ });
  act(() => authStorage.clearStoredTokens());
  await screen.findByText('Phiên đăng nhập đã hết hạn');
  await submitLogin();
  await waitFor(() => expect(location.pathname).toBe('/'));
});

it.each(['//evil.example/path', 'https://evil.example/path', '/login'])('rejects unsafe or account return target %s', target => {
  saveAuthReturnTarget(target, firstUser.id);
  expect(consumeAuthReturnTarget(firstUser.id)).toBeNull();
});

it('consumes a valid return target only once', () => {
  saveAuthReturnTarget('/history?filter=mine#today', firstUser.id);
  expect(consumeAuthReturnTarget(firstUser.id)).toBe('/history?filter=mine#today');
  expect(consumeAuthReturnTarget(firstUser.id)).toBeNull();
});

it('active logout clears rather than saving the current protected route', async () => {
  authStorage.setStoredTokens({ accessToken: 'access', refreshToken: 'refresh', user: firstUser });
  vi.stubGlobal('fetch', loginFetch());
  window.history.replaceState({}, '', '/settings#notion');
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: /Menu người dùng/ }));
  const logout = await screen.findByRole('menuitem', { name: 'Đăng xuất' });
  fireEvent.click(logout);
  await waitFor(() => expect(location.pathname).toBe('/'));
  expect(consumeAuthReturnTarget(firstUser.id)).toBeNull();
});

it('reports a cross-tab logout differently from an expired refresh', async () => {
  authStorage.setStoredTokens({ accessToken: 'access', refreshToken: 'refresh', user: firstUser });
  vi.stubGlobal('fetch', loginFetch());
  window.history.replaceState({}, '', '/settings');
  render(<App />);
  await screen.findByRole('heading', { name: /Kết nối dịch vụ/i });
  localStorage.removeItem('wap_access_token');
  localStorage.removeItem('wap_refresh_token');
  localStorage.removeItem('wap_user');
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'wap_access_token', oldValue: 'access', newValue: null })));
  expect(await screen.findByText('Phiên đăng nhập đã kết thúc ở một tab khác.')).toBeInTheDocument();
});
