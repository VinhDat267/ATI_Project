import { createHash } from 'node:crypto';
import pg from 'pg';
import { test, expect, type Page } from '@playwright/test';
import {
  fixtureConversation,
  fixtureMessage,
  certifyFixturePlan,
} from './persisted-artifacts.fixture.js';

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
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tôi sẽ làm 1 việc');
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

      // Verify Privacy page Google Calendar disclosure and zero overflow across desktop/mobile & light/dark
      await page.goto('/privacy#mycalendar');
      const privacyCalRegion = page.getByRole('region', { name: /Dữ liệu Google Calendar/i });
      await expect(privacyCalRegion).toBeVisible();
      await expect(privacyCalRegion).toContainText('calendar.readonly');
      await expect(privacyCalRegion).toContainText('calendar.events');
      await expect(privacyCalRegion).not.toContainText('calendar.calendarlist.readonly');
      await expect(privacyCalRegion).not.toContainText('sẽ bị thu hồi hoàn toàn');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      expect(pageErrors).toEqual([]);
    });
  }
}

test('MYCALENDAR: Flow 5 - 1-click primary calendar, rich PlanMoment pills, conflict free-slot 1-click, calendar-event-preview modal, and Google Meet join link on ReceiptMoment', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));

  await login(page);
  const token = await page.evaluate(() => localStorage.getItem('wap_access_token'));
  await page.request.delete('/api/connections/mycalendar', { headers: { Authorization: `Bearer ${token}` } });

  // 1. Connect from Settings and use 1-Click Primary Calendar Quick-Select (#mycalendar-quick-primary)
  await page.goto('/settings#mycalendar');
  const row = page.locator('#service-row-mycalendar');
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Kết nối Google Calendar', exact: true }).click();

  await expect(page.getByRole('heading', { name: /Chọn lịch Google Calendar/i })).toBeVisible();
  const quickPrimaryBtn = page.locator('#mycalendar-quick-primary');
  await expect(quickPrimaryBtn).toBeVisible();
  await quickPrimaryBtn.click();

  await expect(page).toHaveURL(/.*\/settings.*#mycalendar/);
  await expect(row).toContainText('Đã kết nối');
  await expect(row).toContainText('Lịch chính');

  // 2. Request a recurring Daily Standup with Google Meet on personal calendar
  await page.goto('/');
  await page.getByRole('textbox').fill('Tạo lịch họp Daily Standup kèm Google Meet lặp lại các ngày trong tuần vào lịch của tôi');
  await page.getByRole('button', { name: 'Gửi yêu cầu', exact: true }).click();

  await page.waitForURL(/\/c\/[0-9a-f-]{36}/);

  // 3. PlanMoment renders quick feature pills & interactive conflict banner
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tôi sẽ làm 1 việc');
  const stepCard = page.locator('#plan-cards-container article').first();
  await expect(stepCard).toContainText('🎥 Google Meet');
  await expect(stepCard).toContainText('🔁 Thứ 2 – Thứ 6 hàng tuần');
  await expect(stepCard).toContainText('📍 Phòng họp Tầng 5');
  await expect(stepCard).not.toContainText('Gửi email mời họp');

  const conflictBanner = page.getByTestId('calendar-conflict-banner');
  await expect(conflictBanner).toBeVisible();
  const slotBtn = conflictBanner.getByRole('button', { name: 'Đổi sang 10:30–11:30' });
  await expect(slotBtn).toBeVisible();
  await slotBtn.click();

  // Clicking 1-click free slot opens inline composer prefilled with the slot change instruction
  const inlineTextarea = page.locator('#moment-4-sticky-bar textarea');
  await expect(inlineTextarea).toBeVisible();
  await expect(inlineTextarea).toHaveValue('Đổi khung giờ họp sang 10:30–11:30');

  // 4. Click "Xem trước" on the step card -> verify calendar-event-preview modal
  await stepCard.getByRole('button', { name: 'Xem trước' }).click();
  const previewCard = page.getByTestId('calendar-event-preview');
  await expect(previewCard).toBeVisible();
  await expect(previewCard).toContainText('Daily Standup Kỹ thuật');
  await expect(previewCard).toContainText('🎥 Tự động tạo phòng họp Google Meet');
  await expect(previewCard).toContainText('🔁 Lặp lại: Thứ 2 – Thứ 6 hàng tuần');
  await expect(previewCard).toContainText('📍 Phòng họp Tầng 5');
  await expect(previewCard).toContainText('Cập nhật tiến độ Sprint');
  await expect(previewCard).not.toContainText('Gửi email mời họp');

  // Close PreviewModal
  await page.getByRole('dialog').getByRole('button', { name: /Đóng/i }).first().click();
  await expect(previewCard).toHaveCount(0);

  // 5. Approve plan -> ReceiptMoment renders both Google Calendar link & direct Google Meet join button
  await page.getByRole('button', { name: 'Duyệt kế hoạch', exact: true }).click();
  await expect(page.locator('#moment-6')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Mở sự kiện trên Google Calendar' })).toBeVisible();
  const meetJoinLink = page.getByRole('link', { name: /Tham gia Google Meet/i });
  await expect(meetJoinLink).toBeVisible();
  await expect(meetJoinLink).toHaveAttribute('href', /https:\/\/meet\.google\.com\/ati-meet-/);

  expect(pageErrors).toEqual([]);
});

