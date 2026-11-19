/** @vitest-environment jsdom */
// Redesign 11/2026 bước 6a: Tài khoản và Người dùng dùng chung khung .ps-* của app-shell.css, không đổ bóng hay bộ nút riêng.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { AccountPage } from '../src/pages/Account/AccountPage';
import { UsersPage } from '../src/pages/Users/UsersPage';
import { apiClient } from '../src/services/api-client';
import { authStorage } from '../src/services/auth-storage';
import { resetWorkspaceStorage } from '../src/services/workspace-storage';

const admin = {
  id: 'a1',
  name: 'Quản Trị',
  email: 'admin@example.test',
  role: 'admin' as const,
  emailVerified: true,
};

beforeEach(() => {
  authStorage.setStoredTokens({ accessToken: 'access', refreshToken: 'refresh', user: admin });
  vi.spyOn(apiClient, 'getRuntime').mockResolvedValue({ runtimeMode: 'sandbox' });
  vi.spyOn(apiClient, 'getAuthConfig').mockResolvedValue({ signupEnabled: false, googleEnabled: true });
  vi.spyOn(apiClient, 'getAccount').mockResolvedValue({
    account: {
      ...admin,
      createdAt: '2026-10-01T00:00:00Z',
      hasPassword: true,
      hasGoogle: true,
      googleEmail: 'admin@gmail.test',
    },
  });
  vi.spyOn(apiClient, 'getAccountSessions').mockResolvedValue({
    sessions: [
      { id: 's1', device: 'Chrome trên Windows', createdAt: '2026-10-04T01:00:00Z', lastUsedAt: '2026-10-04T02:00:00Z', current: true },
      { id: 's2', device: 'Safari trên iOS', createdAt: '2026-10-03T01:00:00Z', lastUsedAt: '2026-10-03T02:00:00Z', current: false },
    ],
  });
  vi.spyOn(apiClient, 'getAdminUsers').mockResolvedValue({
    users: [],
    total: 0,
    pendingCount: 0,
    page: 1,
    limit: 20,
  });
});

afterEach(() => {
  cleanup();
  authStorage.clearStoredTokens();
  resetWorkspaceStorage();
  vi.restoreAllMocks();
});

it('AccountPage uses .ps-* panels, buttons, status indicators, and omits breadcrumbs/numbered headings/shadows', async () => {
  render(<AccountPage user={admin} navigate={vi.fn()} onLogout={vi.fn()} />);
  const main = await screen.findByRole('main');
  expect(within(main).getByRole('heading', { level: 1, name: 'Tài khoản' })).toBeInTheDocument();
  expect(within(main).getByRole('heading', { level: 2, name: 'Họ tên' })).toBeInTheDocument();
  expect(within(main).getByRole('heading', { level: 2, name: 'Mật khẩu' })).toBeInTheDocument();
  expect(within(main).getByRole('heading', { level: 2, name: 'Phiên đăng nhập' })).toBeInTheDocument();
  expect(within(main).getByRole('heading', { level: 2, name: 'Google' })).toBeInTheDocument();
  expect(within(main).queryByText(/Cài đặt tài khoản|1\. Thông tin|2\. Đổi|3\. Các phiên|4\. Liên kết/)).toBeNull();
  expect(within(main).getByRole('button', { name: 'Lưu thay đổi họ tên' })).toHaveClass('ps-btn');
  expect(within(main).getByRole('button', { name: 'Cập nhật mật khẩu mới' })).toHaveClass('ps-btn-quiet');
  expect(within(main).getByRole('button', { name: 'Đăng xuất khỏi mọi thiết bị khác' })).toHaveClass('ps-btn-quiet', 'ps-btn-danger');
  expect(within(main).getByRole('button', { name: 'Đăng xuất phiên này' })).toHaveClass('ps-btn-quiet', 'ps-btn-danger');
  expect(within(main).getByRole('button', { name: 'Gỡ liên kết Google' })).toHaveClass('ps-btn-quiet', 'ps-btn-danger');
  expect(document.getElementById('input-email-readonly')).toHaveClass('ps-field');
  expect(document.getElementById('input-email-readonly')).not.toHaveClass('font-mono');
  expect(main.querySelectorAll('[class*="shadow-"]')).toHaveLength(0);
});

it('UsersPage uses .ps-pagehead, .ps-stats, .ps-segmented, .ps-field, and flat .ps-panel lists without shadows', async () => {
  render(<UsersPage user={admin} navigate={vi.fn()} onLogout={vi.fn()} />);
  const main = await screen.findByRole('main');
  expect(within(main).getByRole('heading', { level: 1, name: 'Người dùng' })).toBeInTheDocument();
  expect(within(main).queryByText(/Quy tắc nhóm|Đường dẫn chuyển trang/)).toBeNull();
  expect(main.querySelector('.ps-stats')).not.toBeNull();
  expect(main.querySelector('.ps-segmented')).not.toBeNull();
  expect(within(main).getByRole('searchbox')).toHaveClass('ps-field');
  expect(within(main).getByRole('button', { name: 'Trang trước' })).toHaveClass('ps-btn-quiet');
  expect(within(main).getByRole('button', { name: 'Trang sau' })).toHaveClass('ps-btn-quiet');
  expect(main.querySelectorAll('[class*="shadow-"]')).toHaveLength(0);
});
