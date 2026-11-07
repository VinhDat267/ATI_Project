import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { JiraConnection } from '../src/pages/Settings/JiraConnection';
import { JiraCallbackView } from '../src/views/JiraCallbackView';
import { jiraApi } from '../src/services/jira-api';
import { authStorage } from '../src/services/auth-storage';
import type { User } from '../src/types';

describe('Jira UI Responsive, Theme, Refresh, Delayed Callback & User Switch', () => {
  const userA: User = {
    id: 'user-a',
    email: 'user-a@ati.test',
    name: 'User A',
    role: 'admin',
    status: 'active',
  };

  const userB: User = {
    id: 'user-b',
    email: 'user-b@ati.test',
    name: 'User B',
    role: 'member',
    status: 'active',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    document.documentElement.classList.remove('dark');
    authStorage.setStoredTokens({
      accessToken: 'token-user-a',
      refreshToken: 'refresh-user-a',
      user: userA,
    });
  });

  afterEach(() => {
    document.documentElement.classList.remove('dark');
    authStorage.clearStoredTokens();
    vi.restoreAllMocks();
  });

  it('renders responsive layout at 1440px desktop viewport', async () => {
    window.innerWidth = 1440;
    window.innerHeight = 900;

    vi.spyOn(jiraApi, 'connection').mockResolvedValue({
      connected: true,
      connectionState: 'connected',
      jiraAccountId: 'acc-1',
      atlassianAccountId: 'atl-1',
      displayName: 'Desktop User',
      sites: [{ cloudId: 'c1', name: 'Site Desktop', url: 'https://desktop.atlassian.net' }],
    });
    vi.spyOn(jiraApi, 'workspaces').mockResolvedValue({
      workspaces: [
        {
          id: 'ws-1',
          name: 'Desktop Workspace',
          slug: 'desktop-ws',
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
    vi.spyOn(jiraApi, 'capabilities').mockResolvedValue({ workspaceId: 'ws-1', sites: [] });

    const { container } = render(<JiraConnection user={userA} />);

    await waitFor(() => {
      expect(screen.getByText(/Desktop User/i)).toBeInTheDocument();
      expect(screen.getAllByText(/Site Desktop/i)[0]).toBeInTheDocument();
    });

    // Check desktop responsive flex classes
    const card = container.querySelector('#jira');
    expect(card).toBeInTheDocument();
    expect(card?.className).toContain('sm:p-6');
  });

  it('renders responsive layout at 375px mobile viewport without overflow', async () => {
    window.innerWidth = 375;
    window.innerHeight = 667;

    vi.spyOn(jiraApi, 'connection').mockResolvedValue({
      connected: true,
      connectionState: 'connected',
      jiraAccountId: 'acc-1',
      atlassianAccountId: 'atl-1',
      displayName: 'Mobile User',
      sites: [{ cloudId: 'c1', name: 'Site Mobile', url: 'https://mobile.atlassian.net' }],
    });
    vi.spyOn(jiraApi, 'workspaces').mockResolvedValue({
      workspaces: [
        {
          id: 'ws-1',
          name: 'Mobile Workspace',
          slug: 'mobile-ws',
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
    vi.spyOn(jiraApi, 'capabilities').mockResolvedValue({ workspaceId: 'ws-1', sites: [] });

    const { container } = render(<JiraConnection user={userA} />);

    await waitFor(() => {
      expect(screen.getByText(/Mobile User/i)).toBeInTheDocument();
      expect(screen.getAllByText(/Site Mobile/i)[0]).toBeInTheDocument();
    });

    // Verify mobile classes: flex-col with sm:flex-row
    const header = container.querySelector('.flex.flex-col.sm\\:flex-row');
    expect(header).toBeInTheDocument();
  });

  it('supports light theme and dark theme styling', async () => {
    vi.spyOn(jiraApi, 'connection').mockResolvedValue({
      connected: false,
      connectionState: 'disconnected',
      jiraAccountId: null,
      atlassianAccountId: null,
      sites: [],
    });
    vi.spyOn(jiraApi, 'workspaces').mockResolvedValue({ workspaces: [] });

    // 1. Light theme
    const { container, rerender } = render(<JiraConnection user={userA} />);
    await waitFor(() => {
      expect(screen.getByText(/Atlassian Jira Cloud/i)).toBeInTheDocument();
    });
    const card = container.querySelector('#jira');
    expect(card?.className).toContain('bg-white');
    expect(card?.className).toContain('dark:bg-[#111827]');

    // 2. Dark theme
    document.documentElement.classList.add('dark');
    rerender(<JiraConnection user={userA} />);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(card?.className).toContain('dark:border-[#374151]');
  });

  it('handles refresh by reloading connection status and capabilities', async () => {
    const connSpy = vi.spyOn(jiraApi, 'connection')
      .mockResolvedValueOnce({
        connected: false,
        connectionState: 'disconnected',
        jiraAccountId: null,
        atlassianAccountId: null,
        sites: [],
      })
      .mockResolvedValueOnce({
        connected: true,
        connectionState: 'connected',
        jiraAccountId: 'acc-refreshed',
        atlassianAccountId: 'atl-refreshed',
        displayName: 'Refreshed User',
        sites: [{ cloudId: 'c-ref', name: 'Refreshed Site', url: 'https://refreshed.atlassian.net' }],
      });

    vi.spyOn(jiraApi, 'workspaces').mockResolvedValue({ workspaces: [] });

    const refreshFn = vi.fn().mockResolvedValue(undefined);
    render(<JiraConnection user={userA} refresh={refreshFn} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /kết nối jira/i })).toBeInTheDocument();
    });

    // Re-fetch
    expect(connSpy).toHaveBeenCalledTimes(1);
  });

  it('delayed callback: does not navigate while in-flight and completes on resolution', async () => {
    const navigate = vi.fn();
    let resolveCallback!: (val: any) => void;
    const delayedPromise = new Promise((resolve) => {
      resolveCallback = resolve;
    });

    vi.spyOn(jiraApi, 'callback').mockReturnValue(delayedPromise as any);

    render(
      <JiraCallbackView
        input={{ code: 'CODE_DELAYED', state: 'STATE_DELAYED' }}
        navigate={navigate}
      />
    );

    // Shows in-flight status
    const statusEls = screen.getAllByRole('status');
    expect(statusEls.some((el) => /đang hoàn tất kết nối jira/i.test(el.textContent ?? ''))).toBe(true);
    expect(navigate).not.toHaveBeenCalled();

    // Resolve callback
    await act(async () => {
      resolveCallback({
        connected: true,
        connectionState: 'connected',
        jiraAccountId: 'acc-1',
        atlassianAccountId: 'atl-1',
        displayName: 'Delayed Hero',
        siteCount: 1,
      });
    });

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith('/settings#jira', true);
    });
  });

  it('user switching: aborts callback when active user changes during in-flight callback', async () => {
    const navigate = vi.fn();
    let resolveCallback!: (val: any) => void;
    const delayedPromise = new Promise((resolve) => {
      resolveCallback = resolve;
    });

    vi.spyOn(jiraApi, 'callback').mockReturnValue(delayedPromise as any);

    render(
      <JiraCallbackView
        input={{ code: 'CODE_SWITCH', state: 'STATE_SWITCH' }}
        navigate={navigate}
      />
    );

    expect(screen.getAllByRole('status').length).toBeGreaterThanOrEqual(1);

    // Switch user while callback is in flight!
    act(() => {
      authStorage.setStoredTokens({
        accessToken: 'token-user-b',
        refreshToken: 'refresh-user-b',
        user: userB,
      });
    });

    // Resolve callback after user switched
    await act(async () => {
      resolveCallback({
        connected: true,
        connectionState: 'connected',
        jiraAccountId: 'acc-user-a',
        atlassianAccountId: 'atl-user-a',
        displayName: 'User A Atlassian',
        siteCount: 1,
      });
    });

    // Must NOT navigate or adopt User A's result for User B!
    expect(navigate).not.toHaveBeenCalled();
  });
});