interface FixtureStats {
  writes: number;
  apiRequests: Array<{
    method: string;
    path: string;
    query: Record<string, string>;
    body?: Record<string, any>;
  }>;
}

async function clearFixtureApiRequests(fixtureBaseUrl: string) {
  const res = await fetch(`${fixtureBaseUrl}/__stats/requests`, { method: 'DELETE' });
  expect(res.ok).toBe(true);
}

async function readFixtureStats(fixtureBaseUrl: string): Promise<FixtureStats> {
  const res = await fetch(`${fixtureBaseUrl}/__stats`);
  expect(res.ok).toBe(true);
  return (await res.json()) as FixtureStats;
}

async function ensurePrimaryCalendarConnected(page: Page, db: pg.Pool) {
  const token = await page.evaluate(() => localStorage.getItem('wap_access_token'));
  expect(token).toBeTruthy();
  await page.request.delete('/api/connections/mycalendar', {
    headers: { Authorization: `Bearer ${token}` },
  });

  await page.goto('/settings#mycalendar');
  const row = page.locator('#service-row-mycalendar');
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Kết nối Google Calendar', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Chọn lịch Google Calendar/i })).toBeVisible();
  await page.locator('#mycalendar-quick-primary').click();
  await expect(page).toHaveURL(/.*\/settings.*#mycalendar/);
  await expect(row).toContainText('Đã kết nối');
  await expect(row).toContainText('Lịch chính');

  const userRow = await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [
    process.env.CHAT_ADMIN_EMAIL!,
  ]);
  const userId = userRow.rows[0]!.id;
  const credRow = await db.query<{ id: string }>(
    "SELECT id FROM service_credentials WHERE service = 'mycalendar' AND user_id = $1 AND status = 'active'",
    [userId],
  );
  const credentialId = credRow.rows[0]!.id;
  const servicesRes = await page.request.get('/api/services', {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(servicesRes.ok()).toBe(true);
  const servicesJson = await servicesRes.json();
  const mycalSvc = (servicesJson.services as Array<any>).find((s) => s.id === 'mycalendar');
  const calendarEmail = String(mycalSvc?.email || 'gmail-owner@example.test');
  return {
    userId,
    credentialId,
    calendarEmail,
    allowedCalendars: [calendarEmail],
  };
}

async function seedCertifiedCalendarPlan(
  db: pg.Pool,
  params: {
    userId: string;
    credentialId: string;
    calendarEmail: string;
    allowedCalendars: string[];
    title: string;
    userPrompt: string;
    summary: string;
    step: {
      id: string;
      tool: 'mycalendar.create_event' | 'mycalendar.update_event' | 'mycalendar.schedule_meet';
      description: string;
      args: Record<string, unknown>;
    };
  },
) {
  const convId = await fixtureConversation(db, params.userId, params.title);
  await fixtureMessage(db, convId, 'user', params.userPrompt);
  const planJson = {
    kind: 'plan',
    thinking: 'Kiểm chứng hợp đồng hiển thị và thực thi Google Calendar cá nhân.',
    summary: params.summary,
    warnings: [],
    steps: [{ ...params.step, dependsOn: [] }],
    connections: {
      mycalendar: {
        credentialId: params.credentialId,
        email: params.calendarEmail,
        allowedCalendars: params.allowedCalendars,
      },
    },
  };
  const resourceLabels = { [params.calendarEmail]: 'Lịch chính' };
  const planText = JSON.stringify(planJson);
  const planHash = createHash('sha256').update(planText).digest('hex');
  const inserted = await db.query<{ id: string }>(
    `INSERT INTO plans (conv_id, plan_json, plan_text, plan_hash, status, expires_at, resource_labels)
     VALUES ($1, $2::jsonb, $3, $4, 'pending', now() + interval '30 minutes', $5::jsonb)
     RETURNING id`,
    [convId, planText, planText, planHash, JSON.stringify(resourceLabels)],
  );
  const planId = inserted.rows[0]!.id;
  await certifyFixturePlan(db, planId);
  await fixtureMessage(db, convId, 'assistant', `Kế hoạch: ${params.summary}`, {
    type: 'plan',
    planId,
    plan: planJson,
    resourceLabels,
  });
  return { convId, planId };
}

test('MYCALENDAR: Flow 6 - C1/DST real Chromium cross-midnight & America/New_York DST spring-forward recurring event with PlanMoment, PreviewModal, and outbound fixture instant/timeZone proof', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const fixtureBaseUrl = process.env.MYCALENDAR_API_BASE_URL!;
  expect(fixtureBaseUrl).toBeTruthy();

  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));

  await login(page);
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const conn = await ensurePrimaryCalendarConnected(page, db);

    // Part A: Cross-midnight event in explicit non-default IANA zone (America/New_York)
    // 2026-11-12T23:15:00-05:00 -> 2026-11-13T00:45:00-05:00 (UTC 2026-11-13T04:15:00Z -> 05:45:00Z)
    await clearFixtureApiRequests(fixtureBaseUrl);
    const crossMidnight = await seedCertifiedCalendarPlan(db, {
      ...conn,
      title: 'C1 Cross-Midnight America/New_York',
      userPrompt: 'Tạo lịch trực xuyên đêm theo giờ New York từ 23:15 ngày 12/11 đến 00:45 ngày 13/11/2026',
      summary: 'Tạo lịch trực vận hành xuyên đêm (America/New_York)',
      step: {
        id: 'step_c1_cross_midnight',
        tool: 'mycalendar.create_event',
        description: 'Tạo lịch trực vận hành xuyên đêm NY',
        args: {
          calendarId: conn.calendarEmail,
          summary: 'Trực vận hành xuyên đêm NY',
          start: '2026-11-12T23:15:00-05:00',
          end: '2026-11-13T00:45:00-05:00',
          timeZone: 'America/New_York',
          location: 'War Room B',
        },
      },
    });

    await page.goto(`/c/${crossMidnight.convId}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tôi sẽ làm 1 việc');
    const cardA = page.locator('#plan-cards-container article').first();
    const inlinePayloadA = cardA.getByTestId('step-inline-payload');
    await expect(inlinePayloadA).toContainText('23:15');
    await expect(inlinePayloadA).toContainText('12/11/2026');
    await expect(inlinePayloadA).toContainText('00:45');
    await expect(inlinePayloadA).toContainText('13/11/2026');
    await expect(cardA).toContainText('🌐 Múi giờ: America/New_York');
    await expect(cardA).toContainText('📍 War Room B');

    await cardA.getByRole('button', { name: 'Xem trước' }).click();
    const previewA = page.getByTestId('calendar-event-preview');
    await expect(previewA).toBeVisible();
    await expect(previewA).toContainText('23:15');
    await expect(previewA).toContainText('12/11/2026');
    await expect(previewA).toContainText('00:45');
    await expect(previewA).toContainText('13/11/2026');
    await expect(previewA).toContainText('Múi giờ: America/New_York');
    await page.getByRole('dialog').getByRole('button', { name: /Đóng/i }).first().click();
    await expect(previewA).toHaveCount(0);

    await page.getByRole('button', { name: 'Duyệt kế hoạch', exact: true }).click();
    await expect(page.locator('#moment-6')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Mở sự kiện trên Google Calendar' })).toBeVisible();

    const statsA = await readFixtureStats(fixtureBaseUrl);
    const postA = statsA.apiRequests.find(
      (r) => r.method === 'POST' && r.path === `calendars/${conn.calendarEmail}/events`,
    );
    expect(postA).toBeDefined();
    expect(postA!.query.sendUpdates).toBe('none');
    expect(postA!.body?.start).toEqual({
      dateTime: '2026-11-12T23:15:00-05:00',
      timeZone: 'America/New_York',
    });
    expect(postA!.body?.end).toEqual({
      dateTime: '2026-11-13T00:45:00-05:00',
      timeZone: 'America/New_York',
    });
    expect(Date.parse(postA!.body!.start.dateTime)).toBe(Date.parse('2026-11-13T04:15:00Z'));
    expect(Date.parse(postA!.body!.end.dateTime)).toBe(Date.parse('2026-11-13T05:45:00Z'));

    // Part B: DST spring-forward boundary in America/New_York (2026-03-08 01:30 EST -05:00 -> 03:30 EDT -04:00)
    // combined with recurring RRULE start.timeZone & end.timeZone provider contract
    await clearFixtureApiRequests(fixtureBaseUrl);
    const writesBeforeB = statsA.writes;
    const dstRecurring = await seedCertifiedCalendarPlan(db, {
      ...conn,
      title: 'C1 DST Spring-Forward Recurring America/New_York',
      userPrompt: 'Tạo lịch họp chuyển giờ mùa hè New York 08/03/2026 lặp lại 3 tuần',
      summary: 'Tạo lịch họp định kỳ qua mốc DST America/New_York',
      step: {
        id: 'step_c1_dst_rrule',
        tool: 'mycalendar.create_event',
        description: 'Tạo lịch họp qua mốc DST mùa xuân New York',
        args: {
          calendarId: conn.calendarEmail,
          summary: 'Đồng bộ chuyển giờ mùa hè NY',
          start: '2026-03-08T01:30:00-05:00',
          end: '2026-03-08T03:30:00-04:00',
          timeZone: 'America/New_York',
          recurrence: 'RRULE:FREQ=WEEKLY;COUNT=3',
        },
      },
    });

    await page.goto(`/c/${dstRecurring.convId}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tôi sẽ làm 1 việc');
    const cardB = page.locator('#plan-cards-container article').first();
    const inlinePayloadB = cardB.getByTestId('step-inline-payload');
    await expect(inlinePayloadB).toContainText('01:30');
    await expect(inlinePayloadB).toContainText('03:30');
    await expect(inlinePayloadB).toContainText('08/03/2026');
    await expect(cardB).toContainText('🌐 Múi giờ: America/New_York');
    await expect(cardB).toContainText('🔁 Hàng tuần, 3 lần');

    await cardB.getByRole('button', { name: 'Xem trước' }).click();
    const previewB = page.getByTestId('calendar-event-preview');
    await expect(previewB).toBeVisible();
    await expect(previewB).toContainText('01:30');
    await expect(previewB).toContainText('03:30');
    await expect(previewB).toContainText('08/03/2026');
    await expect(previewB).toContainText('Múi giờ: America/New_York');
    await expect(previewB).toContainText('🔁 Lặp lại: Hàng tuần, 3 lần');
    await page.getByRole('dialog').getByRole('button', { name: /Đóng/i }).first().click();
    await expect(previewB).toHaveCount(0);

    await page.getByRole('button', { name: 'Duyệt kế hoạch', exact: true }).click();
    await expect(page.locator('#moment-6')).toBeVisible();

    const statsB = await readFixtureStats(fixtureBaseUrl);
    expect(statsB.writes).toBe(writesBeforeB + 1);
    const postB = statsB.apiRequests.find(
      (r) => r.method === 'POST' && r.path === `calendars/${conn.calendarEmail}/events`,
    );
    expect(postB).toBeDefined();
    expect(postB!.query.sendUpdates).toBe('none');
    expect(postB!.body?.recurrence).toEqual(['RRULE:FREQ=WEEKLY;COUNT=3']);
    expect(postB!.body?.start).toEqual({
      dateTime: '2026-03-08T01:30:00-05:00',
      timeZone: 'America/New_York',
    });
    expect(postB!.body?.end).toEqual({
      dateTime: '2026-03-08T03:30:00-04:00',
      timeZone: 'America/New_York',
    });
    expect(Date.parse(postB!.body!.end.dateTime) - Date.parse(postB!.body!.start.dateTime)).toBe(
      3_600_000,
    );
  } finally {
    await db.end();
  }

  expect(pageErrors).toEqual([]);
});

