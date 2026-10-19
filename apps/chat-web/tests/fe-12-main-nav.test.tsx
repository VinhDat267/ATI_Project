/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MainNav, type NavTab } from '../src/components/layout/MainNav';
import { GuidePage } from '../src/pages/Guide/GuidePage';
import { PrivacyPage } from '../src/pages/Privacy/PrivacyPage';
import { apiClient } from '../src/services/api-client';

const member = { id: 'u1', name: 'Lan Nguyễn', email: 'lan@example.test', role: 'member' as const };
const admin = { ...member, id: 'a1', name: 'Quản Trị', role: 'admin' as const };
const tabs = [
  ['Không gian làm việc', '/'],
  ['Nhật ký', '/history'],
  ['Kết nối dịch vụ', '/settings'],
  ['Cẩm nang', '/guide'],
  ['Người dùng', '/admin/users'],
] as const;
const nav = () => screen.getByRole('navigation', { name: 'Điều hướng chính' });
const links = () => within(nav()).getAllByRole('link');

beforeEach(() => { vi.spyOn(apiClient, 'getRuntime').mockResolvedValue({ runtimeMode: 'sandbox' }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('FE-12: members get four tabs in a fixed order and admins also get Người dùng', () => {
  const view = render(<MainNav user={member} current="workspace" navigate={vi.fn()} onLogout={vi.fn()} />);
  expect(links()).toHaveLength(4);
  links().forEach((link, index) => {
    expect(link).toHaveAccessibleName(tabs[index][0]);
    expect(link).toHaveAttribute('href', tabs[index][1]);
  });
  view.unmount();
  render(<MainNav user={admin} current="workspace" navigate={vi.fn()} onLogout={vi.fn()} />);
  expect(links()).toHaveLength(5);
  expect(links()[4]).toHaveAccessibleName('Người dùng');
  expect(links()[4]).toHaveAttribute('href', '/admin/users');
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

it('FE-12: tabs keep their full accessible name next to the shortened label', () => {
  render(<MainNav user={admin} current="workspace" navigate={vi.fn()} onLogout={vi.fn()} />);
  const workspace = within(nav()).getByRole('link', { name: 'Không gian làm việc' });
  const settings = within(nav()).getByRole('link', { name: 'Kết nối dịch vụ' });
  expect(workspace).toHaveTextContent('Làm việc');
  expect(settings).toHaveTextContent('Kết nối');
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

it('FE-12: the avatar menu still lists every page, so phones can reach all of them', () => {
  render(<MainNav user={admin} current={null} navigate={vi.fn()} onLogout={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /Menu người dùng/ }));
  expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Nhật ký điều phối', 'Kết nối dịch vụ', 'Cẩm nang', 'Tài khoản', 'Quản lý người dùng', 'Chính sách an toàn', 'Đăng xuất']);
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
