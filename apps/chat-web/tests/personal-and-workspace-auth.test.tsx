/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { VerifyEmailView } from '../src/views/VerifyEmailView';
import { AuthGate } from '../src/components/AuthGate';
import { Workspace } from '../src/components/Workspace';
import { MainNav } from '../src/components/layout/MainNav';
import { WorkspaceSwitcher } from '../src/components/layout/WorkspaceSwitcher';
import { UsersPage } from '../src/pages/Users/UsersPage';
import { RequestMoment } from '../src/pages/Cockpit/RequestMoments';
import { SettingsPage } from '../src/pages/Settings/SettingsPage';
import { HistoryPage } from '../src/pages/History/HistoryPage';
import { SchedulesCapabilityContext, useSchedulePendingCount } from '../src/hooks/use-schedules';
import { apiClient } from '../src/services/api-client';
import { authStorage } from '../src/services/auth-storage';
import {
  getActiveWorkspaceId,
  getActiveWorkspaceSummary,
  getCachedOrganizations,
  resetWorkspaceStorage,
  savePendingInviteCode,
  setActiveWorkspaceId,
  setCachedOrganizations,
  subscribeWorkspace,
} from '../src/services/workspace-storage';
import { useChatStore } from '../src/store/chat-store';
import type { User, WorkspaceSummary } from '../src/types';

const testUser: User = {
  id: 'u-personal',
  email: 'personal@example.test',
  name: 'Nguyễn Văn Cá Nhân',
  role: 'member',
  status: 'active',
  emailVerified: true,
  hasPassword: true,
};

const orgAdminUser: User = {
  id: 'u-admin',
  email: 'admin@org.test',
  name: 'Trần Quản Trị',
  role: 'member',
  status: 'active',
  emailVerified: true,
  hasPassword: true,
};

const sampleOrg: WorkspaceSummary = {
  id: 'ws-team-alpha',
  name: 'Đội Alpha',
  role: 'admin',
  status: 'active',
  inviteCode: 'ATI-ALPH-9999',
  requireApproval: true,
  pendingCount: 2,
};

