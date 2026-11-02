/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SettingsPage } from '../src/pages/Settings/SettingsPage';
import { GuidePage } from '../src/pages/Guide/GuidePage';
import { SERVICE_GUIDES, GUIDE_OAUTH_SHOWCASE_CARDS } from '../src/pages/Guide/data';
import { LandingPage } from '../src/pages/Landing/LandingPage';
import { GitHubConnection } from '../src/pages/Settings/GitHubConnection';
import { Cockpit } from '../src/components/Cockpit';
import { HistoryPage } from '../src/pages/History/HistoryPage';
import { apiClient } from '../src/services/api-client';
import { setActiveWorkspaceId, setCachedOrganizations, resetWorkspaceStorage } from '../src/services/workspace-storage';
import { useChatStore } from '../src/store/chat-store';
import type { ServiceInfo, User } from '../src/types';

const memberUser: User = {
  id: 'u-member',
  email: 'member@example.com',
  name: 'Member User',
  role: 'member',
};

const service = (id: string, overrides: Partial<ServiceInfo> = {}): ServiceInfo => ({
  id,
  name: id,
  configured: false,
  connected: false,
  connectionStatus: 'unconfigured',
  ...overrides,
});

afterEach(() => {
  cleanup();
  useChatStore.getState().reset();
  resetWorkspaceStorage();
  vi.restoreAllMocks();
});

describe('Sprint 3 — PBI-10: Business-First UX & Deduplication of Personal vs Legacy Services', () => {
  it('updates SettingsPage summary, section subtitles, footer note, and hides legacy calendar/sheets when personal mycalendar/mysheets exist', async () => {
    vi.spyOn(apiClient, 'getRuntime').mockResolvedValue({ runtimeMode: 'live' });
    vi.spyOn(apiClient, 'getServices').mockResolvedValue({
      canConfigure: true,
      services: [
        service('gmail', { name: 'Gmail (Cá nhân)', connection: 'personal', personalStatus: 'not_connected' }),
        service('mycalendar', { name: 'Google Calendar (Cá nhân)', connection: 'personal', personalStatus: 'not_connected' }),
        service('mysheets', { name: 'Google Sheets (Cá nhân)', connection: 'personal', personalStatus: 'not_connected' }),
        service('calendar', { name: 'Google Calendar', configured: false, connectionStatus: 'unconfigured' }),
        service('sheets', { name: 'Google Sheets', configured: false, connectionStatus: 'unconfigured' }),
        service('slack', { name: 'Slack', configured: false, connectionStatus: 'unconfigured' }),
      ],
    });

    render(<SettingsPage user={memberUser} authToken="tok" onLogout={vi.fn()} navigate={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('settings-oauth-summary')).toHaveTextContent(
        'Liên kết tài khoản nhanh & Chọn nơi làm việc',
      );
    });

    expect(
      screen.getByText('Đăng nhập trực tiếp bằng tài khoản của bạn · Chọn nơi ATI được phép làm việc'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Bấm để thiết lập kênh làm việc chung của nhóm'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Dịch vụ dùng chung: chỉ quản trị viên cập nhật khoá. Tài khoản cá nhân (Gmail, Lịch, Bảng tính, Trello, GitHub, Telegram) do mỗi người tự đăng nhập và chọn nơi làm việc.',
      ),
    ).toBeInTheDocument();

    // Personal cards for Calendar and Sheets exist, while legacy workspace calendar/sheets cards are hidden
    expect(document.getElementById('service-row-mycalendar')).not.toBeNull();
    expect(document.getElementById('service-row-mysheets')).not.toBeNull();
    const unconnectedList = document.getElementById('list-unconnected-services')!;
    expect(within(unconnectedList).getByText('Slack')).toBeInTheDocument();
    expect(within(unconnectedList).queryByText('Google Calendar')).toBeNull();
    expect(within(unconnectedList).queryByText('Google Sheets')).toBeNull();
  });

  it('replaces technical OAuth 1-Click labels on GuidePage, GUIDE_SERVICES, and LandingPage with business-friendly copy', async () => {
    vi.spyOn(apiClient, 'getRuntime').mockResolvedValue({
      runtimeMode: 'live',
      gmailEnabled: true,
      mysheetsEnabled: true,
    });

    for (const card of GUIDE_OAUTH_SHOWCASE_CARDS.filter(c => c.badgeStyle === 'oauth')) {
      expect(card.badge).toBe('Đăng nhập trực tiếp · 1 chạm');
    }

    const githubGuide = SERVICE_GUIDES.github!;
    expect(githubGuide.steps[0].title).toContain('Kết nối trực tiếp bằng tài khoản');
    expect(githubGuide.steps[0].desc).toContain('/settings#github');

    const telegramGuide = SERVICE_GUIDES.telegram!;
    expect(telegramGuide.steps[0].title).toContain('Kết nối trực tiếp bằng tài khoản');
    expect(telegramGuide.steps[0].desc).toContain('/settings#telegram');

    const jiraGuide = SERVICE_GUIDES.jira!;
    expect(JSON.stringify(jiraGuide)).toContain('Site URL');

    const { unmount } = render(<GuidePage navigate={vi.fn()} user={memberUser} onLogout={vi.fn()} />);
    expect(document.body.textContent).not.toContain('OAuth 1-Click');
    expect(document.body.textContent).not.toContain('OAuth 2.0 · 1-Click');
    expect(screen.getAllByText('Đăng nhập trực tiếp · 1 chạm').length).toBeGreaterThanOrEqual(3);
    unmount();

    render(<LandingPage navigate={vi.fn()} authConfig={{ signupEnabled: true, googleEnabled: true }} />);
    expect(document.body.textContent).not.toContain('OAuth 1-Click');
    expect(screen.getByText('Đăng nhập trực tiếp · Chọn Bảng')).toBeInTheDocument();
    expect(screen.getByText('Đăng nhập trực tiếp · Chọn Kho')).toBeInTheDocument();
    expect(screen.getByText('Đăng nhập trực tiếp · Chọn Bảng tính')).toBeInTheDocument();
    expect(screen.getByText('Đăng nhập trực tiếp · Chọn Lịch')).toBeInTheDocument();
    expect((await screen.findAllByText('Đăng nhập trực tiếp · Cá nhân')).length).toBeGreaterThanOrEqual(2);
  });
});

