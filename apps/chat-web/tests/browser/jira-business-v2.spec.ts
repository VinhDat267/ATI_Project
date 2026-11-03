import { test, expect } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:5174' });

test.describe('JIRA Business-Ready v2 & 6-Pillar UI/UX E2E Suite', () => {
  test('Scenario 1: Self-service workspace onboarding, 3-step progress bar, invite copy, project reminder, and 1-click context sync to Cockpit Moment 1', async ({
    page,
  }) => {
    const externalRequests: string[] = [];
    await page.route(/atlassian\.com|api\.atlassian\.com/, (route) => {
      externalRequests.push(route.request().url());
      return route.abort('blockedbyclient');
    });

    const adminJwtPayload = btoa(
      JSON.stringify({ type: 'access', sub: 'admin-user-uuid', sid: 'session-uuid-1' }),
    );
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
          }),
        );
      },
      { token: adminToken },
    );

    const jiraWorkspaces: any[] = [];
    const workspaceSites: any[] = [];
    let workspaceProjects: any[] = [];
    let workspaceCapabilities: any = {
      workspaceId: 'ws-self-service-1',
      sites: [],
    };

    await page.route('**/api/**', async (route) => {
      return route.fulfill({
        status: 200,
        json: {
          connected: false,
          workspaces: [],
          services: [],
          schedulesEnabled: true,
          runtimeMode: 'sandbox',
        },
      });
    });

    await page.route('**/api/connections/myjira', async (route) => {
      return route.fulfill({
        json: {
          connected: true,
          connectionState: 'connected',
          jiraAccountId: 'jira-acc-prod-1',
          atlassianAccountId: 'atl-acc-prod-1',
          displayName: 'Jira Tech Lead',
          sites: [
            {
              cloudId: 'cloud-site-1',
              name: 'Atlassian Production',
              url: 'https://ati-prod.atlassian.net',
            },
          ],
        },
      });
    });

    await page.route('**/api/jira-workspaces', async (route) => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        const created = {
          id: 'ws-self-service-1',
          name: body?.name || 'Platform Triage Team',
          slug: 'platform-triage-team',
          role: 'admin',
          membershipStatus: 'active',
          workspaceVersion: 1,
          membershipVersion: 1,
        };
        jiraWorkspaces.push(created);
        return route.fulfill({ status: 201, json: { workspace: created } });
      }
      return route.fulfill({ json: { workspaces: jiraWorkspaces } });
    });

    await page.route('**/api/jira-workspaces/*/members', async (route) => {
      return route.fulfill({ json: { members: [] } });
    });

    await page.route('**/api/jira-workspaces/*/invites', async (route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({
          json: {
            inviteId: 'inv-self-1',
            inviteToken: 'ATI_SELF_SERVICE_INVITE_2026',
            expiresAt: '2026-12-31T00:00:00Z',
          },
        });
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
        workspaceProjects = [
          {
            projectId: '10001',
            key: 'ATI',
            name: 'ATI Platform',
            selected: false,
            policyVersion: 1,
          },
        ];
        return route.fulfill({ status: 201, json: { site: newSite } });
      }
      return route.fulfill({ json: { sites: workspaceSites } });
    });

    await page.route('**/api/jira-workspaces/*/jira-sites/*/projects', async (route) => {
      if (route.request().method() === 'PUT') {
        const body = route.request().postDataJSON();
        const selectedIds: string[] = body?.projectIds ?? body?.selectedProjectIds ?? [];
        workspaceProjects = workspaceProjects.map((p) => ({
          ...p,
          selected: selectedIds.includes(p.projectId),
        }));
        workspaceCapabilities = {
          workspaceId: 'ws-self-service-1',
          sites: selectedIds.includes('10001')
            ? [
                {
                  siteId: 'site-uuid-linked-1',
                  cloudId: 'cloud-site-1',
                  name: 'Atlassian Production',
                  url: 'https://ati-prod.atlassian.net',
                  projects: [{ id: '10001', key: 'ATI', name: 'ATI Platform' }],
                },
              ]
            : [],
        };
        return route.fulfill({ json: { sitePolicyVersion: 1, projects: workspaceProjects } });
      }
      return route.fulfill({ json: { sitePolicyVersion: 1, projects: workspaceProjects } });
    });

    await page.route('**/api/jira-workspaces/*/jira-capabilities', async (route) => {
      return route.fulfill({ json: workspaceCapabilities });
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
            {
              id: 'gmail',
              name: 'Gmail',
              connected: true,
              configured: true,
              personalStatus: 'connected',
            },
            {
              id: 'slack',
              name: 'Slack',
              connected: true,
              configured: true,
            },
          ],
          canConfigure: true,
          personalOAuth: ['myjira', 'gmail'],
        },
      });
    });

    await page.route('**/api/runtime', async (route) => {
      return route.fulfill({
        json: {
          runtimeMode: 'sandbox',
          myjiraEnabled: true,
          schedulesEnabled: true,
        },
      });
    });

    await page.route('**/api/conversations', async (route) => {
      return route.fulfill({ json: { conversations: [] } });
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/settings#jira');

    // 1. Verify 3-step setup progress bar is visible when connected with 0 workspaces
    const setupSteps = page.getByTestId('jira-setup-steps');
    await expect(setupSteps).toBeVisible();
    await expect(setupSteps).toContainText('Bước 1: Tài khoản Atlassian');
    await expect(setupSteps).toContainText('Bước 2: Jira Workspace');
    await expect(setupSteps).toContainText('Bước 3: Site & Projects');

    // 2. Self-service create Jira Workspace
    await page
      .getByPlaceholder('Tên Jira Workspace mới (ví dụ: Team Kỹ thuật)...')
      .fill('Platform Triage Team');
    await page.getByRole('button', { name: 'Tạo Jira Workspace mới' }).click();
    await expect(page.getByText(/Đã tạo Jira Workspace "Platform Triage Team" thành công/i)).toBeVisible();

    // 3. Generate invite token and test 1-click Copy button
    await page.getByRole('button', { name: 'Tạo mã mời' }).click();
    await expect(page.getByText('ATI_SELF_SERVICE_INVITE_2026')).toBeVisible();
    const copyBtn = page.getByTestId('jira-copy-invite-token');
    await expect(copyBtn).toBeVisible();
    await copyBtn.click();
    await expect(copyBtn).toContainText('Đã sao chép');

    // 4. Link site -> verify inline project reminder appears when 0 projects are selected
    await page.getByRole('button', { name: 'Liên kết site' }).click();
    await expect(page.getByText('Cần chọn ít nhất 1 Project')).toBeVisible();
    await expect(page.locator('#jira-start-conversation')).toBeDisabled();

    // 5. Select project ATI and save -> CTA becomes enabled
    await page.getByRole('button', { name: 'Cấu hình Projects' }).click();
    await page.getByRole('checkbox').first().check();
    await page.getByRole('button', { name: 'Lưu danh sách projects' }).click();
    await expect(page.getByText('ATI — ATI Platform')).toBeVisible();

    const startCta = page.locator('#jira-start-conversation');
    await expect(startCta).toBeEnabled();
    await startCta.click();
    await page.waitForURL('http://127.0.0.1:5174/');

    // 6. Verify workspace-storage was synced and Cockpit Moment 1 displays Jira Ready Pill + Multi-Service Playbooks
    const storedWorkspaceId = await page.evaluate(() => {
      return (
        window.localStorage.getItem('wap_active_workspace_id:admin-user-uuid') ??
        window.localStorage.getItem('wap_active_workspace_id')
      );
    });
    expect(storedWorkspaceId).toBe('ws-self-service-1');

    const readyPill = page.getByTestId('jira-context-ready-pill');
    await expect(readyPill).toBeVisible();
    await expect(readyPill).toContainText('Jira OAuth 3LO: Sẵn sàng');

    const playbooks = page.getByTestId('multi-service-playbooks');
    await expect(playbooks).toBeVisible();
    await expect(
      playbooks.getByText('Xử lý lỗi khách hàng & điều phối Jira Sprint'),
    ).toBeVisible();

    expect(externalRequests).toEqual([]);
  });

  test('Scenario 2: Full Triage Lifecycle in Cockpit Moment 4 (inline pills + preview modal) and Moment 6 (receipt metrics)', async ({
    page,
  }) => {
    const externalRequests: string[] = [];
    await page.route(/atlassian\.com|api\.atlassian\.com/, (route) => {
      externalRequests.push(route.request().url());
      return route.abort('blockedbyclient');
    });

    const adminJwtPayload = btoa(
      JSON.stringify({ type: 'access', sub: 'admin-user-uuid', sid: 'session-uuid-1' }),
    );
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
          }),
        );
      },
      { token: adminToken },
    );

    const convId = '22222222-2222-4222-8222-222222222222';
    const planId = 'plan-jira-triage-v2';
    let planApproved = false;

    const myjiraBinding = {
      atiUserId: 'admin-user-uuid',
      jiraAccountId: 'jira-acc-prod-1',
      atlassianAccountId: 'atl-acc-prod-1',
      workspaceId: 'ws-self-service-1',
      workspaceVersion: 1,
      membershipVersion: 1,
      grantId: 'grant-e2e-2',
      identityVersion: 1,
      siteSteps: {
        s1: {
          siteId: 'site-uuid-linked-1',
          cloudId: 'cloud-site-1',
          sitePolicyVersion: 1,
          projectId: '10001',
          projectPolicyVersion: 1,
        },
        s2: {
          siteId: 'site-uuid-linked-1',
          cloudId: 'cloud-site-1',
          sitePolicyVersion: 1,
          projectId: '10001',
          projectPolicyVersion: 1,
        },
        s3: {
          siteId: 'site-uuid-linked-1',
          cloudId: 'cloud-site-1',
          sitePolicyVersion: 1,
          projectId: '10001',
          projectPolicyVersion: 1,
        },
      },
    };

    const steps = [
      {
        id: 's1',
        tool: 'myjira.create_issue',
        description: 'Tạo Bug khẩn cấp cho cổng thanh toán',
        args: {
          siteId: 'site-uuid-linked-1',
          projectKey: 'ATI',
          issueType: 'Bug',
          summary: 'Lỗi timeout cổng thanh toán 3DS',
          description: 'Khách hàng gặp lỗi 504 khi xác thực OTP',
          priority: 'High',
          assigneeAccountId: 'acc-dev-1',
          dueDate: '2026-12-31',
          parentKey: 'ATI-10',
          labels: ['urgent', 'payment'],
        },
      },
      {
        id: 's2',
        tool: 'myjira.transition_issue',
        description: 'Chuyển trạng thái ATI-101 sang In Progress',
        args: {
          siteId: 'site-uuid-linked-1',
          issueKey: 'ATI-101',
          targetStatus: 'In Progress',
          comment: 'Đã nhận xử lý nóng trong Sprint hiện tại',
        },
      },
      {
        id: 's3',
        tool: 'myjira.update_issue',
        description: 'Nâng độ ưu tiên ATI-101 lên Highest',
        args: {
          siteId: 'site-uuid-linked-1',
          issueKey: 'ATI-101',
          priority: 'Highest',
          dueDate: '2026-12-31',
          labels: ['hotfix', 'p0'],
        },
      },
    ];

    const activePlanPayload = {
      id: planId,
      status: 'pending',
      summary: 'Tạo, chuyển trạng thái và cập nhật issue Jira',
      steps,
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
        json: {
          connected: true,
          workspaces: [],
          services: [],
          schedulesEnabled: true,
          runtimeMode: 'sandbox',
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
        json: { runtimeMode: 'sandbox', myjiraEnabled: true, schedulesEnabled: true },
      });
    });

    await page.route('**/api/conversations', async (route) => {
      return route.fulfill({
        json: {
          conversations: [
            { id: convId, title: 'Triage lỗi thanh toán', updatedAt: new Date().toISOString() },
          ],
        },
      });
    });

    await page.route(`**/api/conversations/${convId}`, async (route) => {
      return route.fulfill({
        json: {
          conversation: {
            id: convId,
            title: 'Triage lỗi thanh toán',
            updatedAt: new Date().toISOString(),
          },
          messages: [
            {
              id: 'msg-u-1',
              role: 'user',
              content: 'Tạo Bug thanh toán, chuyển ATI-101 sang In Progress và nâng ưu tiên Highest',
              createdAt: new Date().toISOString(),
            },
            {
              id: 'msg-p-1',
              role: 'assistant',
              content: 'Kế hoạch xử lý Jira đã sẵn sàng',
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
          plan: { ...activePlanPayload, status: 'completed' },
          execution: { status: 'completed' },
          steps: [
            {
              stepId: 's1',
              tool: 'myjira.create_issue',
              status: 'succeeded',
              durationMs: 310,
              startedAt: new Date(Date.now() - 900).toISOString(),
              completedAt: new Date(Date.now() - 590).toISOString(),
              output: {
                id: '20001',
                key: 'ATI-101',
                summary: 'Lỗi timeout cổng thanh toán 3DS',
                status: 'To Do',
                priority: 'High',
                issueType: 'Bug',
                url: 'https://ati-prod.atlassian.net/browse/ATI-101',
              },
            },
            {
              stepId: 's2',
              tool: 'myjira.transition_issue',
              status: 'succeeded',
              durationMs: 280,
              startedAt: new Date(Date.now() - 580).toISOString(),
              completedAt: new Date(Date.now() - 300).toISOString(),
              output: {
                key: 'ATI-101',
                newStatus: 'In Progress',
                transitionId: '21',
                commentAdded: true,
                url: 'https://ati-prod.atlassian.net/browse/ATI-101',
              },
            },
            {
              stepId: 's3',
              tool: 'myjira.update_issue',
              status: 'succeeded',
              durationMs: 250,
              startedAt: new Date(Date.now() - 290).toISOString(),
              completedAt: new Date().toISOString(),
              output: {
                key: 'ATI-101',
                updatedFields: ['priority', 'duedate', 'labels'],
                priority: 'Highest',
                dueDate: '2026-12-31',
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

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/c/${convId}`);

    // 1. Verify Moment 4 inline step pills
    await expect(page.locator('#moment-4')).toBeVisible();
    const stepPills = page.getByTestId('myjira-step-pills');
    await expect(stepPills).toHaveCount(3);
    await expect(stepPills.nth(0)).toContainText('🏷️ Bug');
    await expect(stepPills.nth(0)).toContainText('⚡ Ưu tiên: High');
    await expect(stepPills.nth(0)).toContainText('👤 Phụ trách: acc-dev-1');
    await expect(stepPills.nth(0)).toContainText('📅 Hạn: 2026-12-31');
    await expect(stepPills.nth(0)).toContainText('🔗 Epic: ATI-10');
    await expect(stepPills.nth(1)).toContainText('🎫 ATI-101');
    await expect(stepPills.nth(1)).toContainText('🔄 → In Progress');

    // 2. Open Preview Modal for s1 (create_issue) and s2 (transition_issue)
    await page.locator('#preview-s1').click();
    await expect(page.getByText('Lỗi timeout cổng thanh toán 3DS')).toBeVisible();
    await expect(page.getByTestId('myjira-preview-badges')).toContainText('🔗 Epic/Parent: ATI-10');
    await expect(page.getByTestId('myjira-preview-badges')).toContainText('⚡ Ưu tiên: High');
    await page.keyboard.press('Escape');

    await page.locator('#preview-s2').click();
    await expect(page.getByTestId('myjira-preview-badges')).toContainText('🔄 Chuyển sang: In Progress');
    await expect(page.getByText('Đã nhận xử lý nóng trong Sprint hiện tại')).toBeVisible();
    await page.keyboard.press('Escape');

    // 3. Approve plan and verify Moment 6 Receipt Metrics
    await page.locator('#btn-approve-plan').click();
    await expect(page.locator('#moment-6')).toBeVisible({ timeout: 10000 });

    const receiptMetrics = page.getByTestId('myjira-receipt-metrics');
    await expect(receiptMetrics.first()).toBeVisible();
    await expect(page.getByText('🔄 Trạng thái: In Progress')).toBeVisible();
    await expect(page.getByText('✏️ Đã cập nhật: priority, duedate, labels')).toBeVisible();
    await expect(page.getByText('⚡ Ưu tiên: Highest')).toBeVisible();

    expect(externalRequests).toEqual([]);
  });

  test('Scenario 3: Moment 8 unknown write recovery link, ScheduleMoment myjira_digest UI, and Guide 1-Click showcase card', async ({
    page,
  }) => {
    const externalRequests: string[] = [];
    await page.route(/atlassian\.com|api\.atlassian\.com/, (route) => {
      externalRequests.push(route.request().url());
      return route.abort('blockedbyclient');
    });

    const adminJwtPayload = btoa(
      JSON.stringify({ type: 'access', sub: 'admin-user-uuid', sid: 'session-uuid-1' }),
    );
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
          }),
        );
      },
      { token: adminToken },
    );

    const convRecoveryId = '33333333-3333-4333-8333-333333333333';
    const convScheduleId = '44444444-4444-4444-8444-444444444444';

    await page.route('**/api/**', async (route) => {
      return route.fulfill({
        status: 200,
        json: {
          connected: true,
          workspaces: [],
          services: [],
          schedulesEnabled: true,
          runtimeMode: 'sandbox',
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
        json: { runtimeMode: 'sandbox', myjiraEnabled: true, schedulesEnabled: true },
      });
    });

    await page.route('**/api/conversations', async (route) => {
      return route.fulfill({
        json: {
          conversations: [
            { id: convRecoveryId, title: 'Recovery Jira', updatedAt: new Date().toISOString() },
            { id: convScheduleId, title: 'Standup Digest Jira', updatedAt: new Date().toISOString() },
          ],
        },
      });
    });

    // Conversation 1: Moment 8 (unknown write state on myjira.transition_issue)
    const recoveryPlan = {
      id: 'plan-recovery-jira',
      status: 'needs_attention',
      summary: 'Chuyển trạng thái issue ATI-101',
      steps: [
        {
          id: 's1',
          tool: 'myjira.transition_issue',
          description: 'Chuyển trạng thái ATI-101 sang Done',
          args: {
            siteId: 'site-uuid-linked-1',
            issueKey: 'ATI-101',
            transitionName: 'Done',
          },
        },
      ],
    };

    await page.route(`**/api/conversations/${convRecoveryId}`, async (route) => {
      return route.fulfill({
        json: {
          conversation: {
            id: convRecoveryId,
            title: 'Recovery Jira',
            updatedAt: new Date().toISOString(),
          },
          messages: [
            {
              id: 'msg-r-1',
              role: 'user',
              content: 'Chuyển ATI-101 sang Done',
              createdAt: new Date().toISOString(),
            },
          ],
        },
      });
    });

    await page.route(`**/api/conversations/${convRecoveryId}/plans/active`, async (route) => {
      return route.fulfill({ status: 404, json: { error: 'Not found' } });
    });

    await page.route(`**/api/conversations/${convRecoveryId}/executions/latest`, async (route) => {
      return route.fulfill({
        json: {
          plan: recoveryPlan,
          execution: { status: 'needs_attention' },
          steps: [
            {
              stepId: 's1',
              tool: 'myjira.transition_issue',
              status: 'unknown',
              durationMs: 15000,
              error: 'Timeout chờ phản hồi từ Atlassian Jira Cloud',
            },
          ],
          recoveryActions: ['mark_succeeded', 'retry', 'abort'],
        },
      });
    });

    await page.route(`**/api/conversations/${convRecoveryId}/stream`, async (route) => {
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
        body: ': connected\n\n',
      });
    });

    // Conversation 2: ScheduleMoment with myjira_digest proposal & confirmation
    await page.route(`**/api/conversations/${convScheduleId}`, async (route) => {
      return route.fulfill({
        json: {
          conversation: {
            id: convScheduleId,
            title: 'Standup Digest Jira',
            updatedAt: new Date().toISOString(),
          },
          messages: [
            {
              id: 'msg-s-1',
              role: 'user',
              content: 'Mỗi sáng 9h tổng hợp blocker Jira dự án ATI gửi vào #standup-eng',
              createdAt: new Date().toISOString(),
            },
            {
              id: 'msg-s-2',
              role: 'assistant',
              content: 'Đề xuất lịch bản tin Standup Jira',
              createdAt: new Date().toISOString(),
              metadata: {
                type: 'schedule_proposal',
                services: ['myjira', 'slack'],
                proposal: {
                  kind: 'schedule',
                  action: 'create',
                  name: 'Bản tin Standup Jira',
                  request: 'Mỗi sáng 9h tổng hợp blocker Jira dự án ATI gửi vào #standup-eng',
                  recurrence: { type: 'daily', time: '09:00' },
                  summary: 'Tự động tổng hợp Standup & Blocker Jira mỗi sáng',
                },
                digestCandidate: {
                  kind: 'myjira_digest',
                  canAutoDigest: true,
                  config: {
                    workspaceId: 'ws-self-service-1',
                    grantId: 'grant-1',
                    atlassianAccountId: 'atl-acc-prod-1',
                    projects: [
                      {
                        siteId: 'site-1',
                        siteName: 'Atlassian Production',
                        projectKey: 'ATI',
                        projectName: 'ATI Platform',
                      },
                    ],
                    channelId: 'C12345',
                    channelName: 'standup-eng',
                  },
                },
              },
            },
          ],
        },
      });
    });

    await page.route(`**/api/conversations/${convScheduleId}/plans/active`, async (route) => {
      return route.fulfill({ status: 404, json: { error: 'Not found' } });
    });

    await page.route(`**/api/conversations/${convScheduleId}/executions/latest`, async (route) => {
      return route.fulfill({ status: 404, json: { error: 'Not found' } });
    });

    await page.route(
      `**/api/conversations/${convScheduleId}/schedule-proposals/msg-s-2/confirm`,
      async (route) => {
        return route.fulfill({
        json: {
          schedule: {
            id: 'sched-jira-1',
            convId: convScheduleId,
            version: 1,
            name: 'Bản tin Standup Jira',
            request: 'Mỗi sáng 9h tổng hợp blocker Jira dự án ATI gửi vào #standup-eng',
            recurrence: { type: 'daily', time: '09:00' },
            services: ['myjira', 'slack'],
            status: 'active',
            pauseReason: null,
            nextRuns: ['2026-11-04T02:00:00.000Z'],
            lastRun: null,
            kind: 'myjira_digest',
            approvalMode: 'auto_digest',
            digest: {
              config: {
                workspaceId: 'ws-self-service-1',
                grantId: 'grant-1',
                atlassianAccountId: 'atl-acc-prod-1',
                projects: [
                  {
                    siteId: 'site-1',
                    siteName: 'Atlassian Production',
                    projectKey: 'ATI',
                    projectName: 'ATI Platform',
                  },
                ],
                channelId: 'C12345',
                channelName: 'standup-eng',
              },
              approvedAt: '2026-11-03T10:00:00.000Z',
            },
          },
        },
      });
    });

    await page.route(`**/api/conversations/${convScheduleId}/stream`, async (route) => {
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
        body: ': connected\n\n',
      });
    });

    await page.setViewportSize({ width: 1440, height: 900 });

    // 1. Verify Moment 8 Unknown Write Recovery Link
    await page.goto(`/c/${convRecoveryId}`);
    await expect(page.locator('#moment-8')).toBeVisible();
    const recoveryLink = page.getByRole('link', { name: 'Mở Jira kiểm tra' });
    await expect(recoveryLink).toBeVisible();
    await expect(recoveryLink).toHaveAttribute('href', 'https://www.atlassian.com/software/jira');

    // 2. Verify ScheduleMoment myjira_digest UI & confirm auto_digest
    await page.goto(`/c/${convScheduleId}`);
    await expect(
      page.getByText('Tự gửi bản tin Standup & Blocker Jira, không cần duyệt lại'),
    ).toBeVisible();
    await expect(page.getByText(/Dự án Jira: Atlassian Production · ATI/)).toBeVisible();
    await expect(page.getByText(/Kênh Slack: #standup-eng/)).toBeVisible();
    await page.locator('#schedule-mode-auto-digest').check();
    await page.getByRole('button', { name: 'Xác nhận và bật tự gửi' }).click();
    await expect(page.locator('[data-schedule-kind="myjira_digest"]')).toContainText('Tự gửi');

    // 3. Verify /guide?service=jira OAuth 3LO 1-Click Showcase Card
    await page.goto('/guide?service=jira');
    await expect(page.getByText('Atlassian Jira Cloud')).toBeVisible();
    const connectJiraCta = page.getByRole('link', { name: 'Kết nối Jira 1-Click →' });
    await expect(connectJiraCta).toBeVisible();
    await expect(connectJiraCta).toHaveAttribute('href', '/settings#jira');

    expect(externalRequests).toEqual([]);
  });
});
