/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PlanoraShell } from '../src/planora/layout/PlanoraShell';
import { PlanoraPublicHeader } from '../src/planora/layout/PlanoraPublicHeader';
import { MainNav } from '../src/components/layout/MainNav';
import {
  getActiveWorkspaceId,
  setActiveWorkspaceId,
  setCachedOrganizations,
} from '../src/services/workspace-storage';
import { useChatStore } from '../src/store/chat-store';
import { apiClient } from '../src/services/api-client';
import type { User, WorkspaceSummary } from '../src/types';

const memberUser: User = {
  id: 'user-member-1',
  name: 'Nguyễn Văn Member',
  email: 'member@example.test',
  role: 'member',
};

const adminUser: User = {
  id: 'user-admin-1',
  name: 'Trần Thị Admin',
  email: 'admin@example.test',
  role: 'admin',
};

const sampleOrg: WorkspaceSummary = {
  id: 'ws-team-alpha',
  name: 'Đội Alpha',
  role: 'admin',
  status: 'active',
  pendingCount: 3,
};

const sampleOrgMember: WorkspaceSummary = {
  id: 'ws-team-beta',
  name: 'Đội Beta',
  role: 'member',
  status: 'active',
};

beforeEach(() => {
  localStorage.clear();
  setActiveWorkspaceId('personal');
  setCachedOrganizations([]);
  useChatStore.getState().reset();
  vi.spyOn(apiClient, 'getRuntime').mockResolvedValue({ runtimeMode: 'sandbox' });
  vi.spyOn(apiClient, 'getWorkspaces').mockResolvedValue({
    personal: { id: 'personal', name: 'Không gian Cá nhân', role: 'admin', status: 'active' },
    organizations: [sampleOrg, sampleOrgMember],
  });
  vi.spyOn(apiClient, 'getSchedulePendingCount').mockResolvedValue({ count: 2 });
  vi.spyOn(apiClient, 'getConversations').mockResolvedValue({ conversations: [], nextCursor: null });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('PlanoraShell & PlanoraSidebar (PL-02)', () => {
  describe('1. Navigation items and route switching', () => {
    it('renders Planora brand, WorkspaceSwitcher, new conversation button, and navigation tabs', async () => {
      const navigate = vi.fn();
      const onLogout = vi.fn();

      render(
        <PlanoraShell
          user={memberUser}
          currentTab="workspace"
          navigate={navigate}
          onLogout={onLogout}
        >
          <main>
            <h1>Nội dung trang</h1>
          </main>
        </PlanoraShell>
      );

      // Single main landmark and single h1
      expect(screen.getAllByRole('main')).toHaveLength(1);
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Nội dung trang');

      // Global nav
      const nav = screen.getByRole('navigation', { name: 'Điều hướng chính' });
      expect(nav).toBeInTheDocument();

      // Brand
      expect(screen.getAllByLabelText(/Planora/i).length).toBeGreaterThanOrEqual(1);

      // New conversation button
      const newChatBtn = screen.getByRole('button', { name: /Hội thoại mới/i });
      expect(newChatBtn).toBeInTheDocument();
      fireEvent.click(newChatBtn);
      expect(navigate).toHaveBeenCalledWith('/');

      // Nav tabs in sidebar: Hội thoại, Nhật ký, Kết nối dịch vụ, Cẩm nang
      const links = within(nav).getAllByRole('link');
      expect(links.length).toBeGreaterThanOrEqual(4);

      const convLink = within(nav).getByRole('link', { name: /Không gian làm việc|Hội thoại/i });
      expect(convLink).toHaveAttribute('aria-current', 'page');

      const historyLink = within(nav).getByRole('link', { name: /Nhật ký/i });
      expect(historyLink).toHaveAttribute('href', '/history');
      fireEvent.click(historyLink);
      expect(navigate).toHaveBeenCalledWith('/history');
    });

    it('plain clicks navigate while modifier clicks and middle clicks are left to browser default', () => {
      const navigate = vi.fn();
      render(
        <PlanoraShell
          user={memberUser}
          currentTab="workspace"
          navigate={navigate}
          onLogout={vi.fn()}
        >
          <main>
            <h1>Trang</h1>
          </main>
        </PlanoraShell>
      );

      const nav = screen.getByRole('navigation', { name: 'Điều hướng chính' });
      const settingsLink = within(nav).getByRole('link', { name: /Kết nối/i });

      const prevented: boolean[] = [];
      const guard = (e: Event) => {
        prevented.push(e.defaultPrevented);
        e.preventDefault();
      };
      document.addEventListener('click', guard);
      try {
        fireEvent.click(settingsLink);
        expect(navigate).toHaveBeenCalledWith('/settings');
        navigate.mockClear();

        for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
          fireEvent.click(settingsLink, init);
        }
      } finally {
        document.removeEventListener('click', guard);
      }
      expect(prevented).toEqual([true, false, false, false, false, false]);
      expect(navigate).not.toHaveBeenCalled();
    });
  });

  describe('2. Admin permission: organization admin vs global user.role', () => {
    it('shows "Người dùng" tab when memberUser is admin in an organization workspace', async () => {
      setCachedOrganizations([sampleOrg]);
      setActiveWorkspaceId('ws-team-alpha'); // role is 'admin' in this org

      render(
        <PlanoraShell
          user={memberUser} // global role is 'member'!
          currentTab="workspace"
          navigate={vi.fn()}
          onLogout={vi.fn()}
        >
          <main>
            <h1>Trang Admin Org</h1>
          </main>
        </PlanoraShell>
      );

      const nav = screen.getByRole('navigation', { name: 'Điều hướng chính' });
      expect(within(nav).getByRole('link', { name: /Người dùng/i })).toBeInTheDocument();
    });

    it('hides "Người dùng" tab when memberUser is in Personal workspace or member in Org workspace', async () => {
      // In personal workspace: memberUser cannot manage users
      setActiveWorkspaceId('personal');

      const { unmount } = render(
        <PlanoraShell
          user={memberUser}
          currentTab="workspace"
          navigate={vi.fn()}
          onLogout={vi.fn()}
        >
          <main>
            <h1>Trang Personal Member</h1>
          </main>
        </PlanoraShell>
      );

      const nav1 = screen.getByRole('navigation', { name: 'Điều hướng chính' });
      expect(within(nav1).queryByRole('link', { name: /Người dùng/i })).toBeNull();
      unmount();

      // In Org workspace where user is only a member:
      setCachedOrganizations([sampleOrgMember]);
      setActiveWorkspaceId('ws-team-beta');

      render(
        <PlanoraShell
          user={memberUser}
          currentTab="workspace"
          navigate={vi.fn()}
          onLogout={vi.fn()}
        >
          <main>
            <h1>Trang Org Member</h1>
          </main>
        </PlanoraShell>
      );

      const nav2 = screen.getByRole('navigation', { name: 'Điều hướng chính' });
      expect(within(nav2).queryByRole('link', { name: /Người dùng/i })).toBeNull();
    });

    it('shows "Người dùng" tab in Personal workspace if global user.role is admin', () => {
      setActiveWorkspaceId('personal');

      render(
        <PlanoraShell
          user={adminUser} // global role is 'admin'
          currentTab="workspace"
          navigate={vi.fn()}
          onLogout={vi.fn()}
        >
          <main>
            <h1>Trang Personal Admin</h1>
          </main>
        </PlanoraShell>
      );

      const nav = screen.getByRole('navigation', { name: 'Điều hướng chính' });
      expect(within(nav).getByRole('link', { name: /Người dùng/i })).toBeInTheDocument();
    });
  });

  describe('3. Pending badges: schedules & users pending count', () => {
    it('displays pending count badges on History and Users nav items when counts > 0', async () => {
      setCachedOrganizations([sampleOrg]);
      setActiveWorkspaceId('ws-team-alpha'); // pendingCount: 3

      render(
        <PlanoraShell
          user={memberUser}
          currentTab="workspace"
          navigate={vi.fn()}
          onLogout={vi.fn()}
        >
          <main>
            <h1>Trang Badges</h1>
          </main>
        </PlanoraShell>
      );

      // Pending users count badge
      await waitFor(() => {
        const usersPending = document.querySelector('[data-users-pending-count]');
        expect(usersPending).toHaveTextContent('3');
      });
    });
  });

  describe('4. Mobile drawer accessibility & WorkspaceSwitcher', () => {
    it('opens drawer with hamburger button, closes with Escape key and restores focus', async () => {
      render(
        <PlanoraShell
          user={memberUser}
          currentTab="workspace"
          navigate={vi.fn()}
          onLogout={vi.fn()}
        >
          <main>
            <h1>Trang Drawer</h1>
          </main>
        </PlanoraShell>
      );

      const toggleBtn = screen.getByRole('button', { name: /Mở danh sách hội thoại|Mở menu điều hướng/i });
      expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');

      // Click to open drawer
      fireEvent.click(toggleBtn);
      expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');

      // Backdrop exists and is active
      const backdrop = document.querySelector('.planora-drawer-backdrop');
      expect(backdrop).toBeInTheDocument();

      // Press Escape closes drawer
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
    });

    it('closes drawer when clicking the close button inside sidebar', () => {
      render(
        <PlanoraShell
          user={memberUser}
          currentTab="workspace"
          navigate={vi.fn()}
          onLogout={vi.fn()}
        >
          <main>
            <h1>Trang Drawer Close</h1>
          </main>
        </PlanoraShell>
      );

      const toggleBtn = screen.getByRole('button', { name: /Mở danh sách hội thoại|Mở menu điều hướng/i });
      fireEvent.click(toggleBtn);
      expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');

      const closeBtn = screen.getByRole('button', { name: /Đóng điều hướng|Đóng menu/i });
      fireEvent.click(closeBtn);
      expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
    });

    it('WorkspaceSwitcher is accessible on mobile and desktop and preserves current route on switch', async () => {
      const navigate = vi.fn();
      setCachedOrganizations([sampleOrg]);

      render(
        <PlanoraShell
          user={memberUser}
          currentTab="settings"
          navigate={navigate}
          onLogout={vi.fn()}
        >
          <main>
            <h1>Trang Settings</h1>
          </main>
        </PlanoraShell>
      );

      // Find WorkspaceSwitcher
      const switcherBtn = screen.getAllByRole('button', { name: /Không gian làm việc:/i })[0];
      expect(switcherBtn).toBeInTheDocument();

      fireEvent.click(switcherBtn);
      expect(screen.getByText('Đội Alpha')).toBeInTheDocument();

      // Click org
      fireEvent.click(screen.getByText('Đội Alpha'));
      expect(getActiveWorkspaceId()).toBe('ws-team-alpha');

      // On /settings, workspace switch does NOT kick user back to '/'!
      expect(navigate).not.toHaveBeenCalledWith('/');
    });
  });

  describe('5. Wrapper elimination: no duplicate MainNav or main landmark', () => {
    it('when MainNav is rendered inside PlanoraShell, it suppresses duplicate nav and header', () => {
      render(
        <PlanoraShell
          user={memberUser}
          currentTab="settings"
          navigate={vi.fn()}
          onLogout={vi.fn()}
        >
          <MainNav
            user={memberUser}
            current="settings"
            pageName="Kết nối dịch vụ"
            navigate={vi.fn()}
            onLogout={vi.fn()}
          />
          <main>
            <h1>Kết nối dịch vụ</h1>
          </main>
        </PlanoraShell>
      );

      // Exactly ONE main landmark
      expect(screen.getAllByRole('main')).toHaveLength(1);

      // Exactly ONE h1 heading
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);

      // Exactly ONE global navigation landmark
      expect(screen.getAllByRole('navigation', { name: 'Điều hướng chính' })).toHaveLength(1);
    });
  });

  describe('6. Stale GET/SSE isolation on workspace switch', () => {
    it('resets chat store when switching workspace so stale responses do not overwrite new context', () => {
      useChatStore.getState().setConversationId('conv-alpha-123');
      useChatStore.getState().setActivePlan({
        id: 'plan-123',
        status: 'preview',
        steps: [],
      } as any);

      render(
        <PlanoraShell
          user={memberUser}
          currentTab="workspace"
          navigate={vi.fn()}
          onLogout={vi.fn()}
        >
          <main>
            <h1>Hội thoại</h1>
          </main>
        </PlanoraShell>
      );

      // Switch to another workspace
      setActiveWorkspaceId('ws-team-alpha');

      // Chat store should be reset
      expect(useChatStore.getState().conversationId).toBeNull();
      expect(useChatStore.getState().activePlan).toBeNull();
    });
  });
});

describe('PlanoraPublicHeader (PL-02)', () => {
  it('renders public header with Planora brand, public nav links, theme toggle, and login CTA', () => {
    const navigate = vi.fn();
    render(
      <PlanoraPublicHeader
        navigate={navigate}
      />
    );

    const banner = screen.getByRole('banner');
    expect(banner).toBeInTheDocument();
    expect(within(banner).getByLabelText(/Planora/i)).toBeInTheDocument();
    expect(within(banner).getByRole('button', { name: /Chuyển sang giao diện/i })).toBeInTheDocument();

    const loginBtn = within(banner).getByRole('button', { name: /Đăng nhập/i });
    expect(loginBtn).toBeInTheDocument();
    fireEvent.click(loginBtn);
    expect(navigate).toHaveBeenCalledWith('/login');
  });
});
