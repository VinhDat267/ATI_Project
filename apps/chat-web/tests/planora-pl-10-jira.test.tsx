/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { JiraConnection } from '../src/pages/Settings/JiraConnection';
import { JiraCallbackView } from '../src/views/JiraCallbackView';
import { jiraApi } from '../src/services/jira-api';
import { authStorage } from '../src/services/auth-storage';
import type { User } from '../src/types';

describe('PL-10 Planora Jira UI & Workspace Management - Business-First UX v2.0', () => {
  const adminUser: User = {
    id: 'u-admin-pl10',
    name: 'Admin User',
    email: 'admin@planora.test',
    role: 'admin',
    status: 'active',
  };

  const memberUser: User = {
    id: 'u-member-pl10',
    name: 'Member User',
    email: 'member@planora.test',
    role: 'member',
    status: 'active',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    authStorage.setStoredTokens({ accessToken: 'test-token', user: adminUser });
  });

  afterEach(() => {
    cleanup();
    authStorage.clearStoredTokens();
    vi.unstubAllGlobals();
  });

  describe('1. Callback Views Integration with ConnectionCallbackFrame', () => {
    it('JiraCallbackView renders Planora brand, status badge, loading indicator, and single back button', async () => {
      const navigateSpy = vi.fn();
      vi.spyOn(jiraApi, 'callback').mockReturnValue(new Promise(() => {}));

      render(
        <JiraCallbackView
          navigate={navigateSpy}
          input={{ code: 'jira_code_123', state: 'jira_state_abc' }}
        />
      );

      // Planora branding & heading
      expect(screen.getAllByText('planora').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByRole('heading', { level: 1, name: 'Kết nối Jira' })).toBeInTheDocument();
      expect(screen.getAllByText('KẾT NỐI QUẢN LÝ DỰ ÁN').length).toBeGreaterThanOrEqual(1);

      // Status indicator
      expect(screen.getByText('Đang xử lý')).toBeInTheDocument();
      const statusEls = screen.getAllByRole('status');
      expect(statusEls.some((el) => el.textContent?.includes('Đang hoàn tất kết nối Jira…'))).toBe(true);

      // Back to settings button from ConnectionCallbackFrame
      const backBtn = screen.getByRole('button', { name: 'Về Kết nối dịch vụ' });
      expect(backBtn).toBeInTheDocument();
      fireEvent.click(backBtn);
      expect(navigateSpy).toHaveBeenCalledWith('/settings#jira', true);

      // No duplicate links to /settings#jira
      const links = screen.queryAllByRole('link', { name: /Về Kết nối dịch vụ/i });
      expect(links.length).toBe(0);
    });

    it('JiraCallbackView renders safe rejection alert on cancellation or invalid state', async () => {
      const navigateSpy = vi.fn();

      render(
        <JiraCallbackView
          navigate={navigateSpy}
          input={{ error: 'access_denied' }}
        />
      );

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Bạn đã huỷ kết nối Jira.');
      expect(screen.getByText('Chưa kết nối')).toBeInTheDocument();
      expect(navigateSpy).not.toHaveBeenCalled();
    });
  });

  describe('2. Design System Tokens & A11y Verification', () => {
    it('JiraConnection uses Planora CSS variables and zero legacy orange #FF5701', async () => {
      vi.spyOn(jiraApi, 'connection').mockResolvedValue({
        connected: false,
        connectionState: 'disconnected',
        jiraAccountId: null,
        atlassianAccountId: null,
        sites: [],
      });
      vi.spyOn(jiraApi, 'workspaces').mockResolvedValue({ workspaces: [] });

      const { container } = render(<JiraConnection user={adminUser} />);

      const connectBtn = await screen.findByRole('button', { name: /kết nối jira/i });
      expect(connectBtn.className).toContain('var(--planora-primary)');
      expect(connectBtn.className).toContain('var(--planora-on-primary)');
      expect(connectBtn.className).not.toContain('#FF5701');

      // Verify no #FF5701 or #E04C00 in entire rendered HTML
      expect(container.innerHTML).not.toContain('#FF5701');
      expect(container.innerHTML).not.toContain('#E04C00');

      // Check all rendered SVGs have aria-hidden="true"
      const svgs = container.querySelectorAll('svg');
      expect(svgs.length).toBeGreaterThan(0);
      svgs.forEach((svg) => {
        expect(svg).toHaveAttribute('aria-hidden', 'true');
      });
    });

    it('JiraConnection contains no legacy ATI text in user-facing labels or modals', async () => {
      vi.spyOn(jiraApi, 'connection').mockResolvedValue({
        connected: true,
        connectionState: 'connected',
        jiraAccountId: 'acc-1',
        atlassianAccountId: 'atl-1',
        displayName: 'Atlassian Pro',
        sites: [],
      });
      vi.spyOn(jiraApi, 'workspaces').mockResolvedValue({ workspaces: [] });

      const { container } = render(<JiraConnection user={adminUser} />);

      await screen.findByRole('button', { name: /ngắt kết nối/i });

      // Click disconnect to trigger confirmation panel
      fireEvent.click(screen.getByRole('button', { name: /ngắt kết nối/i }));

      const confirmText = screen.getByText(/Planora sẽ thu hồi quyền truy cập site/i);
      expect(confirmText).toBeInTheDocument();

      // Check workspace description copy mentions Planora
      expect(screen.getByText(/độc lập với quyền tổ chức Planora/i)).toBeInTheDocument();

      // Check no "tổ chức ATI" string exists in the container
      expect(container.innerHTML).not.toContain('tổ chức ATI');
    });
  });

  describe('3. Independent Jira Workspace RBAC Preservation', () => {
    it('member in team workspace cannot access admin panels even if user has global role admin', async () => {
      vi.spyOn(jiraApi, 'connection').mockResolvedValue({
        connected: true,
        connectionState: 'connected',
        jiraAccountId: 'jira-123',
        atlassianAccountId: 'atl-123',
        sites: [],
      });
      vi.spyOn(jiraApi, 'workspaces').mockResolvedValue({
        workspaces: [
          {
            id: 'ws-member-only',
            name: 'Core Platform',
            slug: 'core-platform',
            role: 'member', // Member in this Jira workspace!
            membershipStatus: 'active',
            workspaceVersion: 1,
            membershipVersion: 1,
          },
        ],
      });
      vi.spyOn(jiraApi, 'capabilities').mockResolvedValue({
        workspaceId: 'ws-member-only',
        sites: [],
      });

      // User has global admin role: adminUser.role === 'admin'
      render(<JiraConnection user={adminUser} />);

      await waitFor(() => {
        expect(screen.getAllByText(/Core Platform/i)[0]).toBeInTheDocument();
        expect(screen.getByText(/Thành viên hoạt động/i)).toBeInTheDocument();
      });

      // Admin panels must NOT be visible to a Jira workspace member
      expect(screen.queryByText(/Quản lý thành viên/i)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /tạo mã mời/i })).not.toBeInTheDocument();
      expect(screen.queryByText(/Liên kết Jira Sites & Projects/i)).not.toBeInTheDocument();
    });

    it('admin in Jira workspace can manage members, invites, and projects', async () => {
      vi.spyOn(jiraApi, 'connection').mockResolvedValue({
        connected: true,
        connectionState: 'connected',
        jiraAccountId: 'jira-123',
        atlassianAccountId: 'atl-123',
        sites: [],
      });
      vi.spyOn(jiraApi, 'workspaces').mockResolvedValue({
        workspaces: [
          {
            id: 'ws-admin-only',
            name: 'Core Platform Admin',
            slug: 'core-platform-admin',
            role: 'admin', // Admin in this Jira workspace!
            membershipStatus: 'active',
            workspaceVersion: 1,
            membershipVersion: 1,
          },
        ],
      });
      vi.spyOn(jiraApi, 'members').mockResolvedValue({
        members: [{ userId: 'user-pending-test', role: 'member', status: 'pending', version: 1 }],
      });
      vi.spyOn(jiraApi, 'invites').mockResolvedValue({ invites: [] });
      vi.spyOn(jiraApi, 'sites').mockResolvedValue({ sites: [] });
      vi.spyOn(jiraApi, 'capabilities').mockResolvedValue({
        workspaceId: 'ws-admin-only',
        sites: [],
      });

      // User with memberUser global role is admin in this workspace!
      render(<JiraConnection user={memberUser} />);

      await waitFor(() => {
        expect(screen.getAllByText(/Core Platform Admin/i)[0]).toBeInTheDocument();
        expect(screen.getByText(/Quản lý thành viên \(1\)/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /tạo mã mời/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /duyệt thành viên user-pending-test/i })).toBeInTheDocument();
      });
    });
  });
});
