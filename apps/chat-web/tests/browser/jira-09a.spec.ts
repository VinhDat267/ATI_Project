import { test, expect } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:5174' });

test.describe('JIRA-09A: Jira UI Foundation Browser Tests', () => {
  test('exercises connect flow, reload, stale tab, account switch, workspace switch, 401/503 errors, and responsive layouts', async ({
    page,
  }) => {
    // 1. Strictly block external Atlassian requests
    const externalRequests: string[] = [];
    await page.route(/atlassian\.com|api\.atlassian\.com/, (route) => {
      externalRequests.push(route.request().url());
      return route.abort('blockedbyclient');
    });

    const adminJwtPayload = btoa(JSON.stringify({ type: 'access', sub: 'admin-user-uuid', sid: 'session-uuid-1' }));
    const adminToken = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${adminJwtPayload}.sig`;

    // Mock initial user and authentication
    await page.addInitScript(
      ({ token }) => {
        window.localStorage.setItem('wap_access_token', token);
        window.localStorage.setItem('wap_refresh_token', 'fake-refresh-token-jira');
        window.localStorage.setItem(
          'wap_user',
          JSON.stringify({
            id: 'admin-user-uuid',
            email: 'admin@ati.test',
            name: 'ATI Admin',
            role: 'admin',
            status: 'active',
          })
        );
      },
      { token: adminToken }
    );

    // Mock initial backend responses
    let jiraConnectionStatus = 200;
    let jiraConnectionResponse: any = {
      connected: false,
      connectionState: 'disconnected',
      jiraAccountId: null,
      atlassianAccountId: null,
      sites: [],
    };

    const jiraWorkspaces: any[] = [
      {
        id: 'workspace-uuid-1',
        name: 'Platform Engineering',
        slug: 'platform-eng',
        role: 'admin',
        membershipStatus: 'active',
        workspaceVersion: 1,
        membershipVersion: 1,
      },
      {
        id: 'workspace-uuid-2',
        name: 'Design System Team',
        slug: 'design-system',
        role: 'member',
        membershipStatus: 'active',
        workspaceVersion: 1,
        membershipVersion: 1,
      },
    ];

    let workspaceMembers: any[] = [
      { userId: 'member-user-uuid', role: 'member', status: 'pending', version: 1 },
    ];

    const workspaceInvites: any[] = [];
    const workspaceSites: any[] = [];
    let workspaceCapabilities: any = {
      workspaceId: 'workspace-uuid-1',
      sites: [],
    };

    // Route mocks
    await page.route('**/api/connections/myjira', async (route) => {
      if (route.request().method() === 'GET') {
        if (jiraConnectionStatus === 503) {
          return route.fulfill({
            status: 503,
            json: { error: 'Dịch vụ Jira tạm thời không khả dụng. Vui lòng thử lại sau.', code: 'upstream_unavailable' },
          });
        }
        if (jiraConnectionStatus === 500) {
          return route.fulfill({
            status: 500,
            json: { error: 'Không thể đọc trạng thái kết nối Jira.' },
          });
        }
        if (jiraConnectionStatus === 429) {
          return route.fulfill({
            status: 429,
            json: { error: 'Atlassian đang giới hạn tần suất yêu cầu. Vui lòng thử lại sau.', code: 'upstream_rate_limited' },
          });
        }
        if (jiraConnectionStatus === 403) {
          return route.fulfill({
            status: 403,
            json: { error: 'Bạn không có quyền thực hiện thao tác hoặc truy cập kết nối Jira này.', code: 'FORBIDDEN' },
          });
        }
        if (jiraConnectionStatus === 401) {
          return route.fulfill({
            status: 401,
            json: { error: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.', code: 'INVALID_SESSION' },
          });
        }
        return route.fulfill({ json: jiraConnectionResponse });
      }
      if (route.request().method() === 'DELETE') {
        jiraConnectionResponse = {
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
      const data = route.request().postDataJSON();
      if (data?.code === 'TEST_STALE_SESSION') {
        return route.fulfill({
          status: 401,
          json: { code: 'INVALID_SESSION', error: 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại rồi kết nối Jira.' },
        });
      }
      if (data?.code === 'TEST_ACCOUNT_CHANGED') {
        return route.fulfill({
          status: 400,
          json: { code: 'ACCOUNT_CHANGED', error: 'Không thể đổi tài khoản Atlassian khi chưa ngắt kết nối tài khoản cũ.' },
        });
      }
      if (data?.code === 'TEST_FAIL_CODE') {
        return route.fulfill({
          status: 400,
          json: { code: 'JIRA_CONNECT_FAILED', error: 'Không kết nối được Jira. Vui lòng thử lại.' },
        });
      }
      jiraConnectionResponse = {
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

    await page.route('**/api/jira-workspaces/*/members', async (route) => {
      const url = route.request().url();
      if (url.includes('workspace-uuid-1')) {
        return route.fulfill({ json: { members: workspaceMembers } });
      }
      return route.fulfill({ json: { members: [] } });
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
      const url = route.request().url();
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
      if (url.includes('workspace-uuid-1')) {
        return route.fulfill({ json: { invites: workspaceInvites } });
      }
      return route.fulfill({ json: { invites: [] } });
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

    // --- STEP 1: Verify 500, 429, 403, 503 error states (show "Lỗi kết nối", NOT "Chưa kết nối") ---
    jiraConnectionStatus = 500;
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/settings#jira');

    const jiraCard = page.locator('#jira');
    await expect(jiraCard).toBeVisible();
    await expect(jiraCard.getByText('Lỗi kết nối')).toBeVisible();
    await expect(jiraCard.getByText('Chưa kết nối')).not.toBeVisible();
    await expect(jiraCard.getByText(/Không thể đọc trạng thái kết nối Jira/i)).toBeVisible();
    await expect(jiraCard.locator('#jira-retry-connection')).toBeVisible();

    // Verify 429 rate limit
    jiraConnectionStatus = 429;
    await jiraCard.locator('#jira-retry-connection').click();
    await expect(jiraCard.getByText('Lỗi kết nối')).toBeVisible();
    await expect(jiraCard.getByText('Chưa kết nối')).not.toBeVisible();
    await expect(jiraCard.getByText(/Atlassian đang giới hạn tần suất yêu cầu/i)).toBeVisible();

    // Verify 403 forbidden
    jiraConnectionStatus = 403;
    await jiraCard.locator('#jira-retry-connection').click();
    await expect(jiraCard.getByText('Lỗi kết nối')).toBeVisible();
    await expect(jiraCard.getByText('Chưa kết nối')).not.toBeVisible();
    await expect(jiraCard.getByText(/Bạn không có quyền/i)).toBeVisible();

    // Verify 503 service unavailable
    jiraConnectionStatus = 503;
    await jiraCard.locator('#jira-retry-connection').click();
    await expect(jiraCard.getByText('Lỗi kết nối')).toBeVisible();
    await expect(jiraCard.getByText('Chưa kết nối')).not.toBeVisible();
    await expect(jiraCard.getByText(/Dịch vụ Jira tạm thời không khả dụng/i)).toBeVisible();
    await expect(jiraCard.locator('#jira-retry-connection')).toBeVisible();

    // Recover from 503 to 200 disconnected
    jiraConnectionStatus = 200;
    await jiraCard.locator('#jira-retry-connection').click();
    await expect(jiraCard.getByText('Chưa kết nối')).toBeVisible();
    await expect(jiraCard.getByText('Lỗi kết nối')).not.toBeVisible();
    await expect(jiraCard.locator('#jira-connect')).toBeVisible();

    // --- STEP 2: Connect flow via clicking #jira-connect ---
    await jiraCard.locator('#jira-connect').click();
    // Verifies navigation to callback URL and redirect back to /settings#jira
    await page.waitForURL('**/settings#jira');

    // Verify connected state and notification
    await expect(jiraCard.getByText('Đã kết nối', { exact: true })).toBeVisible();
    await expect(jiraCard.getByText(/Đã kết nối thành công tài khoản Atlassian Jira Administrator/)).toBeVisible();
    await expect(jiraCard.getByText('Tài khoản Atlassian: Jira Administrator', { exact: true })).toBeVisible();
    await expect(jiraCard.getByText('Atlassian Production', { exact: true })).toBeVisible();

    // --- STEP 3: Reload flow ---
    // Reload settings page: maintains connected state
    await page.reload();
    await expect(jiraCard.getByText('Đã kết nối', { exact: true })).toBeVisible();
    await expect(jiraCard.getByText('Tài khoản Atlassian: Jira Administrator', { exact: true })).toBeVisible();

    // Stale/reloaded callback page without OAuth parameters displays safe rejection copy
    await page.goto('/connections/myjira/callback');
    await expect(page.getByText('Yêu cầu kết nối Jira không hợp lệ. Hãy kết nối lại.')).toBeVisible();
    await page.reload();
    await expect(page.getByText('Yêu cầu kết nối Jira không hợp lệ. Hãy kết nối lại.')).toBeVisible();
    await page.getByRole('link', { name: /Về Kết nối dịch vụ/i }).click();
    await page.waitForURL('**/settings#jira');

    // Callback with error parameter
    await page.goto('/connections/myjira/callback?error=access_denied');
    await expect(page.getByText('Bạn đã huỷ kết nối Jira.')).toBeVisible();
    await page.getByRole('link', { name: /Về Kết nối dịch vụ/i }).click();
    await page.waitForURL('**/settings#jira');

    // --- STEP 4: Workspace switch & invite code persistence ---
    // In Workspace 1 (Platform Engineering - Admin): create invite
    await expect(page.getByRole('button', { name: 'Tạo mã mời' })).toBeVisible();
    await page.getByRole('button', { name: 'Tạo mã mời' }).click();
    await expect(page.getByText('ATI_INVITE_TOKEN_SECRET_9999')).toBeVisible();

    // Approve pending member in Workspace 1
    await expect(page.getByRole('button', { name: 'Duyệt' })).toBeVisible();
    await page.getByRole('button', { name: 'Duyệt' }).click();

    // Link site in Workspace 1
    await expect(page.getByRole('button', { name: 'Liên kết site' })).toBeVisible();
    await page.getByRole('button', { name: 'Liên kết site' }).click();
    await expect(page.getByText('ATI — ATI Platform')).toBeVisible();

    // Now switch to Workspace 2 (Design System Team - Member)
    await page.locator('#jira-workspace-select').selectOption('workspace-uuid-2');

    // Verify: Workspace 1's invite token is GONE!
    await expect(page.getByText('ATI_INVITE_TOKEN_SECRET_9999')).not.toBeVisible();
    // Verify: Admin buttons from Workspace 1 are NOT visible on Workspace 2
    await expect(page.getByRole('button', { name: 'Tạo mã mời' })).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Liên kết site' })).not.toBeVisible();

    // Switch back to Workspace 1
    await page.locator('#jira-workspace-select').selectOption('workspace-uuid-1');
    await expect(page.getByRole('button', { name: 'Tạo mã mời' })).toBeVisible();
    // Invite token was one-time and must remain gone
    await expect(page.getByText('ATI_INVITE_TOKEN_SECRET_9999')).not.toBeVisible();

    // --- STEP 5: Stale tab & Account switch in callback view ---
    // Account changed error (ACCOUNT_CHANGED): displays error alert and prevents invalid switch
    await page.goto('/connections/myjira/callback?code=TEST_ACCOUNT_CHANGED&state=TEST_ACCOUNT_CHANGED');
    await expect(page.getByText('Không thể đổi tài khoản Atlassian khi chưa ngắt kết nối tài khoản cũ.')).toBeVisible();
    await expect(page).toHaveURL(/\/connections\/myjira\/callback/);

    await page.getByRole('link', { name: /Về Kết nối dịch vụ/i }).click();
    await page.waitForURL('**/settings#jira');

    // Stale session (401 INVALID_SESSION): clears stored session and displays session expired dialog
    await page.goto('/connections/myjira/callback?code=TEST_STALE_SESSION&state=TEST_STALE_SESSION');
    await expect(page.getByRole('dialog', { name: /Chào mừng bạn quay lại/i })).toBeVisible();
    await expect(page.getByText('Phiên đăng nhập đã hết hạn')).toBeVisible();

    // --- STEP 6: CTA guard & Responsive (375px) & Dark Mode ---
    await page.goto('/settings#jira');
    const ctaButton = page.getByRole('button', { name: /Bắt đầu hội thoại Jira \(Chờ JIRA-08\)/i });
    await expect(ctaButton).toBeDisabled();
    await expect(page.getByText(/chờ hoàn tất JIRA-08/i)).toBeVisible();

    // Mobile Viewport (375px) check
    await page.setViewportSize({ width: 375, height: 667 });
    await expect(page.locator('#jira')).toBeVisible();
    await expect(page.getByText('Atlassian Jira Cloud')).toBeVisible();

    // Dark Mode check
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('#jira')).toBeVisible();

    // Verify external network boundary was respected
    expect(externalRequests).toEqual([]);
  });
});
