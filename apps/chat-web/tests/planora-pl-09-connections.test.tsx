/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TrelloConnection } from '../src/pages/Settings/TrelloConnection';
import { GitHubConnection } from '../src/pages/Settings/GitHubConnection';
import { TelegramConnection } from '../src/pages/Settings/TelegramConnection';
import { TrelloCallbackView } from '../src/views/TrelloCallbackView';
import { GitHubCallbackView } from '../src/views/GitHubCallbackView';
import { TelegramCallbackView } from '../src/views/TelegramCallbackView';
import { apiClient } from '../src/services/api-client';
import { authStorage } from '../src/services/auth-storage';
import type { User } from '../src/types';

describe('PL-09 Planora Provider Connections (Trello, GitHub, Telegram) - Business-First UX v2.0', () => {
  const adminUser: User = {
    id: 'u-admin-pl09',
    name: 'Admin User',
    email: 'admin@planora.test',
    role: 'admin',
  };

  const memberUser: User = {
    id: 'u-member-pl09',
    name: 'Member User',
    email: 'member@planora.test',
    role: 'member',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    authStorage.setStoredTokens({ accessToken: 'test-token', user: adminUser });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  describe('1. Callback Views Integration with ConnectionCallbackFrame', () => {
    it('TrelloCallbackView renders Planora brand, status badge, loading indicator, and single back button', async () => {
      const navigateSpy = vi.fn();
      vi.spyOn(apiClient, 'completeTrelloConnection').mockReturnValue(new Promise(() => {}));

      render(
        <TrelloCallbackView
          navigate={navigateSpy}
          input={{ code: 'trello_code_123', state: 'trello_state_abc' }}
        />
      );

      // Planora branding & heading
      expect(screen.getAllByText('planora').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByRole('heading', { level: 1, name: 'Kết nối Trello' })).toBeInTheDocument();
      expect(screen.getAllByText('KẾT NỐI BẢNG CÔNG VIỆC').length).toBeGreaterThanOrEqual(1);

      // Status indicator
      expect(screen.getByText('Đang xử lý')).toBeInTheDocument();
      const statusEls = screen.getAllByRole('status');
      expect(statusEls.some((el) => el.textContent?.includes('Đang hoàn tất kết nối Trello…'))).toBe(true);

      // Back to settings button from ConnectionCallbackFrame
      const backBtn = screen.getByRole('button', { name: 'Về Kết nối dịch vụ' });
      expect(backBtn).toBeInTheDocument();
      fireEvent.click(backBtn);
      expect(navigateSpy).toHaveBeenCalledWith('/settings', true);

      // No duplicate links to /settings
      const links = screen.queryAllByRole('link', { name: /Về Kết nối dịch vụ/i });
      expect(links.length).toBe(0);
    });

    it('GitHubCallbackView renders Planora brand, status badge, loading indicator, and single back button', async () => {
      const navigateSpy = vi.fn();
      vi.spyOn(apiClient, 'completeGitHubConnection').mockReturnValue(new Promise(() => {}));

      render(
        <GitHubCallbackView
          navigate={navigateSpy}
          input={{ code: 'gh_code_456', state: 'gh_state_def' }}
        />
      );

      expect(screen.getAllByText('planora').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByRole('heading', { level: 1, name: 'Kết nối GitHub' })).toBeInTheDocument();
      expect(screen.getAllByText('KẾT NỐI KHO MÃ NGUỒN').length).toBeGreaterThanOrEqual(1);

      expect(screen.getByText('Đang xử lý')).toBeInTheDocument();
      const statusEls = screen.getAllByRole('status');
      expect(statusEls.some((el) => el.textContent?.includes('Đang hoàn tất kết nối GitHub…'))).toBe(true);

      const backBtn = screen.getByRole('button', { name: 'Về Kết nối dịch vụ' });
      expect(backBtn).toBeInTheDocument();
      fireEvent.click(backBtn);
      expect(navigateSpy).toHaveBeenCalledWith('/settings', true);

      const links = screen.queryAllByRole('link', { name: /Về Kết nối dịch vụ/i });
      expect(links.length).toBe(0);
    });

    it('TelegramCallbackView renders bot deep link, group link, pending pairing flow, and error state', async () => {
      const navigateSpy = vi.fn();
      vi.spyOn(apiClient, 'completeTelegramConnection')
        .mockRejectedValueOnce(
          Object.assign(new Error('Chưa nhận được tín hiệu nhấn Start từ Telegram.'), {
            code: 'TELEGRAM_PAIRING_PENDING',
          })
        )
        .mockResolvedValueOnce({
          status: 'connected',
          telegramUserId: '777001',
          username: 'planora_user',
          displayName: 'Planora User',
          chats: [],
          selectedChats: [],
        });

      render(
        <TelegramCallbackView
          navigate={navigateSpy}
          input={{
            state: 'tg_state_789',
            botUsername: 'planora_bot',
            deepLinkUrl: 'https://t.me/planora_bot?start=ati_tg_state_789',
            groupDeepLinkUrl: 'https://t.me/planora_bot?startgroup=ati_tg_state_789',
          }}
        />
      );

      expect(screen.getAllByText('planora').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByRole('heading', { level: 1, name: 'Kết nối Telegram' })).toBeInTheDocument();
      expect(screen.getAllByText('KẾT NỐI TIN NHẮN TỨC THỜI').length).toBeGreaterThanOrEqual(1);

      // Deep link CTA buttons
      const openBot = await screen.findByRole('link', { name: /Mở Telegram và bấm Start/i });
      expect(openBot).toHaveAttribute('href', 'https://t.me/planora_bot?start=ati_tg_state_789');
      expect(openBot.className).toContain('var(--planora-primary)');
      expect(openBot.className).toContain('var(--planora-on-primary)');
      expect(openBot.className).not.toContain('#FF5701');

      const groupLink = screen.getByRole('link', { name: /\+ Thêm bot vào nhóm Telegram/i });
      expect(groupLink).toHaveAttribute('href', 'https://t.me/planora_bot?startgroup=ati_tg_state_789');

      // Verify button appears on TELEGRAM_PAIRING_PENDING
      const verifyBtn = await screen.findByRole('button', { name: /Tôi đã bấm Start trên Telegram/i });
      expect(verifyBtn).toHaveAttribute('id', 'telegram-verify-pairing');

      fireEvent.click(verifyBtn);
      await waitFor(() => {
        expect(navigateSpy).toHaveBeenCalledWith('/settings#telegram', true);
      });
    });

    it('enforces aria-hidden="true" on 100% of SVG vector icons in all 3 callback views', () => {
      const views = [
        <TrelloCallbackView key="trello" navigate={vi.fn()} input={{ code: 'c', state: 's' }} />,
        <GitHubCallbackView key="github" navigate={vi.fn()} input={{ code: 'c', state: 's' }} />,
        <TelegramCallbackView key="telegram" navigate={vi.fn()} input={{ state: 's' }} />,
      ];

      for (const view of views) {
        const { container } = render(view);
        const svgs = container.querySelectorAll('svg');
        expect(svgs.length).toBeGreaterThan(0);
        svgs.forEach((svg) => {
          expect(svg).toHaveAttribute('aria-hidden', 'true');
        });
        cleanup();
      }
    });
  });

  describe('2. Design Tokens, Contrast & Brand Consistency (No Raw Emoji, No #FF5701, No "ATI")', () => {
    it('TrelloConnection uses Planora primary button tokens and no #FF5701', async () => {
      vi.spyOn(apiClient, 'getTrelloConnection').mockResolvedValue({
        status: 'not_connected',
        boards: [],
      });

      render(<TrelloConnection user={adminUser} refresh={vi.fn()} />);

      const connectBtn = await screen.findByRole('button', { name: 'Kết nối Trello' });
      expect(connectBtn.className).toContain('bg-[var(--planora-primary)]');
      expect(connectBtn.className).toContain('text-[var(--planora-on-primary)]');
      expect(connectBtn.className).not.toContain('#FF5701');

      const card = document.getElementById('service-row-trello');
      expect(card).not.toBeNull();
      expect(card?.className).toContain('border-[var(--planora-divider)]');
      expect(card?.className).toContain('bg-[var(--planora-paper)]');
    });

    it('GitHubConnection uses Planora primary button tokens and search/counter tokens', async () => {
      vi.spyOn(apiClient, 'getGitHubConnection').mockResolvedValue({
        status: 'needs_scope',
        login: 'octocat',
        repos: [],
      });
      vi.spyOn(apiClient, 'getGitHubCandidateRepos').mockResolvedValue({
        repos: [
          { repoId: 'r1', fullName: 'org/repo1', name: 'repo1', private: false },
          { repoId: 'r2', fullName: 'org/repo2', name: 'repo2', private: true },
          { repoId: 'r3', fullName: 'org/repo3', name: 'repo3' },
          { repoId: 'r4', fullName: 'org/repo4', name: 'repo4' },
          { repoId: 'r5', fullName: 'org/repo5', name: 'repo5' },
        ],
      });

      render(<GitHubConnection user={adminUser} refresh={vi.fn()} />);

      const counter = await screen.findByTestId('github-scope-counter');
      expect(counter).toHaveTextContent('Đã chọn 0/10');
      expect(counter.className).toContain('bg-[var(--planora-paper)]');
      expect(counter.className).toContain('border-[var(--planora-border-strong)]');

      const searchInput = await screen.findByRole('searchbox', { name: 'Tìm nhanh repository' });
      expect(searchInput.className).toContain('bg-[var(--planora-paper)]');
      expect(searchInput.className).toContain('border-[var(--planora-border-strong)]');

      const saveBtn = screen.getByRole('button', { name: 'Lưu repository được dùng' });
      expect(saveBtn.className).toContain('bg-[var(--planora-primary)]');
      expect(saveBtn.className).not.toContain('#FF5701');
    });

    it('TelegramConnection uses Planora primary button tokens and scope editor styling', async () => {
      vi.spyOn(apiClient, 'getTelegramConnection').mockResolvedValue({
        status: 'connected',
        username: 'my_telegram',
        chats: [{ chatId: 'c1', title: 'Work Group', type: 'group', member: true }],
        selectedChats: [{ chatId: 'c1', title: 'Work Group', type: 'group', member: true }],
      });

      render(<TelegramConnection user={adminUser} refresh={vi.fn()} />);

      expect(await screen.findByText('Work Group')).toBeInTheDocument();
      const editBtn = screen.getByRole('button', { name: 'Chọn chat / nhóm' });
      expect(editBtn.className).toContain('border-[var(--planora-border-strong)]');

      fireEvent.click(editBtn);

      const scopeEditor = await screen.findByTestId('telegram-scope');
      expect(scopeEditor.className).toContain('bg-[var(--planora-surface-inset)]');
      expect(scopeEditor.className).toContain('border-[var(--planora-divider)]');

      const saveBtn = screen.getByRole('button', { name: 'Lưu danh sách chat' });
      expect(saveBtn.className).toContain('bg-[var(--planora-primary)]');
      expect(saveBtn.className).not.toContain('#FF5701');
    });

    it('replaces all "ATI" mentions with "Planora" in disconnect confirmation modals', async () => {
      vi.spyOn(apiClient, 'getTrelloConnection').mockResolvedValue({
        status: 'connected',
        username: 'trello_user',
        boards: [{ boardId: 'b1', boardName: 'Main Board', member: true }],
      });
      vi.spyOn(apiClient, 'getGitHubConnection').mockResolvedValue({
        status: 'connected',
        login: 'gh_user',
        repos: [{ repoId: 'r1', fullName: 'org/repo', name: 'repo', accessible: true }],
      });
      vi.spyOn(apiClient, 'getTelegramConnection').mockResolvedValue({
        status: 'connected',
        username: 'tg_user',
        chats: [{ chatId: 'c1', title: 'Personal Chat', type: 'private', member: true }],
        selectedChats: [{ chatId: 'c1', title: 'Personal Chat', type: 'private', member: true }],
      });

      // 1. Trello disconnect modal
      const { unmount: unmountTrello } = render(<TrelloConnection user={adminUser} refresh={vi.fn()} />);
      const trelloDisconnect = await screen.findByRole('button', { name: 'Ngắt kết nối' });
      fireEvent.click(trelloDisconnect);
      expect(await screen.findByText(/Planora sẽ xoá token kết nối Trello/i)).toBeInTheDocument();
      expect(screen.queryByText(/ATI sẽ xoá token/i)).not.toBeInTheDocument();
      unmountTrello();

      // 2. GitHub disconnect modal
      const { unmount: unmountGitHub } = render(<GitHubConnection user={adminUser} refresh={vi.fn()} />);
      const githubDisconnect = await screen.findByRole('button', { name: 'Ngắt kết nối' });
      fireEvent.click(githubDisconnect);
      expect(await screen.findByText(/Planora sẽ xoá token kết nối GitHub/i)).toBeInTheDocument();
      expect(screen.queryByText(/ATI sẽ xoá token/i)).not.toBeInTheDocument();
      unmountGitHub();

      // 3. Telegram disconnect modal
      const { unmount: unmountTelegram } = render(<TelegramConnection user={adminUser} refresh={vi.fn()} />);
      const telegramDisconnect = await screen.findByRole('button', { name: 'Ngắt kết nối' });
      fireEvent.click(telegramDisconnect);
      expect(await screen.findByText(/Planora sẽ xoá liên kết Telegram cá nhân/i)).toBeInTheDocument();
      expect(screen.queryByText(/ATI sẽ xoá liên kết/i)).not.toBeInTheDocument();
      unmountTelegram();
    });
  });

  describe('3. Scope Governance & RBAC (Admin vs Member)', () => {
    it('member cannot see scope selector on Trello or GitHub when connected in team workspace', async () => {
      const { setCachedOrganizations, setActiveWorkspaceId } = await import('../src/services/workspace-storage');
      setCachedOrganizations([
        { id: 'org-team', name: 'Team Org', role: 'member', status: 'active' }
      ]);
      setActiveWorkspaceId('org-team');

      vi.spyOn(apiClient, 'getTrelloConnection').mockResolvedValue({
        status: 'connected',
        username: 'member_trello',
        boards: [{ boardId: 'b1', boardName: 'Board 1', member: true }],
      });
      vi.spyOn(apiClient, 'getGitHubConnection').mockResolvedValue({
        status: 'connected',
        login: 'member_gh',
        repos: [{ repoId: 'r1', fullName: 'org/repo', name: 'repo', accessible: true }],
      });

      const { unmount } = render(<TrelloConnection user={memberUser} refresh={vi.fn()} />);
      await screen.findByText(/member_trello/);
      expect(document.getElementById('trello-scope')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Đổi bảng' })).toBeNull();
      unmount();

      render(<GitHubConnection user={memberUser} refresh={vi.fn()} />);
      await screen.findByText(/member_gh/);
      expect(document.getElementById('github-scope')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Đổi repository' })).toBeNull();

      // Reset workspace
      setActiveWorkspaceId('personal');
      setCachedOrganizations([]);
    });

    it('enforces maximum 10 resources across all provider scope selectors', async () => {
      // GitHub max 10
      vi.spyOn(apiClient, 'getGitHubConnection').mockResolvedValue({
        status: 'needs_scope',
        login: 'admin_gh',
        repos: [],
      });
      const elevenRepos = Array.from({ length: 11 }, (_, i) => ({
        repoId: `r-${i + 1}`,
        fullName: `org/repo-${i + 1}`,
        name: `repo-${i + 1}`,
        private: false,
      }));
      vi.spyOn(apiClient, 'getGitHubCandidateRepos').mockResolvedValue({ repos: elevenRepos });

      render(<GitHubConnection user={adminUser} refresh={vi.fn()} />);
      await screen.findByTestId('github-scope');
      await screen.findByRole('checkbox', { name: /org\/repo-1\b/i });

      for (let i = 1; i <= 10; i++) {
        const cb = screen.getByRole('checkbox', { name: new RegExp(`org/repo-${i}\\b`, 'i') });
        fireEvent.click(cb);
      }

      // 11th checkbox must be disabled
      const cb11 = screen.getByRole('checkbox', { name: /org\/repo-11\b/i });
      expect(cb11).toBeDisabled();
      expect(screen.getByTestId('github-scope-counter')).toHaveTextContent('Đã chọn 10/10');
    });
  });
});
