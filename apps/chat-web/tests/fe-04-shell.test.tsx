import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react';
import { UserNavMenu } from '../src/components/layout/UserNavMenu';
import { App } from '../src/App';
import { apiClient } from '../src/services/api-client';
import { authStorage } from '../src/services/auth-storage';
import { readRoute } from '../src/routes';
const user = { id: 'u1', name: 'Lan Nguyễn', email: 'lan@example.test', role: 'member' as const };
vi.mock('../src/hooks/use-sse', () => ({ useSSE: () => ({ disconnected: false }) }));
beforeEach(() => {
  window.history.replaceState({}, '', '/'); authStorage.clearStoredTokens();
  vi.spyOn(apiClient, 'getAuthConfig').mockResolvedValue({ signupEnabled: false, googleEnabled: false });
  vi.spyOn(apiClient, 'getMe').mockResolvedValue({ user });
  vi.spyOn(apiClient, 'getServices').mockResolvedValue({ services: [] });
  vi.spyOn(apiClient, 'getConversations').mockResolvedValue({ conversations: [] });
  vi.spyOn(apiClient, 'getRuntime').mockResolvedValue({ runtimeMode: 'sandbox' });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); authStorage.clearStoredTokens(); });
it.each([['Lan Nguyễn', 'LN'], ['an', 'A'], ['', 'L']])('derives avatar initials from first and last words: %s', (name, initials) => {
  render(<UserNavMenu user={{ ...user, name }} onOpenSettings={() => {}} onLogout={() => {}} />);
  expect(screen.getByRole('button', { name: /Menu người dùng/ })).toHaveTextContent(initials);
});
it('opens member menu with arrows, wraps, escapes to avatar and closes outside', () => {
  render(<UserNavMenu user={user} onOpenSettings={() => {}} onLogout={() => {}} />);
  const avatar = screen.getByRole('button', { name: /Menu người dùng/ });
  fireEvent.keyDown(avatar, { key: 'ArrowDown' });
  const items = screen.getAllByRole('menuitem');
  expect(items[0]).toHaveFocus();
  expect(screen.queryByRole('menuitem', { name: 'Quản lý người dùng' })).toBeNull();
  fireEvent.keyDown(items[0], { key: 'ArrowUp' }); expect(items.at(-1)).toHaveFocus();
  fireEvent.keyDown(items.at(-1)!, { key: 'Escape' }); expect(avatar).toHaveFocus();
  expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.click(avatar); fireEvent.mouseDown(document.body); expect(screen.queryByRole('menu')).toBeNull();
});
it('only exposes admin navigation to admins', () => {
  render(<UserNavMenu user={{ ...user, role: 'admin' }} onOpenSettings={() => {}} onLogout={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: /Menu người dùng/ }));
  expect(screen.getByRole('menuitem', { name: 'Quản lý người dùng' })).toBeVisible();
});
it.each([['/guide', 'Cẩm nang'], ['/privacy', 'Chính sách an toàn']])('renders %s without a session', async (path, heading) => {
  window.history.replaceState({}, '', path); await act(async () => { render(<App />); });
  expect(screen.getByRole('heading', { level: 1, name: heading })).toBeVisible();
  expect(screen.queryByLabelText('Mật khẩu')).toBeNull();
});
it.each([['/settings', 'settings'], ['/history', 'history']])('recognizes protected route %s', async (path, kind) => {
  window.history.replaceState({}, '', path); expect(readRoute().kind).toBe(kind);
  await act(async () => { render(<App />); }); expect(screen.getByLabelText('Mật khẩu')).toBeInTheDocument();
});
it('shows sandbox explanation without a loading-mode flash and keeps its warning visible', async () => {
  let resolve!: (value: { runtimeMode: 'sandbox' }) => void;
  vi.mocked(apiClient.getRuntime).mockImplementation(() => new Promise(done => { resolve = done; }));
  authStorage.setStoredTokens({ accessToken: 'access', user }); await act(async () => { render(<App />); });
  expect(screen.queryByText(/Chưa xác định/)).toBeNull();
  await act(async () => resolve({ runtimeMode: 'sandbox' }));
  expect(screen.getByText('Chế độ thử nghiệm: kế hoạch mẫu, không gọi dịch vụ thật')).toBeInTheDocument();
  expect(screen.getByText('Thử nghiệm · không gọi dịch vụ thật')).toBeInTheDocument();
  const explanation = screen.getByRole('button', { name: 'Là gì?' });
  fireEvent.click(explanation); expect(explanation).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText(/Chế độ do máy chủ quyết định/)).toBeVisible();
  fireEvent.click(explanation); expect(explanation).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByText('Chế độ thử nghiệm: kế hoạch mẫu, không gọi dịch vụ thật')).toBeInTheDocument();
});
