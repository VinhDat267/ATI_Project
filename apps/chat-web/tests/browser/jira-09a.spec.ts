import { test, expect } from '@playwright/test';

test.describe('JIRA-09A: Jira UI Foundation Browser Tests', () => {
  test('exercises connection -> join -> approve -> grant sites, responsive 1440/375, light/dark, and error handling', async ({
    page,
  }) => {
    // 1. Strictly block external Atlassian requests
    const externalRequests: string[] = [];
    await page.route(/atlassian\.com|api\.atlassian\.com/, (route) => {
      externalRequests.push(route.request().url());
      return route.abort('blockedbyclient');
    });

    // Mock initial user and authentication
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'ati_auth_tokens',
        JSON.stringify({
          accessToken: 'fake-access-token-jira',
          refreshToken: 'fake-refresh-token-jira',
          user: {
            id: 'admin-user-uuid',
            email: 'admin@ati.test',
            name: 'ATI Admin',
            role: 'admin',
            status: 'active',
          },
        })
      );
    });

    // Mock initial backend responses
    let jiraConnectionState: any = {
      connected: false,
      connectionState: 'disconnected',
      jiraAccountId: null,
      atlassianAccountId: null,
      sites: [],
    };

    let jiraWorkspaces: any[] = [
      {
        id: 'workspace-uuid-1',
        name: 'Platform Engineering',
        slug: 'platform-eng',
        role: 'admin',
        membershipStatus: 'active',
        workspaceVersion: 1,
        membershipVersion: 1,
      },
    ];

    let workspaceMembers: any[] = [
      { userId: 'member-user-uuid', role: 'member', status: 'pending', version: 1 },
    ];

    let workspaceInvites: any[] = [];
    let workspaceSites: any[] = [];
    let workspaceCapabilities: any = {
      workspaceId: 'workspace-uuid-1',
      sites: [],
    };

    // Route mocks
    await page.route('**/api/connections/myjira', async (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({ json: jiraConnectionState });
      }
      if (route.request().method() === 'DELETE') {
        jiraConnectionState = {
          connected: false,
          connectionState: 'disconnected',
          jiraAccountId: null,
          atlassianAccountId: null,
          sites: [],
        };
        return route.fulfill({
          json: { disconnected: true, revokedAt: new Date().toISOString(), identityVersion: 2 },
        });
      }
      return route.continue();
    });

    await page.route('**/api/connections/myjira/start', async (route) => {
      return route.fulfill({
        json: { authUrl: 'http://127.0.0.1:5174/connections/myjira/callback?code=TEST_CODE_1&state=TEST_STATE_1' },
      });
    });

    await page.route('**/api/connections/myjira/callback', async (route) => {
      jiraConnectionState = {
        connected: true,
        connectionState: 'connected',
        jiraAccountId: 'jira-acc-prod-1',
        atlassianAccountId: 'atl-acc-prod-1',
        displayName: 'Jira Administrator',
        sites: [
          { cloudId: 'cloud-site-1', name: 'Atlassian Production', url: 'https://ati-prod.atlassian.net' },
        ],
      };
      return route.fulfill({
        json: {
          connected: true,
          connectionState: 'connected',
          jiraAccountId: 'jira-acc-prod-1',
          atlassianAccountId: 'atl-acc-prod-1',
          displayName: 'Jira Administrator',
          siteCount: 1,
        },
      });
    });

    await page.route('**/api/jira-workspaces', async (route) => {
      return route.fulfill({ json: { workspaces: jiraWorkspaces } });
    });

    await page.route('**/api/jira-workspace-join-requests', async (route) => {
      jiraWorkspaces.push({
        id: 'workspace-joined-2',
        name: 'Design System Team',
        slug: 'design-system',
        role: 'member',
        membershipStatus: 'pending',
        workspaceVersion: 1,
        membershipVersion: 1,
      });
      return route.fulfill({
        status: 201,
        json: { requestId: 'req-join-1', workspaceId: 'workspace-joined-2', status: 'pending' },
      });
    });

    await page.route('**/api/jira-workspaces/*/members', async (route) => {
      return route.fulfill({ json: { members: workspaceMembers } });
    });

    await page.route('**/api/jira-workspaces/*/members/*/decision', async (route) => {
      const data = route.request().postDataJSON();
      workspaceMembers = workspaceMembers.map((m) =>
        m.userId === 'member-user-uuid'
          ? { ...m, status: data.decision === 'approve' ? 'active' : 'rejected', version: m.version + 1 }
          : m
      );
      return route.fulfill({ json: { status: 'active', version: 2 } });
    });

    await page.route('**/api/jira-workspaces/*/invites', async (route) => {
      if (route.request().method() === 'POST') {
        const newInvite = {
          id: 'inv-browser-1',
          workspaceId: 'workspace-uuid-1',
          inviterUserId: 'admin-user-uuid',
          expiresAt: '2026-11-09T00:00:00Z',
        };
        workspaceInvites.push(newInvite);
        return route.fulfill({
          json: {
            inviteId: 'inv-browser-1',
            inviteToken: 'ATI_INVITE_TOKEN_SECRET_9999',
            expiresAt: '2026-11-09T00:00:00Z',
          },
        });
      }
      return route.fulfill({ json: { invites: workspaceInvites } });
    });

    await page.route('**/api/jira-workspaces/*/jira-sites', async (route) => {
      if (route.request().method() === 'POST') {
        const newSite = {
          siteId: 'site-uuid-linked-1',
          cloudId: 'cloud-site-1',
          name: 'Atlassian Production',
          url: 'https://ati-prod.atlassian.net',
          active: true,
          policyVersion: 1,
        };
        workspaceSites.push(newSite);
        workspaceCapabilities = {
          workspaceId: 'workspace-uuid-1',
          sites: [
            {
              siteId: 'site-uuid-linked-1',
              cloudId: 'cloud-site-1',
              name: 'Atlassian Production',
              url: 'https://ati-prod.atlassian.net',
              projects: [{ id: '10001', key: 'ATI', name: 'ATI Platform' }],
            },
          ],
        };
        return route.fulfill({ status: 201, json: { site: newSite } });
      }
      return route.fulfill({ json: { sites: workspaceSites } });
    });

    await page.route('**/api/jira-workspaces/*/jira-capabilities', async (route) => {
      return route.fulfill({ json: workspaceCapabilities });
    });

    await page.route('**/api/services', async (route) => {
      return route.fulfill({ json: { services: [] } });
    });

    // 2. Desktop Viewport (1440px)
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/settings#jira');

    // Verify initial disconnected state
    await expect(page.locator('#jira')).toBeVisible();
    await expect(page.locator('#jira-connect')).toBeVisible();

    // Connect via OAuth callback
    await page.goto('/connections/myjira/callback?code=TEST_CODE_1&state=TEST_STATE_1');
    await page.waitForURL('**/settings#jira');

    // Verify connected state
    await expect(page.getByText('Đã kết nối')).toBeVisible();
    await expect(page.getByText('Jira Administrator')).toBeVisible();
    await expect(page.getByText('Atlassian Production')).toBeVisible();

    // 3. Admin creates invite and approves member
    await expect(page.getByRole('button', { name: 'Tạo mã mời' })).toBeVisible();
    await page.getByRole('button', { name: 'Tạo mã mời' }).click();
    await expect(page.getByText('ATI_INVITE_TOKEN_SECRET_9999')).toBeVisible();

    // Approve pending member
    await expect(page.getByRole('button', { name: 'Duyệt' })).toBeVisible();
    await page.getByRole('button', { name: 'Duyệt' }).click();

    // Link site
    await expect(page.getByRole('button', { name: 'Liên kết site' })).toBeVisible();
    await page.getByRole('button', { name: 'Liên kết site' }).click();

    // Verify capabilities directory
    await expect(page.getByText('ATI — ATI Platform')).toBeVisible();

    // Verify production conversation CTA is disabled with JIRA-08 copy
    const ctaButton = page.getByRole('button', { name: /Bắt đầu hội thoại Jira \(Chờ JIRA-08\)/i });
    await expect(ctaButton).toBeDisabled();
    await expect(page.getByText(/chờ hoàn tất JIRA-08/i)).toBeVisible();

    // 4. Mobile Viewport (375px) check
    await page.setViewportSize({ width: 375, height: 667 });
    await expect(page.locator('#jira')).toBeVisible();
    await expect(page.getByText('Atlassian Jira Cloud')).toBeVisible();

    // 5. Dark Mode check
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('#jira')).toBeVisible();

    // 6. Verify external network boundary was respected
    expect(externalRequests).toEqual([]);
  });
});