test('MYCALENDAR: Flow 7 - C2 real Chromium invitation & existing-attendee notification disclosures and sendInvites omitted/false/true outbound sendUpdates parity', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const fixtureBaseUrl = process.env.MYCALENDAR_API_BASE_URL!;
  expect(fixtureBaseUrl).toBeTruthy();

  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));

  await login(page);
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const conn = await ensurePrimaryCalendarConnected(page, db);

    const cases: Array<{
      label: string;
      tool: 'mycalendar.create_event' | 'mycalendar.update_event';
      args: Record<string, unknown>;
      expectedCardInclude: string[];
      expectedCardExclude: string[];
      expectedPreviewInclude: string[];
      expectedPreviewExclude: string[];
      expectedMethod: 'POST' | 'PATCH';
      expectedPath: string;
      expectedSendUpdates: 'all' | 'none';
      expectedAttendees?: Array<{ email: string }>;
    }> = [
      {
        label: 'create_event with new attendees and sendInvites omitted -> sendUpdates=none',
        tool: 'mycalendar.create_event',
        args: {
          calendarId: conn.calendarEmail,
          summary: 'Họp kiến trúc (không gửi thư)',
          start: '2026-11-14T09:00:00+07:00',
          end: '2026-11-14T10:00:00+07:00',
          timeZone: 'Asia/Ho_Chi_Minh',
          attendees: ['alice@example.test', 'bob@example.test'],
        },
        expectedCardInclude: ['👥 2 khách mời', '🔕 Không gửi email mời họp'],
        expectedCardExclude: ['📨 Gửi email mời họp'],
        expectedPreviewInclude: [
          '👤 alice@example.test',
          '👤 bob@example.test',
          '🔕 Không gửi email mời họp',
        ],
        expectedPreviewExclude: ['📨 Gửi email mời họp'],
        expectedMethod: 'POST',
        expectedPath: `calendars/${conn.calendarEmail}/events`,
        expectedSendUpdates: 'none',
        expectedAttendees: [{ email: 'alice@example.test' }, { email: 'bob@example.test' }],
      },
      {
        label: 'create_event with new attendee and sendInvites=false -> sendUpdates=none',
        tool: 'mycalendar.create_event',
        args: {
          calendarId: conn.calendarEmail,
          summary: 'Họp nội bộ (tắt gửi thư)',
          start: '2026-11-14T11:00:00+07:00',
          end: '2026-11-14T12:00:00+07:00',
          timeZone: 'Asia/Ho_Chi_Minh',
          attendees: ['alice@example.test'],
          sendInvites: false,
        },
        expectedCardInclude: ['👥 1 khách mời', '🔕 Không gửi email mời họp'],
        expectedCardExclude: ['📨 Gửi email mời họp'],
        expectedPreviewInclude: ['👤 alice@example.test', '🔕 Không gửi email mời họp'],
        expectedPreviewExclude: ['📨 Gửi email mời họp'],
        expectedMethod: 'POST',
        expectedPath: `calendars/${conn.calendarEmail}/events`,
        expectedSendUpdates: 'none',
        expectedAttendees: [{ email: 'alice@example.test' }],
      },
      {
        label: 'create_event with new attendees and sendInvites=true -> sendUpdates=all',
        tool: 'mycalendar.create_event',
        args: {
          calendarId: conn.calendarEmail,
          summary: 'Họp nghiệm thu khách hàng',
          start: '2026-11-14T14:00:00+07:00',
          end: '2026-11-14T15:00:00+07:00',
          timeZone: 'Asia/Ho_Chi_Minh',
          attendees: ['Client@Example.test', 'pm@example.test'],
          sendInvites: true,
        },
        expectedCardInclude: ['👥 2 khách mời', '📨 Gửi email mời họp'],
        expectedCardExclude: ['🔕 Không gửi email mời họp'],
        expectedPreviewInclude: [
          '👤 Client@Example.test',
          '👤 pm@example.test',
          '📨 Gửi email mời họp cho khách mời',
        ],
        expectedPreviewExclude: ['🔕 Không gửi email mời họp'],
        expectedMethod: 'POST',
        expectedPath: `calendars/${conn.calendarEmail}/events`,
        expectedSendUpdates: 'all',
        expectedAttendees: [{ email: 'client@example.test' }, { email: 'pm@example.test' }],
      },
      {
        label: 'update_event on existing meeting with sendInvites=true and omitted attendees -> discloses existing-attendee notifications and sends PATCH sendUpdates=all',
        tool: 'mycalendar.update_event',
        args: {
          calendarId: conn.calendarEmail,
          eventId: 'evt-existing-guests-1',
          summary: 'Họp giao ban (Đổi giờ & báo khách mời hiện có)',
          start: '2026-11-14T16:00:00+07:00',
          end: '2026-11-14T17:00:00+07:00',
          timeZone: 'Asia/Ho_Chi_Minh',
          sendInvites: true,
        },
        expectedCardInclude: [
          '📨 Gửi thông báo cập nhật cho khách mời hiện có và danh sách khách mời sau thay đổi',
        ],
        expectedCardExclude: ['🔕 Không gửi email mời họp'],
        expectedPreviewInclude: [
          '📨 Gửi thông báo cập nhật cho khách mời hiện có và danh sách khách mời sau thay đổi',
        ],
        expectedPreviewExclude: ['🔕 Không gửi email mời họp'],
        expectedMethod: 'PATCH',
        expectedPath: `calendars/${conn.calendarEmail}/events/evt-existing-guests-1`,
        expectedSendUpdates: 'all',
        expectedAttendees: undefined,
      },
    ];

    for (const [idx, c] of cases.entries()) {
      await clearFixtureApiRequests(fixtureBaseUrl);
      const seeded = await seedCertifiedCalendarPlan(db, {
        ...conn,
        title: `C2 Case ${idx + 1}: ${String(c.args.summary).slice(0, 40)}`,
        userPrompt: c.label,
        summary: String(c.args.summary),
        step: {
          id: `step_c2_${idx + 1}`,
          tool: c.tool,
          description: String(c.args.summary),
          args: c.args,
        },
      });

      await page.goto(`/c/${seeded.convId}`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tôi sẽ làm 1 việc');
      const stepCard = page.locator('#plan-cards-container article').first();
      for (const text of c.expectedCardInclude) {
        await expect(stepCard).toContainText(text);
      }
      for (const text of c.expectedCardExclude) {
        await expect(stepCard).not.toContainText(text);
      }

      await stepCard.getByRole('button', { name: 'Xem trước' }).click();
      const preview = page.getByTestId('calendar-event-preview');
      await expect(preview).toBeVisible();
      for (const text of c.expectedPreviewInclude) {
        await expect(preview).toContainText(text);
      }
      for (const text of c.expectedPreviewExclude) {
        await expect(preview).not.toContainText(text);
      }
      await page.getByRole('dialog').getByRole('button', { name: /Đóng/i }).first().click();
      await expect(preview).toHaveCount(0);

      await page.getByRole('button', { name: 'Duyệt kế hoạch', exact: true }).click();
      await expect(page.locator('#moment-6')).toBeVisible();

      const stats = await readFixtureStats(fixtureBaseUrl);
      const req = stats.apiRequests.find(
        (r) => r.method === c.expectedMethod && r.path === c.expectedPath,
      );
      expect(req, `Missing outbound ${c.expectedMethod} ${c.expectedPath} for ${c.label}`).toBeDefined();
      expect(req!.query.sendUpdates).toBe(c.expectedSendUpdates);
      expect(req!.body?.attendees).toEqual(c.expectedAttendees);
    }
  } finally {
    await db.end();
  }

  expect(pageErrors).toEqual([]);
});