describe('Personal and Workspace Auth (Task 5)', () => {
  beforeEach(() => {
    resetWorkspaceStorage();
    authStorage.clearStoredTokens();
    useChatStore.getState().reset();
    vi.spyOn(apiClient, 'getRuntime').mockResolvedValue({ runtimeMode: 'sandbox' });
    vi.spyOn(apiClient, 'getAuthConfig').mockResolvedValue({ signupEnabled: true, googleEnabled: false });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    resetWorkspaceStorage();
    authStorage.clearStoredTokens();
  });

  describe('1. VerifyEmailView auto-login & workspace reset', () => {
    it('automatically logs in and redirects to "/" in personal workspace on email verification with tokens', async () => {
      const navigate = vi.fn();
      setActiveWorkspaceId('ws-old-workspace');
      vi.spyOn(apiClient, 'verifyEmail').mockResolvedValue({
        message: 'Xác minh email thành công!',
        accessToken: 'access-verified-token',
        refreshToken: 'refresh-verified-token',
        user: testUser,
      });

      render(<VerifyEmailView token="valid-verify-token" navigate={navigate} />);

      await waitFor(() => {
        expect(authStorage.getStoredTokens().accessToken).toBe('access-verified-token');
      });
      expect(authStorage.getStoredTokens().user?.id).toBe(testUser.id);
      expect(getActiveWorkspaceId()).toBe('personal');
      expect(navigate).toHaveBeenCalledWith('/', true);
    });
  });

  describe('2. AuthGate EMAIL_NOT_VERIFIED & resend action', () => {
    it('displays "Bạn cần xác minh địa chỉ email" and enables resend when login returns 403 EMAIL_NOT_VERIFIED', async () => {
      const navigate = vi.fn();
      const loginErr = {
        status: 403,
        data: {
          code: 'EMAIL_NOT_VERIFIED',
          error: 'Bạn chưa xác minh địa chỉ email. Hãy kiểm tra hộp thư hoặc bấm gửi lại.',
        },
      };
      vi.spyOn(apiClient, 'login').mockRejectedValue(loginErr);
      const resendSpy = vi.spyOn(apiClient, 'resendVerification').mockResolvedValue({
        message: 'Đã gửi lại email xác minh thành công.',
      });

      render(
        <AuthGate route={{ kind: 'login' }} navigate={navigate}>
          {() => <div>Logged in</div>}
        </AuthGate>
      );

      fireEvent.change(screen.getByLabelText(/^Email/i), { target: { value: 'unverified@example.test' } });
      fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'Password12345!' } });
      fireEvent.click(screen.getByRole('button', { name: /Đăng nhập/i }));

      expect(await screen.findByText('Bạn cần xác minh địa chỉ email')).toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent(/Bạn chưa xác minh địa chỉ email/i);

      const resendBtn = screen.getByRole('button', { name: /Gửi lại link xác minh mới/i });
      fireEvent.click(resendBtn);

      await waitFor(() => {
        expect(resendSpy).toHaveBeenCalledWith('unverified@example.test');
      });
    });
  });

  describe('3. WorkspaceSwitcher on MainNav & X-Workspace-Id header', () => {
    it('renders Personal Workspace and switches to organization workspace, sending X-Workspace-Id', async () => {
      const navigate = vi.fn();
      setCachedOrganizations([sampleOrg]);
      vi.spyOn(apiClient, 'getWorkspaces').mockResolvedValue({
        personal: { id: 'personal', name: 'Không gian Cá nhân', role: 'admin', status: 'active' },
        organizations: [sampleOrg],
      });

      render(<MainNav user={testUser} current="workspace" navigate={navigate} onLogout={vi.fn()} />);

      // Workspace switcher pill exists
      const switcherBtn = screen.getByRole('button', { name: /Không gian làm việc:/i });
      expect(switcherBtn).toHaveTextContent('Không gian Cá nhân');

      // Click to open switcher dropdown
      fireEvent.click(switcherBtn);

      // Verify dropdown shows Personal Workspace and Organization
      expect(screen.getByText('Đội Alpha')).toBeInTheDocument();

      // Switch to Đội Alpha
      fireEvent.click(screen.getByText('Đội Alpha'));

      expect(getActiveWorkspaceId()).toBe('ws-team-alpha');
      expect(getActiveWorkspaceSummary().name).toBe('Đội Alpha');
    });

    it('creates a new organization from the switcher', async () => {
      const navigate = vi.fn();
      const createdOrg: WorkspaceSummary = {
        id: 'ws-new-team',
        name: 'Đội Mới',
        role: 'admin',
        status: 'active',
        inviteCode: 'ATI-NEWW-1111',
        requireApproval: true,
      };

      vi.spyOn(apiClient, 'createWorkspace').mockResolvedValue({
        workspace: createdOrg,
      });

      render(<WorkspaceSwitcher navigate={navigate} />);
      fireEvent.click(screen.getByRole('button', { name: /Không gian làm việc:/i }));

      const openCreateBtn = screen.getByRole('button', { name: /\+ Tạo không gian tổ chức mới/i });
      fireEvent.click(openCreateBtn);

      const nameInput = screen.getByPlaceholderText(/Nhập tên tổ chức/i);
      fireEvent.change(nameInput, { target: { value: 'Đội Mới' } });
      const submitBtn = screen.getByRole('button', { name: /Xác nhận tạo/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(apiClient.createWorkspace).toHaveBeenCalledWith('Đội Mới', true);
      });
      expect(getActiveWorkspaceId()).toBe('ws-new-team');
    });

    it('joins an organization using invite code from the switcher', async () => {
      const navigate = vi.fn();
      const joinedOrg: WorkspaceSummary = {
        id: 'ws-joined',
        name: 'Tổ Chức Tham Gia',
        role: 'member',
        status: 'active',
        inviteCode: 'ATI-JOIN-2222',
      };

      vi.spyOn(apiClient, 'joinWorkspace').mockResolvedValue({
        workspace: joinedOrg,
        created: true,
      });

      render(<WorkspaceSwitcher navigate={navigate} />);
      fireEvent.click(screen.getByRole('button', { name: /Không gian làm việc:/i }));

      const openJoinBtn = screen.getByRole('button', { name: /🔑 Tham gia tổ chức bằng mã mời/i });
      fireEvent.click(openJoinBtn);

      const codeInput = screen.getByPlaceholderText(/ATI-XXXX-XXXX/i);
      fireEvent.change(codeInput, { target: { value: 'ATI-JOIN-2222' } });
      const submitBtn = screen.getByRole('button', { name: /Tham gia ngay/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(apiClient.joinWorkspace).toHaveBeenCalledWith('ATI-JOIN-2222');
      });
      expect(getActiveWorkspaceId()).toBe('ws-joined');
    });

    it('automatically attaches X-Workspace-Id header in ApiClient.requestRaw', async () => {
      authStorage.setStoredTokens({ accessToken: 'test-token', user: testUser });
      setActiveWorkspaceId('ws-team-alpha');

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      );

      await apiClient.requestRaw('/api/test-endpoint');

      expect(fetchSpy).toHaveBeenCalled();
      const lastCall = fetchSpy.mock.calls[0];
      const headers = lastCall[1]?.headers as Headers;
      expect(headers.get('X-Workspace-Id')).toBe('ws-team-alpha');
    });
  });

  describe('4. Organization Invite Card & actions in UsersPage', () => {
    it('shows invite code card with copy buttons, toggle approval, approve-all and reject in UsersPage', async () => {
      setActiveWorkspaceId('ws-team-alpha');
      setCachedOrganizations([sampleOrg]);

      const pendingMember = {
        id: 'u-candidate',
        name: 'Ứng Viên Alpha',
        email: 'candidate@alpha.test',
        role: 'member' as const,
        status: 'pending' as const,
        emailVerified: true,
        hasPassword: true,
        hasGoogle: false,
        createdAt: '2026-11-01T10:00:00Z',
        openSessions: 0,
      };

      vi.spyOn(apiClient, 'getAdminUsers').mockResolvedValue({
        users: [pendingMember],
        total: 1,
        pendingCount: 1,
        page: 1,
        limit: 20,
        inviteCode: 'ATI-ALPH-9999',
        requireApproval: true,
        workspaceName: 'Đội Alpha',
      });

      const regenSpy = vi.spyOn(apiClient, 'regenerateInviteCode').mockResolvedValue({
        inviteCode: 'ATI-ALPH-8888',
      });
      const settingsSpy = vi.spyOn(apiClient, 'updateWorkspaceSettings').mockResolvedValue({
        requireApproval: false,
      });
      const approveAllSpy = vi.spyOn(apiClient, 'approveAllAdminUsers').mockResolvedValue({
        approvedCount: 1,
        approvedUsers: [pendingMember],
      });
      const rejectSpy = vi.spyOn(apiClient, 'rejectAdminUser').mockResolvedValue({
        rejectedId: 'u-candidate',
      });

      render(<UsersPage user={orgAdminUser} navigate={vi.fn()} onLogout={vi.fn()} />);

      // Invite code card displayed
      expect(await screen.findByText('ATI-ALPH-9999')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Sao chép mã/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Sao chép Link mời/i })).toBeInTheDocument();

      // Regenerate code
      fireEvent.click(screen.getByRole('button', { name: /Đổi mã mới/i }));
      await waitFor(() => {
        expect(regenSpy).toHaveBeenCalledWith('ws-team-alpha');
      });

      // Require approval toggle
      const toggle = screen.getByRole('checkbox', { name: /Cần Quản trị viên duyệt thành viên mới/i });
      expect(toggle).toBeChecked();
      fireEvent.click(toggle);
      await waitFor(() => {
        expect(settingsSpy).toHaveBeenCalledWith('ws-team-alpha', { requireApproval: false });
      });

      // Approve All button
      const approveAllBtn = screen.getByRole('button', { name: /Chấp thuận tất cả/i });
      fireEvent.click(approveAllBtn);
      await waitFor(() => {
        expect(approveAllSpy).toHaveBeenCalled();
      });

      // Reject button on PendingCard
      const rejectBtn = screen.getByRole('button', { name: /Từ chối/i });
      fireEvent.click(rejectBtn);
      await waitFor(() => {
        expect(rejectSpy).toHaveBeenCalledWith('u-candidate');
      });
    });
  });

  describe('5. Context Pill on RequestMoment & SettingsPage', () => {
    it('shows personal context badge in RequestMoment when active workspace is personal', () => {
      setActiveWorkspaceId('personal');
      render(
        <RequestMoment
          services={[]}
          loading={false}
          error={null}
          draft=""
          planning={false}
          input={{ current: null }}
          onDraft={vi.fn()}
          onSend={vi.fn()}
          onKeyDown={vi.fn()}
          onSettings={vi.fn()}
          navigate={vi.fn()}
          servicePrompt={() => ''}
        />
      );

      expect(screen.getByText(/Không gian Cá nhân/i)).toBeInTheDocument();
    });

    it('shows organization context badge in RequestMoment when active workspace is an organization', () => {
      setActiveWorkspaceId('ws-team-alpha');
      setCachedOrganizations([sampleOrg]);

      render(
        <RequestMoment
          services={[]}
          loading={false}
          error={null}
          draft=""
          planning={false}
          input={{ current: null }}
          onDraft={vi.fn()}
          onSend={vi.fn()}
          onKeyDown={vi.fn()}
          onSettings={vi.fn()}
          navigate={vi.fn()}
          servicePrompt={() => ''}
        />
      );

      expect(screen.getByText(/Đội Alpha/i)).toBeInTheDocument();
    });

    it('shows context pill in SettingsPage and updates via subscribeWorkspace', () => {
      let listenerCalled = false;
      const unsubscribe = subscribeWorkspace(() => {
        listenerCalled = true;
      });

      setActiveWorkspaceId('personal');
      expect(listenerCalled).toBe(true);

      const { rerender } = render(<SettingsPage user={testUser} navigate={vi.fn()} onLogout={vi.fn()} />);
      expect(screen.getByText(/Đang cấu hình kết nối cho: Không gian Cá nhân/i)).toBeInTheDocument();

      setActiveWorkspaceId('ws-team-alpha');
      setCachedOrganizations([sampleOrg]);
      rerender(<SettingsPage user={testUser} navigate={vi.fn()} onLogout={vi.fn()} />);
      expect(screen.getByText(/Đang cấu hình kết nối cho: Đội Alpha/i)).toBeInTheDocument();

      unsubscribe();
    });

    it('stores pending invite code via savePendingInviteCode', () => {
      savePendingInviteCode('ATI-TEST-1234');
      expect(window.localStorage.getItem('wap_pending_invite_code')).toBe('ATI-TEST-1234');
    });
  });

  describe('6. Audit Regressions: 403 Workspace Recovery, Logout Storage Reset & Reactive Hooks', () => {
    it('falls back to personal workspace and surfaces Vietnamese message on 403 WORKSPACE_* error', async () => {
      authStorage.setStoredTokens({ accessToken: 'test-token', user: testUser });
      setActiveWorkspaceId('ws-revoked-org');

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: 'WORKSPACE_MEMBER_DISABLED',
            message: 'Tài khoản của bạn trong tổ chức này đã bị vô hiệu hóa.',
          }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        )
      );

      await expect(apiClient.request('/api/conversations')).rejects.toThrow(
        'Tài khoản của bạn trong tổ chức này đã bị vô hiệu hóa.'
      );
      expect(getActiveWorkspaceId()).toBe('personal');
    });

    it('clears active workspace and cached organizations when logging out from AuthGate', async () => {
      const navigate = vi.fn();
      authStorage.setStoredTokens({ accessToken: 'token-123', user: testUser });
      setActiveWorkspaceId('ws-team-alpha');
      setCachedOrganizations([sampleOrg]);
      vi.spyOn(apiClient, 'getMe').mockResolvedValue({ user: testUser });
      vi.spyOn(apiClient, 'logout').mockResolvedValue(undefined as any);

      render(
        <AuthGate route={{ kind: 'home' }} navigate={navigate}>
          {({ onLogout }) => <button onClick={onLogout}>Log Out Now</button>}
        </AuthGate>
      );

      fireEvent.click(screen.getByRole('button', { name: 'Log Out Now' }));

      await waitFor(() => {
        expect(getActiveWorkspaceId()).toBe('personal');
      });
      expect(getCachedOrganizations()).toEqual([]);
    });

    it('[AUDIT-E] scopes activeWorkspaceId by user.id and exits open conversation to "/" when switching workspaces', async () => {
      // User 1 selects ws-team-alpha
      authStorage.setStoredTokens({ accessToken: 'token-1', user: testUser });
      setActiveWorkspaceId('ws-team-alpha');
      expect(getActiveWorkspaceId()).toBe('ws-team-alpha');

      // User 2 logs in on the same browser: their active workspace is still 'personal'
      authStorage.setStoredTokens({ accessToken: 'token-2', user: orgAdminUser });
      expect(getActiveWorkspaceId()).toBe('personal');

      // When viewing an open conversation and switching workspaces, Workspace navigates back to '/'
      vi.spyOn(apiClient, 'getServices').mockResolvedValue({ services: [], canConfigure: true } as any);
      vi.spyOn(apiClient, 'getConversations').mockResolvedValue({ conversations: [], nextCursor: null } as any);
      vi.spyOn(apiClient, 'getConversation').mockResolvedValue({
        conversation: { id: 'conv-open-1', title: 'Đang mở', created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z' },
        messages: [],
      } as any);

      const navigate = vi.fn();
      useChatStore.getState().setConversationId('conv-open-1');
      render(
        <Workspace
          authToken="token-2"
          user={orgAdminUser}
          authError={null}
          onClearAuthError={vi.fn()}
          onLogout={vi.fn()}
          route={{ kind: 'conversation', conversationId: 'conv-open-1' }}
          navigate={navigate}
        />
      );

      setActiveWorkspaceId('ws-team-alpha');

      await waitFor(() => {
        expect(navigate).toHaveBeenCalledWith('/', true);
      });
      expect(useChatStore.getState().conversationId).toBeNull();
    });

    it('refreshes useSchedulePendingCount and HistoryPage when switching workspaces', async () => {
      setActiveWorkspaceId('personal');
      const countSpy = vi
        .spyOn(apiClient, 'getSchedulePendingCount')
        .mockImplementation(async () => ({ count: getActiveWorkspaceId() === 'personal' ? 1 : 7 }));

      const convSpy = vi
        .spyOn(apiClient, 'getConversations')
        .mockImplementation(async () => ({
          conversations:
            getActiveWorkspaceId() === 'personal'
              ? [{ id: 'c-personal', title: 'Chat Cá Nhân', created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z' }]
              : [{ id: 'c-org', title: 'Chat Tổ Chức Alpha', created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z' }],
          nextCursor: null,
        } as any));

      function PendingBadgeProbe() {
        const count = useSchedulePendingCount(testUser);
        return <span data-testid="pending-count">{count}</span>;
      }

      render(
        <SchedulesCapabilityContext.Provider value={true}>
          <PendingBadgeProbe />
          <HistoryPage user={testUser} navigate={vi.fn()} onLogout={vi.fn()} />
        </SchedulesCapabilityContext.Provider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('pending-count')).toHaveTextContent('1');
      });
      expect(await screen.findByText('Chat Cá Nhân')).toBeInTheDocument();

      // Switch workspace to ws-team-alpha
      setActiveWorkspaceId('ws-team-alpha');

      await waitFor(() => {
        expect(screen.getByTestId('pending-count')).toHaveTextContent('7');
      });
      await waitFor(() => {
        expect(convSpy).toHaveBeenCalledTimes(2);
        expect(screen.getByText('Chat Tổ Chức Alpha')).toBeInTheDocument();
      });
      expect(countSpy).toHaveBeenCalled();
    });
  });
});
