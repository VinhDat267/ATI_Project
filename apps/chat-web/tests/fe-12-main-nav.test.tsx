/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MainNav, type NavTab } from '../src/components/layout/MainNav';
import { GuidePage } from '../src/pages/Guide/GuidePage';
import { PrivacyPage } from '../src/pages/Privacy/PrivacyPage';
import { apiClient } from '../src/services/api-client';

const member = { id: 'u1', name: 'Lan Nguyễn', email: 'lan@example.test', role: 'member' as const };
const admin = { ...member, id: 'a1', name: 'Quản Trị', role: 'admin' as const };
// Redesign 11/2026: thanh bên gồm cả trang Tự động (trước là Hộp thư đề xuất, trước nữa là chip "Sự kiện" riêng).
const tabs = [
  ['Không gian làm việc', '/'],
  ['Nhật ký', '/history'],
  ['Tự động', '/inbox'],
  ['Kết nối dịch vụ', '/settings'],
  ['Cẩm nang', '/guide'],
  ['Người dùng', '/admin/users'],
] as const;
const nav = () => screen.getByRole('navigation', { name: 'Điều hướng chính' });
const links = () => within(nav()).getAllByRole('link');

beforeEach(() => { vi.spyOn(apiClient, 'getRuntime').mockResolvedValue({ runtimeMode: 'sandbox' }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('FE-12: members get five links in a fixed order and admins also get Người dùng', () => {
  const view = render(<MainNav user={member} current="workspace" navigate={vi.fn()} onLogout={vi.fn()} />);
  expect(links()).toHaveLength(5);
  links().forEach((link, index) => {
    expect(link).toHaveAccessibleName(tabs[index][0]);
    expect(link).toHaveAttribute('href', tabs[index][1]);
  });
  view.unmount();
  render(<MainNav user={admin} current="workspace" navigate={vi.fn()} onLogout={vi.fn()} />);
  expect(links()).toHaveLength(6);
  expect(links()[5]).toHaveAccessibleName('Người dùng');
  expect(links()[5]).toHaveAttribute('href', '/admin/users');
});

it('FE-12: Tự động has one entry, inside the list, and its count is part of its name', () => {
  render(<MainNav user={member} current="inbox" navigate={vi.fn()} onLogout={vi.fn()} inboxBadgeCount={3} />);
  const inbox = within(nav()).getByTestId('nav-events-inbox-link');
  expect(inbox).toHaveAccessibleName('Tự động, 3 đề xuất cần xử lý');
  expect(inbox).toHaveAttribute('aria-current', 'page');
  expect(screen.getAllByRole('link', { name: /^Tự động/ })).toHaveLength(1);
});

it('FE-12: below 1024 px the menu button opens the sidebar as a sheet; a link or Escape closes it', () => {
  const navigate = vi.fn();
  render(<MainNav user={member} current="workspace" navigate={navigate} onLogout={vi.fn()} />);
  expect(screen.queryByRole('complementary')).toBeNull();
  const banner = screen.getByRole('banner');
  const sidebar = document.getElementById('app-sidebar')!;
  const open = screen.getByRole('button', { name: 'Mở menu điều hướng' });
  const close = screen.getByRole('button', { name: 'Đóng menu điều hướng' });
  expect(open).toHaveAttribute('aria-controls', 'app-sidebar');
  fireEvent.click(open);
  expect(sidebar).toHaveAttribute('data-open');
  expect(banner).toHaveAttribute('data-menu-open');
  expect(open).toHaveAttribute('aria-expanded', 'true');
  expect(document.body.style.overflow).toBe('hidden');
  expect(close).toHaveFocus();

  // Tab wraps from the last sidebar link back to the close button, and Shift+Tab wraps backwards.
  const lastLink = links().at(-1)!;
  lastLink.focus();
  fireEvent.keyDown(document, { key: 'Tab' });
  expect(close).toHaveFocus();
  fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
  expect(lastLink).toHaveFocus();

  // Closing with the close button or Escape closes the sheet, restores scroll, and returns focus to the menu button.
  fireEvent.click(close);
  expect(sidebar).not.toHaveAttribute('data-open');
  expect(banner).not.toHaveAttribute('data-menu-open');
  expect(document.body.style.overflow).toBe('');
  expect(open).toHaveFocus();

  fireEvent.click(open);
  expect(close).toHaveFocus();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(sidebar).not.toHaveAttribute('data-open');
  expect(banner).not.toHaveAttribute('data-menu-open');
  expect(document.body.style.overflow).toBe('');
  expect(open).toHaveFocus();

  fireEvent.click(open);
  fireEvent.click(within(nav()).getByRole('link', { name: 'Nhật ký' }));
  expect(navigate).toHaveBeenCalledWith('/history');
  expect(sidebar).not.toHaveAttribute('data-open');
});

it('FE-12: crossing 1024 px closes an open mobile menu sheet automatically', () => {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const originalMatchMedia = window.matchMedia;
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => { listeners.add(listener); },
    removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => { listeners.delete(listener); },
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  try {
    render(<MainNav user={member} current="workspace" navigate={vi.fn()} onLogout={vi.fn()} />);
    const sidebar = document.getElementById('app-sidebar')!;
    fireEvent.click(screen.getByRole('button', { name: 'Mở menu điều hướng' }));
    expect(sidebar).toHaveAttribute('data-open');
    act(() => {
      for (const listener of listeners) listener({ matches: true } as MediaQueryListEvent);
    });
    expect(sidebar).not.toHaveAttribute('data-open');
  } finally {
    window.matchMedia = originalMatchMedia;
  }
});

it('FE-12: the shell marks <html> while it is shown, so its theme never reaches signed-out pages', () => {
  const view = render(<MainNav user={member} current="workspace" navigate={vi.fn()} onLogout={vi.fn()} />);
  expect(document.documentElement).toHaveAttribute('data-app-shell');
  view.unmount();
  expect(document.documentElement).not.toHaveAttribute('data-app-shell');
});

it.each([
  ['workspace', 'Không gian làm việc'],
  ['history', 'Nhật ký'],
  ['settings', 'Kết nối dịch vụ'],
  ['guide', 'Cẩm nang'],
  ['users', 'Người dùng'],
  [null, null],
] as const)('FE-12: current tab %s is the only link marked as the current page', (current, name) => {
  render(<MainNav user={admin} current={current as NavTab | null} navigate={vi.fn()} onLogout={vi.fn()} />);
  const marked = links().filter(link => link.getAttribute('aria-current') === 'page');
  if (name) {
    expect(marked).toHaveLength(1);
    expect(marked[0]).toHaveAccessibleName(name);
  } else expect(marked).toHaveLength(0);
});

it('FE-12: a plain click navigates inside the app, while modifier and middle clicks are left to the browser', () => {
  const navigate = vi.fn();
  render(<MainNav user={member} current="workspace" navigate={navigate} onLogout={vi.fn()} />);
  const settings = within(nav()).getByRole('link', { name: 'Kết nối dịch vụ' });
  // Record whether the app handler kept the browser default, then stop jsdom from following the link.
  const prevented: boolean[] = [];
  const guard = (event: Event) => { prevented.push(event.defaultPrevented); event.preventDefault(); };
  document.addEventListener('click', guard);
  try {
    fireEvent.click(settings);
    expect(navigate).toHaveBeenCalledWith('/settings');
    navigate.mockClear();
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) fireEvent.click(settings, init);
  } finally { document.removeEventListener('click', guard); }
  expect(prevented).toEqual([true, false, false, false, false, false]);
  expect(navigate).not.toHaveBeenCalled();
});

it('FE-12: sidebar links show the same full name they are announced by', () => {
  render(<MainNav user={admin} current="workspace" navigate={vi.fn()} onLogout={vi.fn()} />);
  for (const [name] of tabs) expect(within(nav()).getByRole('link', { name })).toHaveTextContent(name);
});

it('FE-12: the bar keeps the logo outside the tabs, the theme toggle, the avatar menu, extra actions and the page name', () => {
  const navigate = vi.fn();
  render(<MainNav user={member} current="history" pageName="Nhật ký" navigate={navigate} onLogout={vi.fn()} actions={<button type="button">Hành động thêm</button>} />);
  const banner = screen.getByRole('banner');
  const logo = within(banner).getByRole('link', { name: /Về không gian làm việc/ });
  expect(nav()).not.toContainElement(logo);
  fireEvent.click(logo);
  expect(navigate).toHaveBeenCalledWith('/');
  expect(within(banner).getByRole('button', { name: /Chuyển sang giao diện/i })).toBeInTheDocument();
  expect(within(banner).getByRole('button', { name: /Menu người dùng/ })).toBeInTheDocument();
  expect(within(banner).getByRole('button', { name: 'Hành động thêm' })).toBeInTheDocument();
  expect(banner.querySelector('[data-nav-page-name]')).toHaveTextContent('Nhật ký');
});

it('FE-12: the avatar menu only holds account, privacy and logout, without duplicating the sidebar', () => {
  render(<MainNav user={admin} current={null} navigate={vi.fn()} onLogout={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /Menu người dùng/ }));
  expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Tài khoản', 'Chính sách an toàn', 'Đăng xuất']);
});

it('FE-12: signed-in guide and privacy use the shared bar; signed out they keep the old header', () => {
  const navigate = vi.fn();
  const guide = render(<GuidePage user={member} navigate={navigate} onLogout={vi.fn()} />);
  expect(within(nav()).getByRole('link', { name: 'Cẩm nang' })).toHaveAttribute('aria-current', 'page');
  expect(screen.queryByRole('link', { name: 'Quay lại không gian làm việc' })).toBeNull();
  guide.unmount();
  const privacy = render(<PrivacyPage user={member} navigate={navigate} onLogout={vi.fn()} />);
  expect(links().filter(link => link.hasAttribute('aria-current'))).toHaveLength(0);
  expect(screen.getAllByRole('button', { name: /chuyển sang giao diện/i })).toHaveLength(1);
  privacy.unmount();
  render(<GuidePage user={null} navigate={navigate} />);
  expect(screen.queryByRole('navigation', { name: 'Điều hướng chính' })).toBeNull();
  expect(within(screen.getByRole('banner')).getByRole('link', { name: /Về không gian làm việc/ })).toBeInTheDocument();
});