describe('Sprint 3 — PBI-14B: GitHubConnection workspace-aware scope selection', () => {
  it('allows selecting GitHub repository scope in Personal Workspace or as Workspace Admin even when user.role is member', async () => {
    setCachedOrganizations([{ id: 'org-1', name: 'Org 1', role: 'admin', status: 'active' }]);
    setActiveWorkspaceId('personal');

    vi.spyOn(apiClient, 'getGitHubConnection').mockResolvedValue({
      status: 'needs_scope',
      login: 'octocat',
      repos: [],
    });
    vi.spyOn(apiClient, 'getGitHubCandidateRepos').mockResolvedValue({
      repos: [{ repoId: '101', name: 'hello-world', fullName: 'octocat/hello-world', private: false }],
    });

    render(<GitHubConnection user={memberUser} refresh={vi.fn()} />);

    const scopeArea = await screen.findByTestId('github-scope');
    expect(scopeArea).toBeInTheDocument();
    expect(await screen.findByRole('checkbox', { name: /octocat\/hello-world/i })).toBeInTheDocument();
  });
});

describe('Sprint 3 — PBI-16B: Cockpit footer service sync & History filter empty state', () => {
  it('displays services with connected=true or personalStatus=connected or configured=true (not unhealthy) in Cockpit footer', async () => {
    vi.spyOn(apiClient, 'getRuntime').mockResolvedValue({ runtimeMode: 'live' });
    vi.spyOn(apiClient, 'getConversations').mockResolvedValue({ conversations: [] });

    render(
      <Cockpit
        services={[
          service('trello', {
            name: 'Trello',
            connection: 'personal',
            configured: false,
            connected: false,
            personalStatus: 'connected',
            connectionStatus: 'unconfigured',
          }),
          service('slack', {
            name: 'Slack',
            configured: false,
            connected: false,
            connectionStatus: 'unconfigured',
          }),
        ]}
        servicesLoading={false}
        servicesError={null}
        onSendMessage={vi.fn()}
        onNewConversation={vi.fn()}
        onSelectConversation={vi.fn()}
        onSettings={vi.fn()}
        onApprove={vi.fn()}
        onCancel={vi.fn()}
        recovery={null}
      />,
    );

    expect(screen.queryByText('Chưa có dịch vụ nào được kết nối')).toBeNull();
    const strip = screen.getByLabelText('Dịch vụ đã thiết lập');
    expect(within(strip).getByText('Trello')).toBeInTheDocument();
    expect(within(strip).getByText('Đã kết nối:')).toBeInTheDocument();
  });

  it('shows filter empty state and hides Load More button on HistoryPage when selected status tab has 0 items', async () => {
    vi.spyOn(apiClient, 'getRuntime').mockResolvedValue({ runtimeMode: 'live' });
    vi.spyOn(apiClient, 'getConversations').mockResolvedValue({
      conversations: [
        {
          id: 'conv-1',
          title: 'Trao đổi kế hoạch quý',
          updatedAt: '2026-10-07T08:00:00.000Z',
        },
      ],
      nextCursor: 'cursor-next-page',
    });

    render(<HistoryPage user={memberUser} onLogout={vi.fn()} navigate={vi.fn()} />);

    await screen.findByText('Trao đổi kế hoạch quý');
    expect(document.getElementById('load-more-container')).not.toHaveClass('hidden');

    fireEvent.click(screen.getByRole('button', { name: 'Hoàn thành' }));

    expect(await screen.findByText('Chưa có hội thoại nào ở trạng thái này.')).toBeInTheDocument();
    expect(document.getElementById('load-more-container')).toHaveClass('hidden');
  });
});
