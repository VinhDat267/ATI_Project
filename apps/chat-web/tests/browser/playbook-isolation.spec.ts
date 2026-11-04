import { test, expect } from '@playwright/test';

for (const viewport of [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 375, height: 812 },
] as const) {
  test(`FLOW-02 & FLOW-03: Playbook account/workspace isolation and template variable preservation (${viewport.name})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    // Seed legacy v1 key and User A auth session before loading the page
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'ati_custom_playbooks_v1',
        JSON.stringify([
          {
            id: 'legacy-1',
            title: 'Playbook cũ chưa định danh',
            prompt: 'Gửi báo cáo cũ',
            services: ['slack'],
          },
        ]),
      );
      window.localStorage.setItem('wap_access_token', 'tok-user-a');
      window.localStorage.setItem('wap_refresh_token', 'ref-user-a');
      window.localStorage.setItem(
        'wap_user',
        JSON.stringify({
          id: 'user_a',
          email: 'user.a@example.com',
          name: 'User A',
          role: 'member',
        }),
      );
    });

    // Mock API endpoints so Cockpit renders Moment 1 deterministically
    await page.route('**/api/runtime', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          runtimeMode: 'sandbox',
          schedulesEnabled: true,
          gmailEnabled: true,
          mycalendarEnabled: true,
          mysheetsEnabled: true,
          myslackEnabled: true,
          myslackWritesEnabled: true,
        }),
      });
    });

    await page.route('**/api/services', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          canConfigure: true,
          services: [
            { id: 'mycalendar', name: 'Google Calendar', configured: true, connected: true, connectionStatus: 'healthy' },
            { id: 'mysheets', name: 'Google Sheets', configured: true, connected: true, connectionStatus: 'healthy' },
            { id: 'gmail', name: 'Gmail', configured: true, connected: true, connectionStatus: 'healthy' },
            { id: 'github', name: 'GitHub', configured: true, connected: true, connectionStatus: 'healthy' },
            { id: 'myslack', name: 'Slack', configured: true, connected: true, connectionStatus: 'healthy' },
          ],
        }),
      });
    });

    await page.route('**/api/conversations**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ conversations: [], nextCursor: null }),
      });
    });

    await page.route('**/api/workspaces', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ workspaces: [], activeWorkspaceId: 'personal' }),
      });
    });

    await page.route('**/api/schedules/pending-count', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ count: 0 }),
      });
    });

    await page.goto('/');

    const textarea = page.getByRole('textbox', { name: 'Mô tả công việc bạn muốn thực hiện' });
    await expect(textarea).toBeVisible();

    // Verify legacy v1 playbook was quarantined and not shown to User A
    await expect(page.getByText('Playbook cũ chưa định danh')).toHaveCount(0);
    const quarantined = await page.evaluate(() => ({
      legacy: window.localStorage.getItem('ati_custom_playbooks_v1'),
      quarantine: window.localStorage.getItem('planora_playbooks_quarantine_v1'),
    }));
    expect(quarantined.legacy).toBeNull();
    expect(quarantined.quarantine).toContain('Playbook cũ chưa định danh');

    // User A types a customized template with a variable and saves it
    await textarea.fill('Họp dự án {{tên_dự_án}} — CHỈ GỬI HẠNH');
    await expect(page.getByTestId('playbook-variables-bar')).toBeVisible();

    // Fill variable and check Template vs Preview tabs
    await page.getByLabel('Biến số tên_dự_án').fill('Planora Q4');
    await page.getByTestId('tab-preview-mode').click();
    await expect(textarea).toHaveValue('Họp dự án Planora Q4 — CHỈ GỬI HẠNH');
    await page.getByTestId('tab-template-mode').click();
    await expect(textarea).toHaveValue('Họp dự án {{tên_dự_án}} — CHỈ GỬI HẠNH');

    // Save as User A's custom playbook
    await page.getByTestId('btn-save-playbook').click();
    await page.getByLabel('Tên Playbook 1-Click').fill('Playbook mật của A');
    await page.getByTestId('btn-confirm-save-playbook').click();

    await expect(page.getByTestId('custom-playbooks-section')).toBeVisible();
    await expect(page.getByText('Playbook mật của A')).toBeVisible();

    // Switch account to User B in the same browser -> User A's playbook must not be visible
    await page.evaluate(() => {
      window.localStorage.setItem('wap_access_token', 'tok-user-b');
      window.localStorage.setItem('wap_refresh_token', 'ref-user-b');
      window.localStorage.setItem(
        'wap_user',
        JSON.stringify({
          id: 'user_b',
          email: 'user.b@example.com',
          name: 'User B',
          role: 'member',
        }),
      );
      window.dispatchEvent(new StorageEvent('storage', { key: 'wap_user' }));
    });

    await expect(page.getByText('Playbook mật của A')).toHaveCount(0);
  });
}
