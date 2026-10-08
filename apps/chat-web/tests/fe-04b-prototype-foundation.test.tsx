import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { App } from '../src/App';
import { apiClient } from '../src/services/api-client';
import { authStorage } from '../src/services/auth-storage';
import { useChatStore } from '../src/store/chat-store';
import { meta as cockpitMeta } from '../src/pages/Cockpit/meta';

vi.mock('../src/hooks/use-sse', () => ({ useSSE: vi.fn(() => ({ disconnected: false })) }));
const user = { id: 'u1', email: 'owner@example.test', name: 'Owner' };
const APP_BODY = 'bg-bg-page text-text antialiased';
const PAGE_BODY = 'min-h-screen flex flex-col bg-[#F8F8F6] text-[#111827]';
const heading = () => screen.findByRole('heading', { level: 1, name: 'Không tìm thấy trang' });
const pageScope = () => ({
  page: document.documentElement.dataset.protoPage,
  body: document.body.className,
  theme: document.head.querySelectorAll('style[data-proto-theme]').length,
  css: document.head.querySelectorAll('style[data-proto-page-css]').length,
});

beforeEach(() => {
  window.history.replaceState({}, '', '/');
  document.body.className = APP_BODY;
  localStorage.removeItem('ati-theme');
  document.documentElement.classList.remove('dark');
  authStorage.clearStoredTokens(); useChatStore.getState().reset(); useChatStore.getState().setConversations([]);
  vi.spyOn(apiClient, 'getRuntime').mockResolvedValue({ runtimeMode: 'sandbox' });
  vi.spyOn(apiClient, 'getServices').mockResolvedValue({ services: [], canConfigure: false });
  vi.spyOn(apiClient, 'getMe').mockResolvedValue({ user });
  vi.spyOn(apiClient, 'getConversations').mockResolvedValue({ conversations: [] });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); authStorage.clearStoredTokens(); });

it('FE-04b: a signed-out unknown path shows the prototype 404 inside its page scope, and leaving restores the app', async () => {
  window.history.replaceState({}, '', '/khong-co-trang?x=1');
  render(<App />);
  await heading();
  expect(screen.getByText('/khong-co-trang?x=1')).toBeInTheDocument();
  expect(pageScope()).toEqual({ page: '404', body: PAGE_BODY, theme: 1, css: 1 });
  expect(document.title).toBe('404 — Không tìm thấy trang · ATI');

  fireEvent.click(within(screen.getByRole('main')).getByRole('link', { name: 'Về trang chủ' }));
  expect(window.location.pathname).toBe('/');
  await screen.findByRole('button', { name: 'Đăng nhập vào hệ thống' });
  expect(pageScope()).toEqual({ page: undefined, body: APP_BODY, theme: 0, css: 0 });
});

it('FE-04b: a signed-in unknown path shows the 404 without the app shell; Back returns to it with its scope', async () => {
  authStorage.setStoredTokens({ accessToken: 'access', user });
  window.history.replaceState({}, '', '/khong-co-trang');
  render(<App />);
  await heading();
  expect(screen.queryByRole('button', { name: /Menu người dùng/ })).not.toBeInTheDocument();

  fireEvent.click(within(screen.getByRole('main')).getByRole('link', { name: 'Về không gian làm việc chính' }));
  await screen.findByRole('textbox', { name: /Mô tả công việc bạn muốn thực hiện|Nhập câu trả lời làm rõ yêu cầu/ });
  expect(pageScope()).toEqual({ page: 'app-stage', body: cockpitMeta.bodyClass, theme: 1, css: 1 });

  act(() => window.history.back());
  await heading();
  expect(pageScope()).toEqual({ page: '404', body: PAGE_BODY, theme: 1, css: 1 });
});

it('FE-04b: "Quay lại trang trước" goes back when there is history and home when there is none', async () => {
  window.history.replaceState({}, '', '/khong-co-trang');
  render(<App />);
  await heading();
  const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
  fireEvent.click(screen.getByRole('button', { name: '← Quay lại trang trước' }));
  expect(back).toHaveBeenCalledTimes(1);

  const length = vi.spyOn(window.history, 'length', 'get').mockReturnValue(1);
  fireEvent.click(screen.getByRole('button', { name: '← Quay lại trang trước' }));
  expect(back).toHaveBeenCalledTimes(1);
  expect(window.location.pathname).toBe('/');
  length.mockRestore();
});

it('FE-04b: the 404 theme toggle uses the app theme (class, data-theme, saved choice)', async () => {
  window.history.replaceState({}, '', '/khong-co-trang');
  render(<App />);
  await heading();
  const toggle = screen.getByRole('button', { name: 'Chuyển sang giao diện tối' });
  expect(toggle).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(toggle);
  expect(document.documentElement).toHaveClass('dark');
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(localStorage.getItem('ati-theme')).toBe('dark');
  expect(screen.getByRole('button', { name: 'Chuyển sang giao diện sáng' })).toHaveAttribute('aria-pressed', 'true');
});

it('FE-04b: theme.css stays a verbatim copy of the prototype theme', () => {
  // Chỉ khác dòng ghi nguồn ở đầu file; quy tắc riêng của app không đặt vào đây.
  const app = readFileSync('src/prototype/theme.css', 'utf8').replace(/^\/\*[^\n]*\*\/\r?\n/, '');
  expect(app).toBe(readFileSync('../../docs/design/prototypes/theme.css', 'utf8'));
});

it('FE-04b: FE-04 sizing and focus rules only apply outside prototype pages', () => {
  const css = readFileSync('src/index.css', 'utf8');
  // Màn chưa chuyển giữ chữ tối thiểu 14px; trang của bản React dùng thang chữ của bản mẫu.
  expect(css).toMatch(/:root\s*\{[^}]*--ati-text-xs:\s*14px/);
  expect(css).toMatch(/:root\[data-proto-page\]\s*\{[^}]*--ati-text-xs:\s*0\.75rem/);
  expect(css).toMatch(/--text-xs:\s*var\(--ati-text-xs\)/);
  // Vùng chạm 40×40 và viền focus của FE-04 không áp vào trang bản mẫu.
  for (const rule of [/min-width:\s*40px/, /min-height:\s*40px/, /outline:\s*2px solid var\(--primary\)/]) {
    const block = css.split('}').find(part => rule.test(part));
    expect(block, String(rule)).toMatch(/:root:not\(\[data-proto-page\]\)/);
  }
});
