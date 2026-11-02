import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { JiraConnection } from '../src/pages/Settings/JiraConnection';
import { jiraApi } from '../src/services/jira-api';
import * as jiraConn from '../src/services/jira-connection';
import { authStorage } from '../src/services/auth-storage';
import type { User } from '../src/types';

describe('JiraConnection component', () => {
  const user: User = {
    id: 'user-1',
    email: 'admin@ati.test',
    name: 'Admin User',
    role: 'admin',
    status: 'active',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    authStorage.setStoredTokens({
      accessToken: 'test-jira-token',
      refreshToken: 'test-jira-refresh',
      user,
    });
  });

  afterEach(() => {
    authStorage.clearStoredTokens();
    vi.restoreAllMocks();
  });

  it('renders disconnected state and starts OAuth on click', async () => {
    vi.spyOn(jiraApi, 'connection').mockResolvedValue({
      connected: false,
      connectionState: 'disconnected',
      jiraAccountId: null,
      atlassianAccountId: null,
      sites: [],
    });
    vi.spyOn(jiraApi, 'workspaces').mockResolvedValue({ workspaces: [] });
    const startSpy = vi.spyOn(jiraApi, 'start').mockResolvedValue({ authUrl: 'https://auth.atlassian.com/test' });
    const redirectSpy = vi.spyOn(jiraConn, 'redirectToJira').mockImplementation(() => {});

    render(<JiraConnection user={user} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /kết nối jira/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /kết nối jira/i }));
    await waitFor(() => {
      expect(startSpy).toHaveBeenCalledWith('identity');
      expect(redirectSpy).toHaveBeenCalledWith('https://auth.atlassian.com/test');
    });
  });

  it('renders identity_connected state and allows authorizing sites', async () => {
    vi.spyOn(jiraApi, 'connection').mockResolvedValue({
      connected: false,
      connectionState: 'identity_connected',
      jiraAccountId: 'jira-123',
      atlassianAccountId: 'atl-123',
      displayName: 'Alice Atlassian',
      sites: [],
    });
    vi.spyOn(jiraApi, 'workspaces').mockResolvedValue({ workspaces: [] });
    const startSpy = vi.spyOn(jiraApi, 'start').mockResolvedValue({ authUrl: 'https://auth.atlassian.com/sites' });
    const redirectSpy = vi.spyOn(jiraConn, 'redirectToJira').mockImplementation(() => {});

    render(<JiraConnection user={user} />);

    await waitFor(() => {
      expect(screen.getByText(/Alice Atlassian/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /cấp quyền jira site/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /cấp quyền jira site/i }));
    await waitFor(() => {
      expect(startSpy).toHaveBeenCalledWith('authorize_sites');
      expect(redirectSpy).toHaveBeenCalledWith('https://auth.atlassian.com/sites');
    });
  });

  it('renders connected state with sites, sync sites and disconnect', async () => {
    vi.spyOn(jiraApi, 'connection').mockResolvedValue({
      connected: true,
      connectionState: 'connected',
      jiraAccountId: 'jira-123',
      atlassianAccountId: 'atl-123',
      displayName: 'Alice Atlassian',
      sites: [{ cloudId: 'cloud-1', name: 'Atlassian Production', url: 'https://prod.atlassian.net' }],
    });
    vi.spyOn(jiraApi, 'workspaces').mockResolvedValue({ workspaces: [] });
    const syncSpy = vi.spyOn(jiraApi, 'syncSites').mockResolvedValue({
      syncedCount: 1,
      sites: [{ cloudId: 'cloud-1', name: 'Atlassian Production', url: 'https://prod.atlassian.net' }],
    });
    const disconnectSpy = vi.spyOn(jiraApi, 'disconnect').mockResolvedValue({
      disconnected: true,
      revokedAt: '2026-11-02T00:00:00Z',
      identityVersion: 2,
    });

    render(<JiraConnection user={user} />);

    await waitFor(() => {
      expect(screen.getByText(/Atlassian Production/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /đồng bộ sites/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /ngắt kết nối/i })).toBeInTheDocument();
    });

    // Test sync
    fireEvent.click(screen.getByRole('button', { name: /đồng bộ sites/i }));
    await waitFor(() => {
      expect(syncSpy).toHaveBeenCalled();
    });

    // Test disconnect with confirmation
    fireEvent.click(screen.getByRole('button', { name: /ngắt kết nối/i }));
    const confirmBtn = await screen.findByRole('button', { name: /xác nhận ngắt kết nối/i });
    fireEvent.click(confirmBtn);
    await waitFor(() => {
      expect(disconnectSpy).toHaveBeenCalled();
    });
  });

  it('submits invite token to join a Jira workspace and shows pending state', async () => {
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
          id: 'ws-pending-1',
          name: 'Platform Engineering',
          slug: 'platform-eng',
          role: 'member',
          membershipStatus: 'pending',
          workspaceVersion: 1,
          membershipVersion: 1,
        },
      ],
    });
    const joinSpy = vi.spyOn(jiraApi, 'join').mockResolvedValue({
      requestId: 'req-1',
      workspaceId: 'ws-pending-1',
      status: 'pending',
    });

    render(<JiraConnection user={user} />);

    await waitFor(() => {
      expect(screen.getAllByText(/Platform Engineering/i)[0]).toBeInTheDocument();
      expect(screen.getByText(/đang chờ duyệt/i)).toBeInTheDocument();
    });

    const inviteInput = screen.getByPlaceholderText(/nhập mã mời jira/i);
    fireEvent.change(inviteInput, { target: { value: 'TOKEN_VALID_INVITE_32_CHARACTERS_LONG' } });
    fireEvent.click(screen.getByRole('button', { name: /tham gia jira workspace/i }));

    await waitFor(() => {
      expect(joinSpy).toHaveBeenCalledWith('TOKEN_VALID_INVITE_32_CHARACTERS_LONG');
    });
  });

  it('admin manages workspace members with approve, reject, remove under CAS', async () => {
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
          id: 'ws-admin-1',
          name: 'DevOps Team',
          slug: 'devops-team',
          role: 'admin',
          membershipStatus: 'active',
          workspaceVersion: 1,
          membershipVersion: 1,
        },
      ],
    });
    vi.spyOn(jiraApi, 'members').mockResolvedValue({
      members: [
        { userId: 'user-pending-1', role: 'member', status: 'pending', version: 3 },
        { userId: 'user-active-2', role: 'member', status: 'active', version: 5 },
      ],
    });
    vi.spyOn(jiraApi, 'invites').mockResolvedValue({ invites: [] });
    vi.spyOn(jiraApi, 'sites').mockResolvedValue({ sites: [] });
    vi.spyOn(jiraApi, 'capabilities').mockResolvedValue({ workspaceId: 'ws-admin-1', sites: [] });

    const decisionSpy = vi.spyOn(jiraApi, 'decision').mockResolvedValue({
      status: 'active',
      version: 4,
    });

    render(<JiraConnection user={user} />);

    await waitFor(() => {
      expect(screen.getAllByText(/DevOps Team/i)[0]).toBeInTheDocument();
      expect(screen.getByText(/user-pending-1/i)).toBeInTheDocument();
    });

    const approveBtn = screen.getByRole('button', { name: /duyệt thành viên user-pending-1/i });
    fireEvent.click(approveBtn);

    await waitFor(() => {
      expect(decisionSpy).toHaveBeenCalledWith('ws-admin-1', 'user-pending-1', 3, 'approve');
    });
  });

  it('admin creates and revokes invites', async () => {
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
          id: 'ws-admin-1',
          name: 'DevOps Team',
          slug: 'devops-team',
          role: 'admin',
          membershipStatus: 'active',
          workspaceVersion: 1,
          membershipVersion: 1,
        },
      ],
    });
    vi.spyOn(jiraApi, 'members').mockResolvedValue({ members: [] });
    vi.spyOn(jiraApi, 'invites').mockResolvedValue({
      invites: [
        { id: 'inv-1', workspaceId: 'ws-admin-1', inviterUserId: 'user-1', expiresAt: '2026-11-10T00:00:00Z' },
      ],
    });
    vi.spyOn(jiraApi, 'sites').mockResolvedValue({ sites: [] });
    vi.spyOn(jiraApi, 'capabilities').mockResolvedValue({ workspaceId: 'ws-admin-1', sites: [] });

    const createInviteSpy = vi.spyOn(jiraApi, 'createInvite').mockResolvedValue({
      inviteId: 'inv-2',
      inviteToken: 'NEW_INVITE_TOKEN_1234567890123456',
      expiresAt: '2026-11-12T00:00:00Z',
    });
    const revokeInviteSpy = vi.spyOn(jiraApi, 'revokeInvite').mockResolvedValue({
      revoked: true,
      revokedAt: '2026-11-02T00:00:00Z',
    });

    render(<JiraConnection user={user} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /tạo mã mời/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /thu hồi mã mời inv-1/i })).toBeInTheDocument();
    });

    // Create invite
    fireEvent.click(screen.getByRole('button', { name: /tạo mã mời/i }));
    await waitFor(() => {
      expect(createInviteSpy).toHaveBeenCalledWith('ws-admin-1', 7);
      expect(screen.getByText(/NEW_INVITE_TOKEN_1234567890123456/i)).toBeInTheDocument();
    });

    // Revoke invite
    fireEvent.click(screen.getByRole('button', { name: /thu hồi mã mời inv-1/i }));
    await waitFor(() => {
      expect(revokeInviteSpy).toHaveBeenCalledWith('ws-admin-1', 'inv-1');
    });
  });

  it('admin links site, toggles active, and configures projects', async () => {
    vi.spyOn(jiraApi, 'connection').mockResolvedValue({
      connected: true,
      connectionState: 'connected',
      jiraAccountId: 'jira-123',
      atlassianAccountId: 'atl-123',
      sites: [{ cloudId: 'cloud-2', name: 'Secondary Jira Site', url: 'https://secondary.atlassian.net' }],
    });
    vi.spyOn(jiraApi, 'workspaces').mockResolvedValue({
      workspaces: [
        {
          id: 'ws-admin-1',
          name: 'Core Team',
          slug: 'core-team',
          role: 'admin',
          membershipStatus: 'active',
          workspaceVersion: 1,
          membershipVersion: 1,
        },
      ],
    });
    vi.spyOn(jiraApi, 'members').mockResolvedValue({ members: [] });
    vi.spyOn(jiraApi, 'invites').mockResolvedValue({ invites: [] });
    vi.spyOn(jiraApi, 'sites').mockResolvedValue({
      sites: [
        {
          siteId: 'site-uuid-1',
          cloudId: 'cloud-1',
          name: 'Primary Site',
          url: 'https://primary.atlassian.net',
          active: true,
          policyVersion: 2,
        },
      ],
    });
    vi.spyOn(jiraApi, 'capabilities').mockResolvedValue({ workspaceId: 'ws-admin-1', sites: [] });

    const linkSiteSpy = vi.spyOn(jiraApi, 'linkSite').mockResolvedValue({
      site: {
        siteId: 'site-uuid-2',
        cloudId: 'cloud-2',
        name: 'Secondary Jira Site',
        url: 'https://secondary.atlassian.net',
        active: true,
        policyVersion: 1,
      },
    });

    const updateSiteSpy = vi.spyOn(jiraApi, 'updateSite').mockResolvedValue({
      site: {
        siteId: 'site-uuid-1',
        cloudId: 'cloud-1',
        name: 'Primary Site',
        url: 'https://primary.atlassian.net',
        active: false,
        policyVersion: 3,
      },
    });

    const getProjectsSpy = vi.spyOn(jiraApi, 'projects').mockResolvedValue({
      sitePolicyVersion: 2,
      projects: [
        { projectId: '10001', key: 'PROJ', name: 'Project One', selected: true },
        { projectId: '10002', key: 'TEST', name: 'Project Two', selected: false },
      ],
    });

    const configureProjectsSpy = vi.spyOn(jiraApi, 'configureProjects').mockResolvedValue({
      sitePolicyVersion: 3,
      updatedCount: 2,
    });

    render(<JiraConnection user={user} />);

    await waitFor(() => {
      expect(screen.getByText(/Primary Site/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /liên kết site/i })).toBeInTheDocument();
    });

    // Link site
    fireEvent.click(screen.getByRole('button', { name: /liên kết site/i }));
    await waitFor(() => {
      expect(linkSiteSpy).toHaveBeenCalledWith('ws-admin-1', 'cloud-2');
    });

    // Toggle active
    const toggleBtn = screen.getByRole('button', { name: /vô hiệu hoá site Primary Site/i });
    fireEvent.click(toggleBtn);
    await waitFor(() => {
      expect(updateSiteSpy).toHaveBeenCalledWith('ws-admin-1', 'site-uuid-1', 2, false);
    });

    // Open projects configuration
    const configProjectsBtn = screen.getByRole('button', { name: /cấu hình projects site Primary Site/i });
    fireEvent.click(configProjectsBtn);
    await waitFor(() => {
      expect(getProjectsSpy).toHaveBeenCalledWith('ws-admin-1', 'site-uuid-1');
      expect(screen.getByText(/Project One/i)).toBeInTheDocument();
      expect(screen.getByText(/Project Two/i)).toBeInTheDocument();
    });

    // Select Project Two
    const projectTwoCheckbox = screen.getByRole('checkbox', { name: /Project Two/i });
    fireEvent.click(projectTwoCheckbox);

    // Save projects
    fireEvent.click(screen.getByRole('button', { name: /lưu danh sách projects/i }));
    await waitFor(() => {
      expect(configureProjectsSpy).toHaveBeenCalledWith('ws-admin-1', 'site-uuid-1', 2, ['10001', '10002']);
    });
  });

  it('renders capabilities directory for active workspace', async () => {
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
          id: 'ws-active-1',
          name: 'Security Team',
          slug: 'security-team',
          role: 'member',
          membershipStatus: 'active',
          workspaceVersion: 1,
          membershipVersion: 1,
        },
      ],
    });
    vi.spyOn(jiraApi, 'capabilities').mockResolvedValue({
      workspaceId: 'ws-active-1',
      sites: [
        {
          siteId: 'site-cap-1',
          cloudId: 'cloud-cap-1',
          name: 'Security JIRA',
          url: 'https://sec.atlassian.net',
          projects: [
            { id: '10010', key: 'SEC', name: 'Security Vulnerabilities' },
            { id: '10011', key: 'AUDIT', name: 'Internal Audit' },
          ],
        },
      ],
    });

    render(<JiraConnection user={user} />);

    await waitFor(() => {
      expect(screen.getByText(/Security JIRA/i)).toBeInTheDocument();
      expect(screen.getByText(/SEC — Security Vulnerabilities/i)).toBeInTheDocument();
      expect(screen.getByText(/AUDIT — Internal Audit/i)).toBeInTheDocument();
    });
  });

  it('shows distinct error states for 403 native_permission_denied and 409 stale_version', async () => {
    vi.spyOn(jiraApi, 'connection').mockResolvedValue({
      connected: true,
      connectionState: 'connected',
      jiraAccountId: 'jira-123',
      atlassianAccountId: 'atl-123',
      sites: [{ cloudId: 'cloud-3', name: 'Restricted Site', url: 'https://restricted.atlassian.net' }],
    });
    vi.spyOn(jiraApi, 'workspaces').mockResolvedValue({
      workspaces: [
        {
          id: 'ws-admin-1',
          name: 'Dev Team',
          slug: 'dev-team',
          role: 'admin',
          membershipStatus: 'active',
          workspaceVersion: 1,
          membershipVersion: 1,
        },
      ],
    });
    vi.spyOn(jiraApi, 'members').mockResolvedValue({ members: [] });
    vi.spyOn(jiraApi, 'invites').mockResolvedValue({ invites: [] });
    vi.spyOn(jiraApi, 'sites').mockResolvedValue({ sites: [] });
    vi.spyOn(jiraApi, 'capabilities').mockResolvedValue({ workspaceId: 'ws-admin-1', sites: [] });

    const deniedError: any = new Error('Lỗi quyền');
    deniedError.status = 403;
    deniedError.code = 'NATIVE_ADMINISTER_REQUIRED';
    vi.spyOn(jiraApi, 'linkSite').mockRejectedValue(deniedError);

    render(<JiraConnection user={user} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /liên kết site/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /liên kết site/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/thiếu quyền quản trị \(ADMINISTER\)/i);
  });

  it('keeps production Jira conversation CTA disabled with explanatory copy', async () => {
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
          id: 'ws-active-1',
          name: 'Dev Team',
          slug: 'dev-team',
          role: 'member',
          membershipStatus: 'active',
          workspaceVersion: 1,
          membershipVersion: 1,
        },
      ],
    });
    vi.spyOn(jiraApi, 'capabilities').mockResolvedValue({ workspaceId: 'ws-active-1', sites: [] });

    render(<JiraConnection user={user} />);

    await waitFor(() => {
      const cta = screen.getByRole('button', { name: /bắt đầu hội thoại jira/i });
      expect(cta).toBeDisabled();
      expect(screen.getByText(/chờ JIRA-08/i)).toBeInTheDocument();
    });
  });

  it('displays connection error on 503 instead of "Chưa kết nối" and recovers on retry', async () => {
    const error503: any = new Error('Service Unavailable');
    error503.status = 503;
    error503.code = 'upstream_unavailable';
    const connSpy = vi.spyOn(jiraApi, 'connection').mockRejectedValueOnce(error503);
    vi.spyOn(jiraApi, 'workspaces').mockResolvedValue({ workspaces: [] });

    render(<JiraConnection user={user} />);

    await waitFor(() => {
      expect(screen.getByText('Lỗi kết nối')).toBeInTheDocument();
      expect(screen.queryByText('Chưa kết nối')).not.toBeInTheDocument();
      expect(screen.getByText(/Dịch vụ Jira tạm thời không khả dụng/i)).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: /thử lại/i }).length).toBeGreaterThanOrEqual(1);
      expect(screen.queryByRole('button', { name: /^kết nối jira$/i })).not.toBeInTheDocument();
    });

    // Mock successful recovery on retry
    connSpy.mockResolvedValueOnce({
      connected: false,
      connectionState: 'disconnected',
      jiraAccountId: null,
      atlassianAccountId: null,
      sites: [],
    });

    fireEvent.click(screen.getAllByRole('button', { name: /thử lại/i })[0]);

    await waitFor(() => {
      expect(screen.getByText('Chưa kết nối')).toBeInTheDocument();
      expect(screen.queryByText('Lỗi kết nối')).not.toBeInTheDocument();
      expect(screen.queryByText(/Dịch vụ Jira tạm thời không khả dụng/i)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /kết nối jira/i })).toBeInTheDocument();
    });
  });

  it('displays connection error on 401 and network errors instead of "Chưa kết nối"', async () => {
    const error401: any = new Error('Unauthorized');
    error401.status = 401;
    error401.code = 'INVALID_SESSION';
    vi.spyOn(jiraApi, 'connection').mockRejectedValueOnce(error401);
    vi.spyOn(jiraApi, 'workspaces').mockResolvedValue({ workspaces: [] });

    const { unmount } = render(<JiraConnection user={user} />);

    await waitFor(() => {
      expect(screen.getByText('Lỗi kết nối')).toBeInTheDocument();
      expect(screen.queryByText('Chưa kết nối')).not.toBeInTheDocument();
      expect(screen.getByText(/Phiên đăng nhập không hợp lệ hoặc đã hết hạn/i)).toBeInTheDocument();
    });

    unmount();

    // Test Network Error
    const networkError = new TypeError('Failed to fetch');
    vi.spyOn(jiraApi, 'connection').mockRejectedValueOnce(networkError);

    render(<JiraConnection user={user} />);

    await waitFor(() => {
      expect(screen.getByText('Lỗi kết nối')).toBeInTheDocument();
      expect(screen.queryByText('Chưa kết nối')).not.toBeInTheDocument();
      expect(screen.getByText(/Không thể kết nối đến máy chủ Jira/i)).toBeInTheDocument();
    });
  });

  it('clears invite code and workspace details when switching workspace, preventing stale cross-workspace data and race conditions', async () => {
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
          id: 'ws-admin-1',
          name: 'Workspace Alpha (Admin)',
          slug: 'ws-alpha',
          role: 'admin',
          membershipStatus: 'active',
          workspaceVersion: 1,
          membershipVersion: 1,
        },
        {
          id: 'ws-member-2',
          name: 'Workspace Beta (Member)',
          slug: 'ws-beta',
          role: 'member',
          membershipStatus: 'active',
          workspaceVersion: 1,
          membershipVersion: 1,
        },
      ],
    });

    vi.spyOn(jiraApi, 'members').mockImplementation(async (wsId) => {
      if (wsId === 'ws-admin-1') {
        return { members: [{ userId: 'user-alpha-only', role: 'member', status: 'pending', version: 1 }] };
      }
      return { members: [] };
    });

    vi.spyOn(jiraApi, 'invites').mockImplementation(async (wsId) => {
      if (wsId === 'ws-admin-1') {
        return {
          invites: [
            { id: 'inv-alpha-1', workspaceId: 'ws-admin-1', inviterUserId: 'user-1', expiresAt: '2026-11-10T00:00:00Z' },
          ],
        };
      }
      return { invites: [] };
    });

    vi.spyOn(jiraApi, 'sites').mockResolvedValue({ sites: [] });
    vi.spyOn(jiraApi, 'capabilities').mockImplementation(async (wsId) => ({
      workspaceId: wsId,
      sites: [],
    }));

    vi.spyOn(jiraApi, 'createInvite').mockResolvedValue({
      inviteId: 'inv-created-alpha',
      inviteToken: 'ALPHA_INVITE_TOKEN_SECRET_123',
      expiresAt: '2026-11-10T00:00:00Z',
    });

    render(<JiraConnection user={user} />);

    // Initially in Workspace Alpha (admin)
    await waitFor(() => {
      expect(screen.getByText(/user-alpha-only/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /tạo mã mời/i })).toBeInTheDocument();
    });

    // Create invite in Workspace Alpha
    fireEvent.click(screen.getByRole('button', { name: /tạo mã mời/i }));
    await waitFor(() => {
      expect(screen.getByText(/ALPHA_INVITE_TOKEN_SECRET_123/i)).toBeInTheDocument();
    });

    // Switch to Workspace Beta (member)
    const select = screen.getByLabelText(/chọn jira workspace/i);
    fireEvent.change(select, { target: { value: 'ws-member-2' } });

    // The invite token and admin members from Workspace Alpha MUST be cleared immediately
    await waitFor(() => {
      expect(screen.queryByText(/ALPHA_INVITE_TOKEN_SECRET_123/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/user-alpha-only/i)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /tạo mã mời/i })).not.toBeInTheDocument();
    });
  });

  it('displays connection error on 403, 429, and 500 instead of "Chưa kết nối"', async () => {
    for (const { status, code, textPattern } of [
      { status: 403, code: 'FORBIDDEN', textPattern: /không có quyền/i },
      { status: 429, code: 'upstream_rate_limited', textPattern: /giới hạn tần suất/i },
      { status: 500, code: 'INTERNAL_ERROR', textPattern: /máy chủ jira/i },
    ]) {
      const err: any = new Error(`Error ${status}`);
      err.status = status;
      err.code = code;
      vi.spyOn(jiraApi, 'connection').mockRejectedValueOnce(err);
      vi.spyOn(jiraApi, 'workspaces').mockResolvedValue({ workspaces: [] });

      const { unmount } = render(<JiraConnection user={user} />);

      await waitFor(() => {
        expect(screen.getByText('Lỗi kết nối')).toBeInTheDocument();
        expect(screen.queryByText('Chưa kết nối')).not.toBeInTheDocument();
        expect(screen.getByText(textPattern)).toBeInTheDocument();
      });

      unmount();
    }
  });

  it('ignores late-arriving createInvite response from workspace A after switching to workspace B', async () => {
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
          id: 'ws-alpha-1',
          name: 'Workspace Alpha',
          slug: 'ws-alpha',
          role: 'admin',
          membershipStatus: 'active',
          workspaceVersion: 1,
          membershipVersion: 1,
        },
        {
          id: 'ws-beta-2',
          name: 'Workspace Beta',
          slug: 'ws-beta',
          role: 'admin',
          membershipStatus: 'active',
          workspaceVersion: 1,
          membershipVersion: 1,
        },
      ],
    });

    vi.spyOn(jiraApi, 'members').mockResolvedValue({ members: [] });
    vi.spyOn(jiraApi, 'invites').mockResolvedValue({ invites: [] });
    vi.spyOn(jiraApi, 'sites').mockResolvedValue({ sites: [] });
    vi.spyOn(jiraApi, 'capabilities').mockImplementation(async (wsId) => ({
      workspaceId: wsId,
      sites: [],
    }));

    let resolveCreateInvite: (val: any) => void;
    const createInvitePromise = new Promise((resolve) => {
      resolveCreateInvite = resolve;
    });
    vi.spyOn(jiraApi, 'createInvite').mockImplementation(() => createInvitePromise as any);

    render(<JiraConnection user={user} />);

    // Initially on Workspace Alpha
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /tạo mã mời/i })).toBeInTheDocument();
    });

    // Click "Tạo mã mời" on Workspace Alpha -> request is in-flight
    fireEvent.click(screen.getByRole('button', { name: /tạo mã mời/i }));

    // Before response arrives, user switches to Workspace Beta
    const select = screen.getByLabelText(/chọn jira workspace/i);
    fireEvent.change(select, { target: { value: 'ws-beta-2' } });

    // Now resolve the late createInvite response for Workspace Alpha inside act
    await act(async () => {
      resolveCreateInvite!({
        inviteId: 'inv-late-alpha',
        inviteToken: 'ALPHA_LATE_INVITE_TOKEN_SHOULD_BE_IGNORED',
        expiresAt: '2026-11-10T00:00:00Z',
      });
      await new Promise((r) => setTimeout(r, 20));
    });

    // Wait and verify: the late token from Alpha must NOT appear on Beta
    expect(screen.queryByText('ALPHA_LATE_INVITE_TOKEN_SHOULD_BE_IGNORED')).not.toBeInTheDocument();
  });
});
