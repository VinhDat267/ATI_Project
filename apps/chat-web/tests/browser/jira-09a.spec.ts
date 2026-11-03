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
    let holdInviteResponse = false;
    let onInviteHeld: () => void = () => {};
    let onInviteRelease: () => void = () => {};

    // Route mocks (register fallback first so specific routes below take precedence)
    await page.route('**/api/**', async (route) => {
      return route.fulfill({
        status: 200,
        json: { connected: false, workspaces: [], services: [], schedulesEnabled: false, runtimeMode: 'sandbox' },
      });
    });

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
        if (holdInviteResponse) {
          onInviteHeld();
          await new Promise<void>((resolve) => {
            onInviteRelease = resolve;
          });
          holdInviteResponse = false;
          const delayedInvite = {
            id: 'inv-delayed-1',
            workspaceId: 'workspace-uuid-1',
            inviterUserId: 'admin-user-uuid',
            expiresAt: '2026-11-09T00:00:00Z',
          };
          workspaceInvites.push(delayedInvite);
          return route.fulfill({
            json: {
              inviteId: 'inv-delayed-1',
              inviteToken: 'DELAYED_INVITE_TOKEN_FOR_WS1',
              expiresAt: '2026-11-09T00:00:00Z',
            },
          });
        }
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

    // Recover from 503 to 200 scope_required
    jiraConnectionStatus = 200;
    jiraConnectionResponse = {
      connected: false,
      connectionState: 'scope_required',
      jiraAccountId: 'jira-acc-prod-1',
      atlassianAccountId: 'atl-acc-prod-1',
      displayName: 'Jira Administrator',
      sites: [],
    };
    await jiraCard.locator('#jira-retry-connection').click();
    await expect(jiraCard.getByText('Cần cấp quyền site')).toBeVisible();
    await expect(jiraCard.getByText('Tài khoản Atlassian: Jira Administrator', { exact: true })).toBeVisible();
    await expect(jiraCard.getByText('atl-acc-prod-1', { exact: true })).toBeVisible();
    await expect(jiraCard.locator('#jira-authorize-sites')).toBeVisible();

    // Transition to 200 disconnected for connect flow
    jiraConnectionResponse = {
      connected: false,
      connectionState: 'disconnected',
      jiraAccountId: null,
      atlassianAccountId: null,
      sites: [],
    };
    await page.reload();
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

    // Test holding in-flight invite creation response across workspace switch:
    // 1. Prepare synchronization promises
    const inviteHeldPromise = new Promise<void>((resolve) => {
      onInviteHeld = resolve;
    });
    const inviteResponsePromise = page.waitForResponse((res) =>
      res.url().includes('/api/jira-workspaces') &&
      res.url().includes('/invites') &&
      res.request().method() === 'POST'
    );

    // 2. Click "Tạo mã mời" on Workspace 1 and wait until POST is definitely held
    holdInviteResponse = true;
    await page.getByRole('button', { name: 'Tạo mã mời' }).click();
    await inviteHeldPromise; // Guaranteed that POST was dispatched and is now held in-flight

    // 3. Switch to Workspace 2 while invite creation is still held in-flight
    await page.locator('#jira-workspace-select').selectOption('workspace-uuid-2');
    await expect(page.getByText('Design System Team', { exact: true })).toBeVisible();

    // 4. Release held response and wait until browser actually receives the response
    onInviteRelease();
    await inviteResponsePromise; // Guaranteed that response was received and processed

    // 5. Verify the delayed invite token NEVER appears on Workspace 2
    await expect(page.getByText('DELAYED_INVITE_TOKEN_FOR_WS1')).not.toBeVisible();

    // 6. Switch back to Workspace 1 and verify clean state
    await page.locator('#jira-workspace-select').selectOption('workspace-uuid-1');
    await expect(page.getByRole('button', { name: 'Tạo mã mời' })).toBeVisible();
    await expect(page.getByText('DELAYED_INVITE_TOKEN_FOR_WS1')).not.toBeVisible();

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
    const enabledCta = page.locator('#jira-start-conversation');
    await expect(enabledCta).toBeEnabled();
    await expect(enabledCta).toHaveText('Bắt đầu hội thoại Jira');

    workspaceCapabilities = { workspaceId: 'workspace-uuid-1', sites: [] };
    await page.reload();
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

  test('JIRA-10C: exercises #jira-start-conversation -> Cockpit preview -> approve -> receipt with myjira binding', async ({
    page,
  }) => {
    const externalRequests: string[] = [];
    await page.route(/atlassian\.com|api\.atlassian\.com/, (route) => {
      externalRequests.push(route.request().url());
      return route.abort('blockedbyclient');
    });

    const adminJwtPayload = btoa(JSON.stringify({ type: 'access', sub: 'admin-user-uuid', sid: 'session-uuid-1' }));
    const adminToken = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${adminJwtPayload}.sig`;

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

    const convId = '11111111-1111-4111-8111-111111111111';
    const planId = 'plan-jira-e2e-1';
    let planApproved = false;

    const myjiraBinding = {
      atiUserId: 'admin-user-uuid',
      jiraAccountId: 'jira-acc-prod-1',
      atlassianAccountId: 'atl-acc-prod-1',
      workspaceId: 'workspace-uuid-1',
      workspaceVersion: 1,
      membershipVersion: 1,
      grantId: 'grant-e2e-1',
      identityVersion: 1,
      siteSteps: {
        s1: {
          siteId: 'site-uuid-linked-1',
          cloudId: 'cloud-site-1',
          sitePolicyVersion: 1,
          projectId: '10001',
          projectPolicyVersion: 1,
        },
      },
    };

    const planStep = {
      id: 's1',
      tool: 'myjira.create_issue',
      description: 'Tạo issue sửa lỗi OAuth 3LO trên dự án ATI',
      args: {
        siteId: 'site-uuid-linked-1',
        projectKey: 'ATI',
        issueType: 'Bug',
        summary: 'Sửa lỗi OAuth 3LO',
        description: 'Chi tiết lỗi đăng nhập Atlassian',
      },
    };

    const activePlanPayload = {
      id: planId,
      status: 'pending',
      summary: 'Tạo issue trên dự án ATI',
      steps: [planStep],
      resourceLabels: {
        'jira_site:site-uuid-linked-1': 'Atlassian Production',
        'jira_project:ATI': 'ATI Platform (ATI)',
      },
      connections: {
        myjira: myjiraBinding,
      },
    };

    await page.route('**/api/**', async (route) => {
      return route.fulfill({
        status: 200,
        json: { connected: false, workspaces: [], services: [], schedulesEnabled: false, runtimeMode: 'sandbox' },
      });
    });

    await page.route('**/api/connections/myjira', async (route) => {
      return route.fulfill({
        json: {
          connected: true,
          connectionState: 'connected',
          jiraAccountId: 'jira-acc-prod-1',
          atlassianAccountId: 'atl-acc-prod-1',
          displayName: 'Jira Administrator',
          sites: [{ cloudId: 'cloud-site-1', name: 'Atlassian Production', url: 'https://ati-prod.atlassian.net' }],
        },
      });
    });

    await page.route('**/api/jira-workspaces', async (route) => {
      return route.fulfill({
        json: {
          workspaces: [
            {
              id: 'workspace-uuid-1',
              name: 'Platform Engineering',
              slug: 'platform-eng',
              role: 'admin',
              membershipStatus: 'active',
              workspaceVersion: 1,
              membershipVersion: 1,
            },
          ],
        },
      });
    });

    await page.route('**/api/jira-workspaces/*/members', async (route) => {
      return route.fulfill({ json: { members: [] } });
    });

    await page.route('**/api/jira-workspaces/*/invites', async (route) => {
      return route.fulfill({ json: { invites: [] } });
    });

    await page.route('**/api/jira-workspaces/*/jira-sites', async (route) => {
      return route.fulfill({
        json: {
          sites: [
            {
              siteId: 'site-uuid-linked-1',
              cloudId: 'cloud-site-1',
              name: 'Atlassian Production',
              url: 'https://ati-prod.atlassian.net',
              active: true,
              policyVersion: 1,
            },
          ],
        },
      });
    });

    await page.route('**/api/jira-workspaces/*/jira-capabilities', async (route) => {
      return route.fulfill({
        json: {
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
        },
      });
    });

    await page.route('**/api/services', async (route) => {
      return route.fulfill({
        json: {
          services: [
            {
              id: 'myjira',
              name: 'Atlassian Jira',
              connected: true,
              configured: true,
              personalStatus: 'connected',
            },
          ],
          canConfigure: true,
          personalOAuth: ['myjira'],
        },
      });
    });

    await page.route('**/api/runtime', async (route) => {
      return route.fulfill({
        json: {
          runtimeMode: 'sandbox',
          myjiraEnabled: true,
        },
      });
    });

    await page.route('**/api/conversations', async (route) => {
      return route.fulfill({
        json: {
          conversations: [{ id: convId, title: 'Tạo issue Jira', updatedAt: new Date().toISOString() }],
        },
      });
    });

    await page.route(`**/api/conversations/${convId}`, async (route) => {
      return route.fulfill({
        json: {
          conversation: { id: convId, title: 'Tạo issue Jira', updatedAt: new Date().toISOString() },
          messages: [
            {
              id: 'msg-user-1',
              role: 'user',
              content: 'Tạo issue Bug sửa lỗi OAuth 3LO trên dự án ATI',
              createdAt: new Date().toISOString(),
            },
            {
              id: 'msg-plan-1',
              role: 'assistant',
              content: 'Kế hoạch Tạo issue trên dự án ATI sẵn sàng',
              createdAt: new Date().toISOString(),
              metadata: {
                type: 'plan',
                planId,
                plan: activePlanPayload,
              },
            },
          ],
        },
      });
    });

    await page.route(`**/api/conversations/${convId}/plans/active`, async (route) => {
      if (planApproved) {
        return route.fulfill({ status: 404, json: { error: 'Not found' } });
      }
      return route.fulfill({ json: activePlanPayload });
    });

    await page.route(`**/api/conversations/${convId}/executions/latest`, async (route) => {
      if (!planApproved) {
        return route.fulfill({ status: 404, json: { error: 'Not found' } });
      }
      return route.fulfill({
        json: {
          plan: {
            ...activePlanPayload,
            status: 'completed',
          },
          execution: {
            status: 'completed',
          },
          steps: [
            {
              stepId: 's1',
              tool: 'myjira.create_issue',
              status: 'succeeded',
              durationMs: 420,
              startedAt: new Date(Date.now() - 420).toISOString(),
              completedAt: new Date().toISOString(),
              output: {
                id: '20001',
                key: 'ATI-101',
                url: 'https://ati-prod.atlassian.net/browse/ATI-101',
              },
            },
          ],
          recoveryActions: [],
        },
      });
    });

    await page.route(`**/api/conversations/${convId}/stream`, async (route) => {
      const body = planApproved
        ? `id: 1:1\nevent: exec_done\ndata: ${JSON.stringify({ planId, status: 'completed' })}\n\n`
        : ': connected\n\n';
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
        body,
      });
    });

    await page.route(`**/api/plans/${planId}/approve`, async (route) => {
      planApproved = true;
      return route.fulfill({ json: { status: 'approved', planId } });
    });

    // 1. Start at /settings#jira and click #jira-start-conversation
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/settings#jira');
    const startCta = page.locator('#jira-start-conversation');
    await expect(startCta).toBeEnabled();
    await startCta.click();
    await page.waitForURL('http://127.0.0.1:5174/');

    // 2. Open conversation in Cockpit Moment 4 (Plan preview)
    await page.goto(`/c/${convId}`);
    await expect(page.locator('#moment-4')).toBeVisible();
    await expect(page.getByText(/Tài khoản Atlassian: atl-acc-prod-1 · Workspace: workspace-uuid-1/i)).toBeVisible();
    await expect(page.getByText(/Site đích: Atlassian Production · Dự án: ATI/i)).toBeVisible();

    // 3. Open step preview modal and verify myjira details
    await page.locator('#preview-s1').click();
    await expect(page.getByText('Sửa lỗi OAuth 3LO', { exact: true })).toBeVisible();
    await expect(page.getByText('Chi tiết lỗi đăng nhập Atlassian', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');

    // 4. Approve plan and verify Moment 6 (Receipt) with Jira deep link
    await page.locator('#btn-approve-plan').click();
    await expect(page.getByText('ATI-101', { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/Tài khoản Atlassian: atl-acc-prod-1 · Workspace: workspace-uuid-1/i)).toBeVisible();
    await expect(page.getByText(/Site đích: Atlassian Production · Dự án: ATI/i)).toBeVisible();
    const jiraLink = page.getByRole('link', { name: /Mở trong Jira/i });
    await expect(jiraLink).toBeVisible();
    await expect(jiraLink).toHaveAttribute('href', 'https://ati-prod.atlassian.net/browse/ATI-101');

    expect(externalRequests).toEqual([]);
  });
});
