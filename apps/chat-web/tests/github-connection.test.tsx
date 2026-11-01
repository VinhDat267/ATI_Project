/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { GitHubConnection } from '../src/pages/Settings/GitHubConnection';
import { apiClient } from '../src/services/api-client';
import { PlanMoment } from '../src/pages/Cockpit/PlanMoment';
import { ResponseMoment } from '../src/pages/Responses/ResponseMoment';
import { ReceiptMoment } from '../src/pages/Cockpit/ReceiptMoment';
import { SettingsPage } from '../src/pages/Settings/SettingsPage';
import { githubConnectionNotice } from '../src/services/github-connection';
import { authStorage } from '../src/services/auth-storage';
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
        expect(saveScopeSpy).toHaveBeenCalledWith(['acme/repo-1']);
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
        expect(saveScopeSpy).toHaveBeenCalledWith(['acme/new-repo']);
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
  });
});
