/** @vitest-environment jsdom */
// Redesign 11/2026 bước 6b: Cẩm nang, Chính sách an toàn và 404 (đã đăng nhập) dùng hệ thống .ps-* của app-shell.css.
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { GuidePage } from '../src/pages/Guide/GuidePage';
import { PrivacyPage } from '../src/pages/Privacy/PrivacyPage';
import { NotFoundPage } from '../src/pages/NotFound/NotFoundPage';
import { apiClient } from '../src/services/api-client';
import { authStorage } from '../src/services/auth-storage';
import { resetWorkspaceStorage } from '../src/services/workspace-storage';

const member = {
  id: 'u1',
  name: 'Lan Nguyễn',
  email: 'lan@example.test',
  role: 'member' as const,
};

beforeEach(() => {
  window.history.replaceState({}, '', '/guide');
  vi.spyOn(apiClient, 'getRuntime').mockResolvedValue({
    runtimeMode: 'sandbox',
    gmailEnabled: true,
    mycalendarEnabled: true,
    mysheetsEnabled: true,
  });
});

afterEach(() => {
  cleanup();
  authStorage.clearStoredTokens();
  resetWorkspaceStorage();
  vi.restoreAllMocks();
});

it('GuidePage uses a single .ps-btn hero CTA, .ps-btn-quiet secondary buttons, .ps-segmented tabs, and no shadows', async () => {
  authStorage.setStoredTokens({ accessToken: 'access', refreshToken: 'refresh', user: member });
  render(<GuidePage user={member} navigate={vi.fn()} onLogout={vi.fn()} />);

  const main = await screen.findByRole('main');
  expect(within(main).getByRole('heading', { level: 1, name: 'Cẩm nang kết nối & Mẫu câu lệnh Planora' })).toBeInTheDocument();
  expect(main.querySelectorAll('.ps-btn')).toHaveLength(1);
  expect(main.querySelector('.ps-btn')).toHaveTextContent('Mở Cài đặt dịch vụ');
  expect(main.querySelectorAll('.ps-btn-quiet').length).toBeGreaterThanOrEqual(2);
  expect(main.querySelector('.ps-segmented')).not.toBeNull();
  expect(within(main).queryByText(/CẨM NANG & THƯ VIỆN LỆNH|1\. Hướng dẫn lấy khoá/)).toBeNull();
  expect(main.querySelectorAll('[class*="shadow-"]')).toHaveLength(0);
});

it('PrivacyPage renders .ps-panel cards without shadows, uppercase badges, or numbered headings while keeping OAuth disclosures', async () => {
  window.history.replaceState({}, '', '/privacy');
  render(<PrivacyPage user={null} navigate={vi.fn()} />);

  const main = await screen.findByRole('main');
  expect(within(main).getByRole('heading', { level: 1, name: 'Dữ liệu và quyền quyết định luôn thuộc về bạn và nhóm của bạn.' })).toBeInTheDocument();
  expect(main.querySelectorAll('.ps-panel').length).toBeGreaterThanOrEqual(6);
  expect(main.querySelectorAll('[class*="shadow-"]')).toHaveLength(0);
  expect(main.querySelectorAll('.uppercase')).toHaveLength(0);
  expect(main.querySelectorAll('.ps-btn')).toHaveLength(0);
  expect(within(main).queryByText(/CAM KẾT AN TOÀN & MINH BẠCH|1\. Bốn cam kết/)).toBeNull();
  expect(within(main).getByText('Quyền truy cập Google')).toBeInTheDocument();
  expect(within(main).getByText(/Tài khoản GitHub bạn kết nối/)).toBeInTheDocument();
});

it('NotFoundPage wraps signedIn=true in MainNav with .ps-pagehead and keeps signedIn=false unchanged', () => {
  authStorage.setStoredTokens({ accessToken: 'access', refreshToken: 'refresh', user: member });
  window.history.replaceState({}, '', '/khong-ton-tai');
  const signedInView = render(<NotFoundPage signedIn user={member} navigate={vi.fn()} onLogout={vi.fn()} />);

  expect(screen.getByRole('button', { name: /Menu người dùng/ })).toBeInTheDocument();
  const main = screen.getByRole('main');
  expect(within(main).getByRole('heading', { level: 1, name: 'Không tìm thấy trang' })).toBeInTheDocument();
  expect(within(main).getByRole('link', { name: 'Về không gian làm việc' })).toHaveClass('ps-btn');
  expect(within(main).getByRole('button', { name: 'Quay lại trang trước' })).toHaveClass('ps-btn-quiet');
  expect(within(main).queryByText('404')).toBeNull();
  expect(main.querySelectorAll('[class*="shadow-"]')).toHaveLength(0);
  signedInView.unmount();

  authStorage.clearStoredTokens();
  render(<NotFoundPage signedIn={false} navigate={vi.fn()} />);
  expect(screen.queryByRole('button', { name: /Menu người dùng/ })).toBeNull();
  expect(within(screen.getByRole('banner')).getByRole('link', { name: /Về trang chủ/ })).toBeInTheDocument();
  expect(within(screen.getByRole('main')).getByRole('link', { name: 'Về trang chủ' })).toBeInTheDocument();
});
