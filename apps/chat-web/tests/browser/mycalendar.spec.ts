import { test, expect, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(process.env.CHAT_ADMIN_EMAIL!);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(process.env.CHAT_ADMIN_PASSWORD!);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hôm nay bạn muốn nhờ việc gì?');
}

test('MYCALENDAR off: settings and health omit mycalendar and start endpoint returns 404', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Google Calendar của bạn')).toHaveCount(0);
  await login(page);
  await page.goto('/settings');
  await expect(page.locator('#service-row-mycalendar')).toHaveCount(0);
  await expect(page.locator('#mycalendar')).toHaveCount(0);

  // Check GET /api/health does not contain mycalendarEnabled
  const healthRes = await page.request.get('/api/health');
  expect(healthRes.ok()).toBe(true);
  const healthJson = await healthRes.json();
  expect(healthJson.mycalendarEnabled).toBeUndefined();

  const token = await page.evaluate(() => localStorage.getItem('wap_access_token'));
  // Check POST /api/connections/mycalendar/start returns 404
  const startRes = await page.request.post('/api/connections/mycalendar/start', {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(startRes.status()).toBe(404);
});

test('MYCALENDAR: Flow 1 - connect from settings, select scope, re-select scope', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));

  await login(page);
  const token = await page.evaluate(() => localStorage.getItem('wap_access_token'));
  await page.request.delete('/api/connections/mycalendar', { headers: { Authorization: `Bearer ${token}` } });

  await page.goto('/settings#mycalendar');
  const row = page.locator('#service-row-mycalendar');
  await expect(row).toBeVisible();
  await expect(row).toContainText('Chưa kết nối');

  // Connect from settings
  await row.getByRole('button', { name: 'Kết nối Google Calendar', exact: true }).click();

  // Redirected through fake Google to callback
  await expect(page.getByRole('heading', { name: /Chọn lịch Google Calendar/i })).toBeVisible();
  expect(new URL(page.url()).search).toBe('');

  // Primary calendar is pre-checked, read-only calendar is not shown
  const primaryCheckbox = page.getByRole('checkbox', { name: /Lịch chính/i });
  await expect(primaryCheckbox).toBeChecked();
  await expect(page.getByText('Ngày lễ Việt Nam')).toHaveCount(0);

  // Check secondary calendar (Lịch việc riêng)
  const workCheckbox = page.getByRole('checkbox', { name: 'Lịch việc riêng' });
  await expect(workCheckbox).not.toBeChecked();
  await workCheckbox.check();
  await expect(workCheckbox).toBeChecked();

  // Save scope (without returnTo -> lands on /settings#mycalendar)
  const saveBtn = page.getByRole('button', { name: 'Lưu lịch được dùng', exact: true });
  await expect(saveBtn).toBeVisible();
  await saveBtn.click();

  await expect(page).toHaveURL(/.*\/settings.*#mycalendar/);
  await expect(row).toContainText('Đã kết nối');
  await expect(row).toContainText('Lịch chính');
  await expect(row).toContainText('Lịch việc riêng');

  // Re-select scope
  await row.getByRole('button', { name: 'Chọn lại lịch được dùng', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Chọn lịch Google Calendar/i })).toBeVisible();

  // Both should be checked now
  await expect(page.getByRole('checkbox', { name: /Lịch chính/i })).toBeChecked();
  const workCheckbox2 = page.getByRole('checkbox', { name: 'Lịch việc riêng' });
  await expect(workCheckbox2).toBeChecked();

  // Uncheck secondary calendar and save
  await workCheckbox2.uncheck();
  await page.getByRole('button', { name: 'Lưu lịch được dùng', exact: true }).click();

  await expect(page).toHaveURL(/.*\/settings.*#mycalendar/);
  await expect(row).toContainText('Đã kết nối');
  await expect(row).toContainText('Lịch chính');

  expect(pageErrors).toEqual([]);
});

