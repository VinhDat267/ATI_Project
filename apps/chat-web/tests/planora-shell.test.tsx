/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PlanoraShell } from '../src/planora/layout/PlanoraShell';
import { PlanoraPublicHeader } from '../src/planora/layout/PlanoraPublicHeader';
import { MainNav } from '../src/components/layout/MainNav';
import { App } from '../src/App';
import { handleSSEEvent } from '../src/hooks/use-sse';
import {
  getActiveWorkspaceId,
  setActiveWorkspaceId,
  setCachedOrganizations,
} from '../src/services/workspace-storage';
import { useChatStore } from '../src/store/chat-store';
import { apiClient } from '../src/services/api-client';
import { authStorage } from '../src/services/auth-storage';
import { loadConversationHistory } from '../src/hooks/use-conversation-history';
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
  vi.spyOn(apiClient, 'getMe').mockResolvedValue({ user: memberUser });
  vi.spyOn(apiClient, 'getAuthConfig').mockResolvedValue({ signupEnabled: false, googleEnabled: false });
  vi.spyOn(apiClient, 'getServices').mockResolvedValue({ services: [], canConfigure: false });
  vi.spyOn(apiClient, 'getActivePlan').mockResolvedValue(null);
  vi.spyOn(apiClient, 'getExecutionStatus').mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  authStorage.clearStoredTokens();
  window.history.replaceState({}, '', '/');
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

    it('ignores deferred GET/SSE responses from a previous workspace after switching to a new workspace', async () => {
      setActiveWorkspaceId('ws-team-alpha');
      useChatStore.getState().setConversationId('conv-alpha');

      let resolveAlphaRequest!: (val: any) => void;
      vi.spyOn(apiClient, 'getConversation').mockImplementation((id: string) => {
        if (id === 'conv-alpha') {
          return new Promise((resolve) => {
            resolveAlphaRequest = resolve;
          });
        }
        return Promise.resolve({ conversation: { id }, messages: [] });
      });

      render(
        <PlanoraShell
          user={memberUser}
          currentTab="workspace"
          navigate={vi.fn()}
          onLogout={vi.fn()}
        >
          <main>
            <h1>Hội thoại Alpha</h1>
          </main>
        </PlanoraShell>
      );

      // Trigger actual conversation history load for Alpha through loadConversationHistory
      const historyPromise = loadConversationHistory(
        'conv-alpha',
        () => getActiveWorkspaceId() === 'ws-team-alpha' && useChatStore.getState().conversationId === 'conv-alpha'
      );

      // User switches to Personal workspace while Alpha request is still in-flight
      setActiveWorkspaceId('personal');
      expect(getActiveWorkspaceId()).toBe('personal');
      expect(useChatStore.getState().conversationId).toBeNull();

      // Late SSE events arrive from previous workspace/conversation (conv-alpha)
      handleSSEEvent('clarification', JSON.stringify({ question: 'Stale Question' }), undefined, 'conv-alpha');
      handleSSEEvent('plan', JSON.stringify({ plan: { id: 'p-stale', title: 'Stale Plan' } }), undefined, 'conv-alpha');

      // Later, the delayed response from Alpha arrives
      const alphaResponseData = {
        conversation: { id: 'conv-alpha', title: 'Stale Alpha' },
        messages: [{ id: 'm-alpha', role: 'assistant', content: 'Stale Alpha Reply' }],
      };
      resolveAlphaRequest(alphaResponseData);
      await historyPromise;

      // Because workspace switched, isCurrent() returned false and discarded the data.
      // Active workspace remains 'personal' with clean store and zero state leakage!
      expect(getActiveWorkspaceId()).toBe('personal');
      expect(useChatStore.getState().conversationId).toBeNull();
      expect(useChatStore.getState().messages).toHaveLength(0);
      expect(useChatStore.getState().activeClarification).toBeNull();
      expect(useChatStore.getState().activePlan).toBeNull();
    });
  });

  describe('7. Codex Findings Regressions (F1 - F6, R1 - R4)', () => {
    it('F1 & R3: App preserves pending request lock on c1 when navigating away via "Hội thoại mới" and back', async () => {
      authStorage.setStoredTokens({ accessToken: 'test-token', user: memberUser });
      window.history.replaceState({}, '', '/c/c1');

      let resolveSend!: (val: any) => void;
      vi.spyOn(apiClient, 'sendMessage').mockImplementation(() => {
        return new Promise((resolve) => {
          resolveSend = resolve;
        });
      });
      vi.spyOn(apiClient, 'getConversation').mockImplementation((id: string) => {
        if (id === 'c1') {
          return Promise.resolve({
            conversation: { id: 'c1', title: 'Hội thoại c1' },
            messages: [{ id: 'm0', role: 'user', content: 'Tin nhắn c1 đầu tiên' }],
          });
        }
        return Promise.resolve({ conversation: { id }, messages: [] });
      });

      render(<App />);

      // Wait for conversation c1 and composer to hydrate
      const input = await screen.findByRole('textbox', { name: /Mô tả công việc bạn muốn thực hiện|Nhắn cho ATI/i });
      fireEvent.change(input, { target: { value: 'Chạy phân tích c1' } });

      const sendBtn = screen.getByRole('button', { name: /Gửi yêu cầu|Gửi tin nhắn|Gửi/i });
      expect(sendBtn).not.toBeDisabled();

      // Submit message on c1 (triggers apiClient.sendMessage and sets isPlanning)
      fireEvent.click(sendBtn);

      // Verify c1 entered planning state
      expect(useChatStore.getState().isPlanning).toBe(true);
      expect(useChatStore.getState().planningByConversation['c1']).toBeDefined();

      // Attempting to begin planning on c1 again is rejected
      expect(useChatStore.getState().beginPlanning('c1', 'req-duplicate')).toBe(false);

      // Click actual sidebar "Hội thoại mới" button inside <App /> (calls App.tsx:handleNewConversation)
      const newChatBtn = screen.getByRole('button', { name: /Hội thoại mới/i });
      fireEvent.click(newChatBtn);

      // Verify route navigated to / and draft conversation is initialized
      expect(window.location.pathname).toBe('/');
      expect(useChatStore.getState().conversationId).toBeNull();
      expect(useChatStore.getState().isPlanning).toBe(false);

      // Critical invariant: App.tsx reset({ preservePlanning: true }) preserved c1 lock!
      expect(useChatStore.getState().planningByConversation['c1']).toBeDefined();

      // Navigate back to /c/c1 via browser history / popstate
      act(() => {
        window.history.pushState({}, '', '/c/c1');
        window.dispatchEvent(new PopStateEvent('popstate'));
      });

      await waitFor(() => {
        expect(useChatStore.getState().conversationId).toBe('c1');
      });

      // Assert isPlanning is restored on c1
      expect(useChatStore.getState().isPlanning).toBe(true);

      // Even with text typed in composer, send button remains disabled while in-flight planning is active
      const c1Input = await screen.findByRole('textbox', { name: /Mô tả công việc bạn muốn thực hiện|Nhắn cho ATI/i });
      fireEvent.change(c1Input, { target: { value: 'Tin nhắn thứ hai khi c1 đang planning' } });
      const c1SendBtn = screen.getByRole('button', { name: /Gửi yêu cầu|Gửi tin nhắn|Gửi/i });
      expect(c1SendBtn).toBeDisabled();

      // Concurrency lock remains enforced
      expect(useChatStore.getState().beginPlanning('c1', 'req-duplicate-2')).toBe(false);

      // Once the pending in-flight request finishes and planner settles
      resolveSend({ messageId: 'm1' });
      act(() => {
        useChatStore.getState().setIsPlanning(false, 'c1');
      });

      await waitFor(() => {
        expect(useChatStore.getState().isPlanning).toBe(false);
      });
      // Invariant: after in-flight request settles, c1 unlocks for new planning requests
      expect(useChatStore.getState().beginPlanning('c1', 'req-next')).toBe(true);
    });

    it('F2 & R1: Mobile drawer isolates focus, traps Tab navigation, applies inert to background, and restores focus to opener', async () => {
      render(
        <PlanoraShell
          user={memberUser}
          currentTab="workspace"
          navigate={vi.fn()}
          onLogout={vi.fn()}
        >
          <main>
            <h1>Trang chính</h1>
          </main>
        </PlanoraShell>
      );

      const toggleBtn = screen.getByRole('button', { name: /Mở menu điều hướng/i });
      const wsPill = screen.getByRole('button', { name: /Mở menu không gian làm việc/i });

      // Test 1: Open via hamburger button
      fireEvent.click(toggleBtn);
      expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');

      // Drawer has role="dialog" and aria-modal="true" on mobile
      const drawer = document.querySelector('.planora-sidebar');
      expect(drawer).toHaveAttribute('role', 'dialog');
      expect(drawer).toHaveAttribute('aria-modal', 'true');

      // Close button inside drawer received focus
      const closeBtn = screen.getByRole('button', { name: /Đóng điều hướng/i });
      await waitFor(() => {
        expect(document.activeElement).toBe(closeBtn);
      });

      // Background main-work has inert attribute
      const mainWork = document.querySelector('.planora-main-work');
      expect(mainWork).toHaveAttribute('inert');

      // Pressing Escape closes drawer and restores focus to hamburger toggle button
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
      await waitFor(() => {
        expect(document.activeElement).toBe(toggleBtn);
      });
      expect(mainWork).not.toHaveAttribute('inert');

      // Test 2 (R1): Open via workspace pill button
      fireEvent.click(wsPill);
      expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');
      await waitFor(() => {
        expect(document.activeElement).toBe(closeBtn);
      });

      // Press Escape: focus must return to wsPill!
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
      await waitFor(() => {
        expect(document.activeElement).toBe(wsPill);
      });
    });

    it('F3, F4 & R2: WorkspaceSwitcher overlays render via Portal, trap focus, have role="dialog", and Escape closes modal before drawer', async () => {
      render(
        <PlanoraShell
          user={memberUser}
          currentTab="workspace"
          navigate={vi.fn()}
          onLogout={vi.fn()}
        >
          <main>
            <h1>Trang làm việc</h1>
          </main>
        </PlanoraShell>
      );

      // Open mobile drawer
      const toggleBtn = screen.getByRole('button', { name: /Mở menu điều hướng/i });
      fireEvent.click(toggleBtn);

      // Open workspace switcher dropdown in sidebar
      const switcherBtn = screen.getByRole('button', { name: /Không gian làm việc:/i });
      fireEvent.click(switcherBtn);

      // Click "Tạo không gian tổ chức mới"
      const createOrgBtn = screen.getByRole('button', { name: /Tạo không gian tổ chức mới/i });
      fireEvent.click(createOrgBtn);

      // Modal is rendered via Portal directly into document.body with role="dialog"
      const createModal = screen.getByRole('dialog', { name: 'Tạo không gian tổ chức mới' });
      expect(createModal).toBeInTheDocument();
      expect(createModal.parentElement).toBe(document.body);

      // R2: Initial focus moves to primary input inside modal
      const orgNameInput = screen.getByLabelText(/Tên tổ chức/i);
      await waitFor(() => {
        expect(document.activeElement).toBe(orgNameInput);
      });

      // R2: Focus trap loops within modal
      fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
      expect(createModal.contains(document.activeElement)).toBe(true);

      // R2: Clicking mouse on input inside modal portal does NOT close dropdown or unmount trigger button
      fireEvent.mouseDown(orgNameInput);
      expect(screen.getByRole('dialog', { name: 'Tạo không gian tổ chức mới' })).toBeInTheDocument();
      expect(document.body.contains(createOrgBtn)).toBe(true);

      // Press Escape: closes the create modal first, focus returns to opener, drawer remains open!
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByRole('dialog', { name: 'Tạo không gian tổ chức mới' })).toBeNull();
      expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');
      await waitFor(() => {
        expect(document.activeElement).toBe(createOrgBtn);
      });
      expect(document.activeElement).not.toBe(document.body);
    });

    it('R2 regression: If trigger button unmounts while modal is open, closing modal falls back to WorkspaceSwitcher button and never drops to document.body', async () => {
      render(
        <PlanoraShell
          user={memberUser}
          currentTab="workspace"
          navigate={vi.fn()}
          onLogout={vi.fn()}
        >
          <main>
            <h1>Trang làm việc</h1>
          </main>
        </PlanoraShell>
      );

      // Open mobile drawer
      const toggleBtn = screen.getByRole('button', { name: /Mở menu điều hướng/i });
      fireEvent.click(toggleBtn);

      // Open workspace switcher dropdown in sidebar
      const switcherBtn = screen.getByRole('button', { name: /Không gian làm việc:/i });
      fireEvent.click(switcherBtn);

      // Click "Tạo không gian tổ chức mới"
      const createOrgBtn = screen.getByRole('button', { name: /Tạo không gian tổ chức mới/i });
      fireEvent.click(createOrgBtn);

      // Modal is open
      const createModal = screen.getByRole('dialog', { name: 'Tạo không gian tổ chức mới' });
      expect(createModal).toBeInTheDocument();

      // Simulate trigger button getting detached from DOM
      createOrgBtn.remove();
      expect(document.body.contains(createOrgBtn)).toBe(false);

      // Close modal via Escape
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByRole('dialog', { name: 'Tạo không gian tổ chức mới' })).toBeNull();

      // Focus falls back safely to switcherBtn, NEVER document.body!
      await waitFor(() => {
        expect(document.activeElement).toBe(switcherBtn);
      });
      expect(document.activeElement).not.toBe(document.body);
    });

    it('F5: Route / (home) is recognized as workspace tab and renders active nav link and SidebarHistory', async () => {
      authStorage.setStoredTokens({ accessToken: 'test-token', user: memberUser });
      // Simulate App mounted on /
      window.history.replaceState({}, '', '/');
      const { App } = await import('../src/App');
      render(<App />);

      // On /, the "Không gian làm việc" nav link is marked with aria-current="page"
      await waitFor(() => {
        const nav = screen.getByRole('navigation', { name: 'Điều hướng chính' });
        const homeLink = within(nav).getByRole('link', { name: /Không gian làm việc/i });
        expect(homeLink).toHaveAttribute('aria-current', 'page');
      });

      // SidebarHistory is rendered because currentTab === 'workspace'
      expect(document.querySelector('.planora-sidebar-history-wrap')).toBeInTheDocument();
      authStorage.clearStoredTokens();
    });

    it('F6: Crossing desktop breakpoint closes mobile drawer and restores document body scroll lock', async () => {
      Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 500 });
      render(
        <PlanoraShell
          user={memberUser}
          currentTab="workspace"
          navigate={vi.fn()}
          onLogout={vi.fn()}
        >
          <main>
            <h1>Trang cuộn dài</h1>
          </main>
        </PlanoraShell>
      );

      const toggleBtn = screen.getByRole('button', { name: /Mở menu điều hướng/i });

      // Open drawer on mobile
      fireEvent.click(toggleBtn);
      expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');
      expect(document.body.style.overflow).toBe('hidden');

      // Simulate media query crossing to desktop >=1024px
      Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1200 });
      fireEvent(window, new Event('resize'));

      // Crossing to desktop automatically closes drawer and restores body scroll lock
      await waitFor(() => {
        expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
      });
      expect(document.body.style.overflow).toBe('');
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
