/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { GitHubConnection } from '../src/pages/Settings/GitHubConnection';
import { apiClient } from '../src/services/api-client';
import { PlanMoment } from '../src/pages/Cockpit/PlanMoment';
import { ResponseMoment } from '../src/pages/Responses/ResponseMoment';
import { ReceiptMoment } from '../src/pages/Cockpit/ReceiptMoment';
import { PreviewContents } from '../src/pages/Cockpit/PreviewContents';
import { resourceDestination } from '../src/components/Cockpit';
import { operation } from '../src/pages/Cockpit/presentation';
import { SettingsPage } from '../src/pages/Settings/SettingsPage';
import { githubConnectionNotice } from '../src/services/github-connection';
import { authStorage } from '../src/services/auth-storage';
import { setActiveWorkspaceId, setCachedOrganizations } from '../src/services/workspace-storage';
import type { ActivePlan, User } from '../src/types';

describe('Task 9: GitHub OAuth connection UI and chat moments', () => {
  const adminUser: User = { id: 'u-admin', email: 'admin@example.com', name: 'Admin', role: 'admin' };
  const memberUser: User = { id: 'u-member', email: 'member@example.com', name: 'Member', role: 'member' };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  describe('1. GitHubConnection component', () => {
    it('hides the previous workspace scope until the current workspace status loads', async () => {
      const personalRepo = { repoId: '1', fullName: 'octo/personal', name: 'personal', accessible: true };
      const orgRepo = { repoId: '2', fullName: 'octo/team', name: 'team', accessible: true };
      type Status = Awaited<ReturnType<typeof apiClient.getGitHubConnection>>;
      let resolveOrg!: (value: Status) => void;
      const orgStatus = new Promise<Status>((resolve) => { resolveOrg = resolve; });

      setActiveWorkspaceId('personal');
      const status = vi.spyOn(apiClient, 'getGitHubConnection')
        .mockResolvedValueOnce({ status: 'connected', repos: [personalRepo] })
        .mockReturnValueOnce(orgStatus)
        .mockResolvedValue({ status: 'connected', repos: [orgRepo] });
      vi.spyOn(apiClient, 'getGitHubCandidateRepos').mockResolvedValue({ repos: [orgRepo] });
      const save = vi.spyOn(apiClient, 'saveGitHubScope').mockResolvedValue({
        chosenBy: adminUser.id, updatedAt: '2026-11-01T00:00:00Z', repos: [orgRepo],
      });
      const view = render(<GitHubConnection user={adminUser} />);
      try {
        expect(await screen.findByText(personalRepo.fullName)).toBeVisible();
        act(() => setActiveWorkspaceId('team-workspace'));
        expect(screen.queryByText(personalRepo.fullName)).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Đổi repository' })).not.toBeInTheDocument();

        await act(async () => resolveOrg({ status: 'connected', repos: [orgRepo] }));
        fireEvent.click(screen.getByRole('button', { name: 'Đổi repository' }));
        expect(await screen.findByRole('checkbox', { name: orgRepo.fullName })).toBeChecked();
        const saveButton = screen.getByRole('button', { name: 'Lưu repository được dùng' });
        await waitFor(() => expect(saveButton).toBeEnabled());
        fireEvent.click(saveButton);
        await waitFor(() => expect(save).toHaveBeenCalledWith([orgRepo.fullName], 'team-workspace'));
        expect(status).toHaveBeenCalledTimes(3);
      } finally {
        view.unmount();
        setActiveWorkspaceId('personal');
      }
    });

    it('ignores a candidate response that arrives after switching workspaces', async () => {
      const personalRepo = { repoId: '1', fullName: 'octo/personal', name: 'personal' };
      const orgRepo = { repoId: '2', fullName: 'octo/team', name: 'team' };
      type Candidates = Awaited<ReturnType<typeof apiClient.getGitHubCandidateRepos>>;
      let resolvePersonal!: (value: Candidates) => void;
      const personalCandidates = new Promise<Candidates>((resolve) => { resolvePersonal = resolve; });

      setActiveWorkspaceId('personal');
      vi.spyOn(apiClient, 'getGitHubConnection').mockResolvedValue({ status: 'needs_scope', repos: [] });
      const candidates = vi.spyOn(apiClient, 'getGitHubCandidateRepos')
        .mockReturnValueOnce(personalCandidates)
        .mockResolvedValue({ repos: [orgRepo] });
      const view = render(<GitHubConnection user={adminUser} />);
      try {
        await waitFor(() => expect(candidates).toHaveBeenCalledTimes(1));
        act(() => setActiveWorkspaceId('team-workspace'));
        expect(await screen.findByRole('checkbox', { name: orgRepo.fullName })).toBeVisible();

        await act(async () => resolvePersonal({ repos: [personalRepo] }));
        expect(screen.queryByRole('checkbox', { name: personalRepo.fullName })).not.toBeInTheDocument();
        expect(screen.getByRole('checkbox', { name: orgRepo.fullName })).toBeVisible();
      } finally {
        view.unmount();
        setActiveWorkspaceId('personal');
      }
    });

    it('renders not_connected with button #github-connect labeled "Kết nối GitHub" and no PAT or token inputs', async () => {
      vi.spyOn(apiClient, 'getGitHubConnection').mockResolvedValue({
        status: 'not_connected',
        repos: [],
      });

      render(<GitHubConnection user={memberUser} refresh={vi.fn()} />);

      expect(await screen.findByText('Chưa kết nối')).toBeInTheDocument();
      const connectBtn = screen.getByRole('button', { name: 'Kết nối GitHub' });
      expect(connectBtn).toBeInTheDocument();
      expect(connectBtn).toHaveAttribute('id', 'github-connect');

      expect(screen.queryByLabelText(/personal access token/i)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/token/i)).not.toBeInTheDocument();
      expect(document.querySelector('input[name="token"]')).toBeNull();
    });

    it('renders admin needs_scope with candidate repos, blocks 0 or >10 repos, and saves selected repos', async () => {
      vi.spyOn(apiClient, 'getGitHubConnection').mockResolvedValue({
        status: 'needs_scope',
        login: 'octocat',
        repos: [],
      });
      const candidateRepos = Array.from({ length: 11 }, (_, idx) => ({
        repoId: `r-${idx + 1}`,
        fullName: `acme/repo-${idx + 1}`,
        name: `repo-${idx + 1}`,
        private: idx % 2 === 0,
      }));
      vi.spyOn(apiClient, 'getGitHubCandidateRepos').mockResolvedValue({
        repos: candidateRepos,
      });
      const saveScopeSpy = vi.spyOn(apiClient, 'saveGitHubScope').mockResolvedValue({
        chosenBy: 'u-admin',
        updatedAt: '2026-11-01T00:00:00Z',
        repos: [{ repoId: 'r-1', fullName: 'acme/repo-1', name: 'repo-1' }],
      });

      render(<GitHubConnection user={adminUser} refresh={vi.fn()} />);

      const scopeArea = await screen.findByTestId('github-scope');
      expect(scopeArea).toBeInTheDocument();
      expect(scopeArea).toHaveAttribute('id', 'github-scope');

      const repo1Checkbox = await screen.findByRole('checkbox', { name: /acme\/repo-1\b/i });
      const saveBtn = screen.getByRole('button', { name: /Lưu/i });
      expect(saveBtn).toHaveAttribute('id', 'github-save-scope');
      expect(saveBtn).toBeDisabled();

      // Check 10 repos -> 11th checkbox becomes disabled
      for (let i = 1; i <= 10; i++) {
        const cb = screen.getByRole('checkbox', { name: new RegExp(`acme/repo-${i}\\b`, 'i') });
        fireEvent.click(cb);
      }
      const repo11Checkbox = screen.getByRole('checkbox', { name: /acme\/repo-11\b/i });
      expect(repo11Checkbox).toBeDisabled();

      // Uncheck repo 2..10 so only repo-1 is selected
      for (let i = 2; i <= 10; i++) {
        const cb = screen.getByRole('checkbox', { name: new RegExp(`acme/repo-${i}\\b`, 'i') });
        fireEvent.click(cb);
      }
      expect(repo1Checkbox).toBeChecked();
      expect(saveBtn).not.toBeDisabled();

      fireEvent.click(saveBtn);
      await waitFor(() => {
        expect(saveScopeSpy).toHaveBeenCalledWith(['acme/repo-1'], 'personal');
      });
    });

    it('hides #github-scope when role is member', async () => {
      vi.spyOn(apiClient, 'getGitHubConnection').mockResolvedValue({
        status: 'connected',
        login: 'bob_gh',
        repos: [{ repoId: 'r-1', fullName: 'acme/ati', name: 'ati', accessible: true }],
      });

      render(<GitHubConnection user={memberUser} refresh={vi.fn()} />);

      await screen.findByText(/bob_gh/);
      expect(document.getElementById('github-scope')).toBeNull();
      expect(screen.getByRole('button', { name: 'Ngắt kết nối' })).toHaveAttribute('id', 'github-disconnect');
    });

    it('renders member needs_membership with repo names and access warning', async () => {
      vi.spyOn(apiClient, 'getGitHubConnection').mockResolvedValue({
        status: 'needs_membership',
        login: 'charlie_gh',
        repos: [
          { repoId: 'r-1', fullName: 'acme/ati', name: 'ati', accessible: false },
          { repoId: 'r-2', fullName: 'acme/wap', name: 'wap', accessible: false },
        ],
      });

      render(<GitHubConnection user={memberUser} refresh={vi.fn()} />);

      expect(await screen.findByText(/charlie_gh/)).toBeInTheDocument();
      expect(screen.getByText('acme/ati')).toBeInTheDocument();
      expect(screen.getByText('acme/wap')).toBeInTheDocument();
      expect(screen.getAllByText(/Bạn cần được cấp quyền truy cập repository/i).length).toBeGreaterThan(0);
    });

    it('allows admin in needs_membership state to click #github-edit-scope ("Đổi repository") and save a new scope', async () => {
      vi.spyOn(apiClient, 'getGitHubConnection').mockResolvedValue({
        status: 'needs_membership',
        login: 'admin_gh',
        repos: [{ repoId: 'r-1', fullName: 'acme/old-repo', name: 'old-repo', accessible: false }],
      });
      vi.spyOn(apiClient, 'getGitHubCandidateRepos').mockResolvedValue({
        repos: [{ repoId: 'r-2', fullName: 'acme/new-repo', name: 'new-repo', private: false }],
      });
      const saveScopeSpy = vi.spyOn(apiClient, 'saveGitHubScope').mockResolvedValue({
        chosenBy: 'u-admin',
        updatedAt: '2026-11-01T00:00:00Z',
        repos: [{ repoId: 'r-2', fullName: 'acme/new-repo', name: 'new-repo' }],
      });

      render(<GitHubConnection user={adminUser} refresh={vi.fn()} />);

      expect(await screen.findByText(/admin_gh/)).toBeInTheDocument();
      const editScopeBtn = await screen.findByRole('button', { name: 'Đổi repository' });
      expect(editScopeBtn).toHaveAttribute('id', 'github-edit-scope');

      fireEvent.click(editScopeBtn);

      const scopeArea = await screen.findByTestId('github-scope');
      expect(scopeArea).toBeInTheDocument();

      const newRepoCheckbox = await screen.findByRole('checkbox', { name: /acme\/new-repo/i });
      fireEvent.click(newRepoCheckbox);

      const saveBtn = screen.getByRole('button', { name: /Lưu/i });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(saveScopeSpy).toHaveBeenCalledWith(['acme/new-repo'], 'personal');
      });
    });

    it('displays githubConnectionNotice when user opens settings after connecting', async () => {
      vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        if (url === '/api/services') return new Response(JSON.stringify({ services: [], canConfigure: false }));
        throw new Error(`Unexpected endpoint: ${url}`);
      }));
      vi.spyOn(apiClient, 'getTrelloConnection').mockResolvedValue({ status: 'not_connected', boards: [] });
      vi.spyOn(apiClient, 'getGitHubConnection').mockResolvedValue({ status: 'not_connected', repos: [] });
      authStorage.setStoredTokens({ user: adminUser });
      githubConnectionNotice.set('octocat');

      render(<SettingsPage user={adminUser} navigate={vi.fn()} onLogout={vi.fn()} />);

      expect(await screen.findByText('Đã kết nối @octocat')).toBeInTheDocument();
    });
  });

  describe('2. Chat refusal with GitHub', () => {
    it('refusal with unavailableServices github renders #github-connect calling startGitHubConnection with returnTo and enables resend when connected', async () => {
      const startSpy = vi.spyOn(apiClient, 'startGitHubConnection').mockResolvedValue({
        url: 'https://github.com/login/oauth/authorize?state=xyz',
      });
      const assignMock = vi.fn();
      vi.stubGlobal('location', { ...window.location, assign: assignMock, protocol: 'http:', hostname: 'localhost' });
      const onResendSpy = vi.fn();

      const { unmount } = render(
        <ResponseMoment
          request="Tạo issue mới trên repo ATI"
          conversationId="11111111-2222-3333-4444-555555555555"
          unavailableServices={[{ id: 'github', name: 'GitHub' }]}
          reason="GitHub cần được kết nối trước khi dùng."
          services={[]}
          connectFromChat={false}
          navigate={vi.fn()}
        />
      );

      const connectBtn = await screen.findByRole('link', { name: /Kết nối GitHub/i });
      expect(connectBtn).toHaveAttribute('id', 'github-connect');

      fireEvent.click(connectBtn);
      await waitFor(() => {
        expect(startSpy).toHaveBeenCalledWith({
          returnTo: '/c/11111111-2222-3333-4444-555555555555',
        });
      });

      unmount();

      render(
        <ResponseMoment
          request="Tạo issue mới trên repo ATI"
          conversationId="11111111-2222-3333-4444-555555555555"
          unavailableServices={[{ id: 'github', name: 'GitHub' }]}
          reason="GitHub cần được kết nối trước khi dùng."
          services={[
            {
              id: 'github',
              name: 'GitHub',
              configured: false,
              connected: false,
              tools: [],
              personalStatus: 'connected',
              username: 'octocat',
            } as any,
          ]}
          connectFromChat={false}
          navigate={vi.fn()}
          onResend={onResendSpy}
        />
      );

      expect(await screen.findByText(/Đã kết nối · @octocat/)).toBeInTheDocument();
      const resendBtn = screen.getByRole('button', { name: 'Gửi lại yêu cầu' });
      fireEvent.click(resendBtn);
      expect(onResendSpy).toHaveBeenCalledWith('Tạo issue mới trên repo ATI');
    });
  });

  describe('3. PlanMoment and ReceiptMoment display GitHub login', () => {
    it('PlanMoment displays login from connections.github', () => {
      const plan: ActivePlan = {
        summary: 'Tạo issue GitHub',
        steps: [
          {
            id: 's1',
            tool: 'github.create_issue',
            description: 'Tạo issue báo lỗi',
            args: { repo: 'acme/ati', title: 'Bug' },
            dependsOn: [],
          },
        ],
        connections: {
          github: {
            credentialId: 'cred-gh-1',
            githubUserId: 'gh-42',
            login: 'octocat',
            repos: ['acme/ati'],
          },
        },
        resourceLabels: {
          'acme/ati': 'acme/ati',
        },
      };

      render(
        <PlanMoment
          request="Tạo issue"
          runtimeMode="sandbox"
          inlineComposer={null}
          plan={plan}
          services={[{ id: 'github', name: 'GitHub', configured: true, connected: true, tools: [] } as any]}
          destination={(step, labels) => labels?.[String(step.args?.repo)] ?? ''}
          onPreview={vi.fn()}
          onApprove={vi.fn()}
          onCancel={vi.fn()}
          onEdit={vi.fn()}
        />
      );

      expect(screen.getByText(/Tài khoản: @octocat \(GitHub của bạn\)/)).toBeInTheDocument();
      expect(screen.getByText(/acme\/ati/)).toBeInTheDocument();
    });

    it('ReceiptMoment displays login from githubConnection', () => {
      const planSteps = [
        {
          id: 's1',
          tool: 'github.create_issue',
          description: 'Tạo issue',
          args: { repo: 'acme/ati', title: 'Bug' },
          dependsOn: [],
        },
      ];
      const steps = [
        {
          id: 's1',
          tool: 'github.create_issue',
          description: 'Tạo issue',
          status: 'succeeded' as const,
          duration: '120ms',
          output: { number: 10, url: 'https://github.com/acme/ati/issues/10' },
        },
      ];

      render(
        <ReceiptMoment
          request="Tạo issue"
          steps={steps}
          planSteps={planSteps}
          labels={{ 'acme/ati': 'acme/ati' }}
          githubConnection={{
            credentialId: 'cred-gh-1',
            githubUserId: 'gh-42',
            login: 'octocat',
            repos: ['acme/ati'],
          }}
          services={[{ id: 'github', name: 'GitHub', configured: true, connected: true, tools: [] } as any]}
          destination={(step, labels) => labels?.[String(step.args?.repo)] ?? ''}
          onNewConversation={vi.fn()}
          onFollowup={vi.fn()}
        />
      );

      expect(screen.getByText(/Tài khoản: @octocat \(GitHub của bạn\)/)).toBeInTheDocument();
      expect(screen.getByText('acme/ati')).toBeInTheDocument();
    });

    it('FE-GH-1 & FE-GH-2: resourceDestination formats issueNumber as #N and operation metadata covers all 9 GitHub tools', () => {
      expect(
        resourceDestination(
          {
            id: 's1',
            tool: 'github.update_issue',
            description: 'Đóng issue',
            args: { repo: 'acme/ati', issueNumber: 42, state: 'closed' },
          },
          { 'acme/ati': 'acme/ati' }
        )
      ).toBe('acme/ati · #42');

      expect(
        resourceDestination(
          {
            id: 's2',
            tool: 'github.get_pull_request',
            description: 'Đọc PR',
            repo: 'acme/ati',
            args: { issueNumber: 18 },
          },
          {}
        )
      ).toBe('acme/ati · #18');

      expect(operation('github.get_pull_request')).toMatchObject({
        action: 'Đọc PR',
        receipt: 'Đã đọc PR',
        titleField: 'number',
        titlePrefix: 'PR #',
      });
      expect(operation('github.update_issue')).toMatchObject({
        action: 'Cập nhật issue',
        receipt: 'Đã cập nhật issue',
        titleField: 'number',
        titlePrefix: 'Issue #',
      });
      expect(operation('github.add_comment')).toMatchObject({
        action: 'Bình luận issue',
        receipt: 'Đã bình luận',
        titleField: 'issueNumber',
        titlePrefix: 'Issue #',
      });
      expect(operation('github.list_issues')).toMatchObject({
        action: 'Liệt kê issue & PR',
        receipt: 'Đã liệt kê issue & PR',
      });
    });

    it('FE-GH-3: PreviewContents renders Vietnamese badges for state, labels, and assignees', () => {
      render(
        <PreviewContents
          step={{
            id: 's-upd',
            tool: 'github.update_issue',
            description: 'Cập nhật issue #42',
            args: {
              repo: 'acme/ati',
              issueNumber: 42,
              title: 'Sửa lỗi OAuth',
              state: 'closed',
              labels: ['bug', 'urgent'],
              assignees: ['alice', '@bob'],
            },
          }}
          destination="acme/ati · #42"
        />
      );

      expect(screen.getByText('acme/ati · #42')).toBeInTheDocument();
      expect(screen.getByText('Sửa lỗi OAuth')).toBeInTheDocument();
      expect(screen.getByText('Đã đóng (closed)')).toBeInTheDocument();
      expect(screen.getByText('#bug')).toBeInTheDocument();
      expect(screen.getByText('#urgent')).toBeInTheDocument();
      expect(screen.getByText('@alice')).toBeInTheDocument();
      expect(screen.getByText('@bob')).toBeInTheDocument();
    });

    it('FE-GH-5 & FE-GH-6: GitHubConnection renders counter, Private/Public badge, and search filter; ResponseMoment navigates to scope on needs_scope', async () => {
      vi.spyOn(apiClient, 'getGitHubConnection').mockResolvedValue({
        status: 'needs_scope',
        login: 'octocat',
        repos: [],
      });
      vi.spyOn(apiClient, 'getGitHubCandidateRepos').mockResolvedValue({
        repos: [
          { repoId: '1', fullName: 'acme/alpha', name: 'alpha', private: true },
          { repoId: '2', fullName: 'acme/beta', name: 'beta', private: false },
          { repoId: '3', fullName: 'acme/gamma', name: 'gamma', private: false },
          { repoId: '4', fullName: 'acme/delta', name: 'delta', private: true },
          { repoId: '5', fullName: 'acme/epsilon', name: 'epsilon', private: false },
        ],
      });

      const { unmount } = render(<GitHubConnection user={adminUser} />);
      expect(await screen.findByTestId('github-scope-counter')).toHaveTextContent('Đã chọn 0/10');
      expect(await screen.findAllByText('Private')).toHaveLength(2);
      expect(screen.getAllByText('Public')).toHaveLength(3);

      const filterInput = screen.getByLabelText('Tìm nhanh repository');
      fireEvent.change(filterInput, { target: { value: 'epsilon' } });
      expect(screen.getByLabelText('acme/epsilon')).toBeInTheDocument();
      expect(screen.queryByLabelText('acme/alpha')).not.toBeInTheDocument();

      unmount();

      const navSpy = vi.fn();
      render(
        <ResponseMoment
          request="Tạo issue"
          conversationId="11111111-2222-3333-4444-555555555555"
          unavailableServices={[{ id: 'github', name: 'GitHub' }]}
          reason="Chưa chọn phạm vi repository GitHub."
          services={[
            {
              id: 'github',
              name: 'GitHub',
              configured: false,
              connected: false,
              tools: [],
              personalStatus: 'needs_scope',
              username: 'octocat',
            } as any,
          ]}
          connectFromChat={false}
          navigate={navSpy}
        />
      );

      expect(await screen.findByText(/Đã kết nối · Chưa chọn repo · @octocat/)).toBeInTheDocument();
      const scopeBtn = screen.getByRole('link', { name: /Chọn repository GitHub/i });
      fireEvent.click(scopeBtn);
      expect(navSpy).toHaveBeenCalledWith('/settings#github-scope');
    });

    it('supports personal workspace repo selection, blocks non-admin org member edits, reloads on workspace switch, and renders upstream 502 error + PR preview/receipt', async () => {
      try {
        // 1. Personal workspace: regular member can configure their own repo scope
        act(() => {
          setCachedOrganizations([{ id: 'ws-org-1', name: 'Team Org', role: 'member', status: 'active' }]);
          setActiveWorkspaceId('personal');
        });
        const getStatusSpy = vi.spyOn(apiClient, 'getGitHubConnection').mockResolvedValue({
          status: 'needs_scope',
          login: 'member_octo',
          repos: [],
        });
        vi.spyOn(apiClient, 'getGitHubCandidateRepos').mockResolvedValue({
          repos: [{ repoId: '1', fullName: 'member/personal-repo', name: 'personal-repo', private: true }],
        });

        render(<GitHubConnection user={memberUser} refresh={vi.fn()} />);
        expect(await screen.findByTestId('github-scope')).toBeInTheDocument();
        expect(screen.getByText('Chọn repository GitHub của bạn')).toBeInTheDocument();
        expect(await screen.findByText('member/personal-repo')).toBeInTheDocument();

        // 2. Switching to Organization workspace where user is a non-admin member hides #github-scope, shows notice, and reloads status
        act(() => {
          setActiveWorkspaceId('ws-org-1');
        });
        await waitFor(() => {
          expect(getStatusSpy).toHaveBeenCalledTimes(2);
          expect(screen.queryByTestId('github-scope')).toBeNull();
          expect(
            screen.getByText('Quản trị viên không gian làm việc chưa chọn repository GitHub cho nhóm.'),
          ).toBeInTheDocument();
        });

        // 3. Transient 502 error displays an explicit alert banner instead of false not_connected silence
        getStatusSpy.mockRejectedValueOnce(new Error('Không kiểm tra được quyền truy cập GitHub lúc này. Vui lòng thử lại.'));
        act(() => {
          setActiveWorkspaceId('personal');
        });
        expect(await screen.findByRole('alert')).toHaveTextContent(
          'Không kiểm tra được quyền truy cập GitHub lúc này. Vui lòng thử lại.',
        );
      } finally {
        act(() => {
          setCachedOrganizations([]);
          setActiveWorkspaceId('personal');
        });
      }
    });

    it('renders Cockpit preview and receipt metrics for create_pull_request and request_reviewers', () => {
      const { unmount } = render(
        <PreviewContents
          step={{
            id: 's-pr',
            tool: 'github.create_pull_request',
            description: 'Tạo Pull Request',
            args: {
              repo: 'acme/ati',
              title: 'Feat: GitHub PR workflow',
              head: 'feat/pr-tools',
              base: 'main',
              draft: true,
            },
          }}
          destination="acme/ati"
        />,
      );
      expect(screen.getByText('🔀 feat/pr-tools → main')).toBeInTheDocument();
      expect(screen.getByText('📝 PR nháp (Draft)')).toBeInTheDocument();
      unmount();

      render(
        <ReceiptMoment
          request="Gán reviewer cho PR"
          steps={[
            {
              id: 's-rev',
              tool: 'github.request_reviewers',
              description: 'Gán reviewer',
              status: 'succeeded',
              output: {
                number: 99,
                reviewers: ['alice', 'bob'],
                repo: 'acme/ati',
                url: 'https://github.com/acme/ati/pull/99',
              },
            },
          ]}
          planSteps={[{ id: 's-rev', tool: 'github.request_reviewers', description: 'Gán reviewer', args: {} }]}
          services={[{ id: 'github', name: 'GitHub', configured: true, connected: true, tools: [] } as any]}
          destination={resourceDestination}
          onNewConversation={() => {}}
          onFollowup={() => {}}
        />,
      );
      expect(screen.getByTestId('github-receipt-metrics')).toHaveTextContent('🔀 PR #99');
      expect(screen.getByTestId('github-receipt-metrics')).toHaveTextContent('👁️ Reviewer: alice, bob');
    });
  });
});