test('MYCALENDAR: Flow 2 - disconnect, connect from chat refusal, plan and receipt', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));

  await login(page);
  const token = await page.evaluate(() => localStorage.getItem('wap_access_token'));
  await page.request.delete('/api/connections/mycalendar', { headers: { Authorization: `Bearer ${token}` } });

  // Go to chat and request personal calendar while disconnected
  await page.goto('/');
  await page.getByRole('textbox').fill('Thêm lịch họp 15h ngày mai vào lịch việc riêng của tôi');
  await page.getByRole('button', { name: 'Gửi yêu cầu', exact: true }).click();

  await page.waitForURL(/\/c\/[0-9a-f-]{36}/);
  const conversationUrl = page.url();

  // RefusalMoment should render
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tôi chưa làm được yêu cầu này');
  const connectBtn = page.getByRole('link', { name: /Kết nối Google Calendar/i });
  await expect(connectBtn).toBeVisible();

  // Click connect from chat (passes returnTo)
  await connectBtn.click();

  // Redirected to callback
  await expect(page.getByRole('heading', { name: /Chọn lịch Google Calendar/i })).toBeVisible();

  // Check Lịch việc riêng
  const workCheckbox = page.getByRole('checkbox', { name: 'Lịch việc riêng' });
  await workCheckbox.check();

  // Save button says "Lưu lịch được dùng & quay lại hội thoại"
  const saveReturnBtn = page.getByRole('button', { name: 'Lưu lịch được dùng & quay lại hội thoại', exact: true });
  await expect(saveReturnBtn).toBeVisible();
  await saveReturnBtn.click();

  // Lands back on conversation URL
  await expect(page).toHaveURL(conversationUrl);

  // RefusalMoment shows status update and "Gửi lại yêu cầu"
  await expect(page.getByText(/Google Calendar của bạn đã được kết nối\. Bạn có thể gửi lại yêu cầu\./i)).toBeVisible();
  const resendBtn = page.getByRole('button', { name: 'Gửi lại yêu cầu', exact: true });
  await expect(resendBtn).toBeVisible();

  // Click "Gửi lại yêu cầu"
  await resendBtn.click();

  // PlanMoment displays plan with resolved calendar and connected account
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tôi sẽ làm 1 việc, theo thứ tự');
  await expect(page.getByText(/Google Calendar của bạn\)/i)).toBeVisible();
  const approvedAccount = await page.getByText(/^Tài khoản: .+ \(Google Calendar của bạn\)$/).innerText();
  await expect(page.locator('#plan-cards-container p').filter({ hasText: 'Đích đến:' })).toContainText('Lịch việc riêng');

  // Approve plan
  await page.getByRole('button', { name: 'Duyệt kế hoạch', exact: true }).click();

  // ReceiptMoment renders
  await expect(page.locator('#moment-6')).toBeVisible();
  await expect(page.locator('#moment-6').getByText(approvedAccount, { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Mở sự kiện trên Google Calendar' })).toBeVisible();

  expect(pageErrors).toEqual([]);
});

test('MYCALENDAR: Flow 3 - scope_required state recovery from refusal without re-running OAuth', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));

  await login(page);
  const token = await page.evaluate(() => localStorage.getItem('wap_access_token'));
  await page.request.delete('/api/connections/mycalendar', { headers: { Authorization: `Bearer ${token}` } });

  // Initiate conversation to get a refusal
  await page.goto('/');
  await page.getByRole('textbox').fill('Thêm lịch họp 15h ngày mai vào lịch việc riêng của tôi');
  await page.getByRole('button', { name: 'Gửi yêu cầu', exact: true }).click();
  await page.waitForURL(/\/c\/[0-9a-f-]{36}/);
  const conversationUrl = page.url();

  // Click Connect
  await page.getByRole('link', { name: /Kết nối Google Calendar/i }).click();

  // Once callback page opens, OAuth callback completed -> state is now scope_required in database
  await expect(page.getByRole('heading', { name: /Chọn lịch Google Calendar/i })).toBeVisible();

  // User navigates back to conversation without saving scope
  await page.goto(conversationUrl);

  // RefusalMoment now displays scope_required status
  await expect(page.getByText(/Đã cấp quyền · Chưa chọn lịch/i)).toBeVisible();
  const selectScopeLink = page.getByRole('link', { name: /Chọn lịch Google Calendar/i });
  await expect(selectScopeLink).toBeVisible();

  // Clicking "Chọn lịch Google Calendar" navigates directly to callback?mode=select without Google consent
  await selectScopeLink.click();
  await expect(page.getByRole('heading', { name: /Chọn lịch Google Calendar/i })).toBeVisible();

  // Select calendar and save
  const workCheckbox = page.getByRole('checkbox', { name: 'Lịch việc riêng' });
  await workCheckbox.check();
  await page.getByRole('button', { name: 'Lưu lịch được dùng & quay lại hội thoại', exact: true }).click();

  // Back in conversation, connected and ready to resend
  await expect(page).toHaveURL(conversationUrl);
  await expect(page.getByRole('button', { name: 'Gửi lại yêu cầu', exact: true })).toBeVisible();

  expect(pageErrors).toEqual([]);
});

for (const width of [1440, 375]) {
  for (const theme of ['light', 'dark']) {
    test(`MYCALENDAR: Flow 4 - viewports ${width}x${width === 375 ? 812 : 900} in ${theme} mode`, async ({ page }) => {
      const pageErrors: Error[] = [];
      page.on('pageerror', (err) => pageErrors.push(err));

      const height = width === 375 ? 812 : 900;
      await page.setViewportSize({ width, height });
      await page.addInitScript((val) => localStorage.setItem('ati-theme', val), theme);

      await login(page);

      // Verify Settings page has zero overflow
      await page.goto('/settings#mycalendar');
      await expect(page.locator('#service-row-mycalendar')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      // Verify Callback page has zero overflow
      await page.goto('/connections/mycalendar/callback?mode=select');
      await expect(page.getByRole('heading', { name: /Chọn lịch Google Calendar/i })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      expect(pageErrors).toEqual([]);
    });
  }
}
