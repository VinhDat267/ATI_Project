import { test, expect, type Page } from '@playwright/test';
import pg from 'pg';
import { certifyFixturePlan } from './persisted-artifacts.fixture.js';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(process.env.CHAT_ADMIN_EMAIL!);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(process.env.CHAT_ADMIN_PASSWORD!);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hôm nay bạn muốn nhờ việc gì?');
}
test('GMAIL-03 off: existing surfaces contain no Gmail when disabled', async ({ page }) => {
  await page.goto('/'); await expect(page.getByText(/Gmail/)).toHaveCount(0);
  await page.goto('/guide'); await expect(page.getByRole('heading', { level: 1 })).toBeVisible(); await expect(page.getByText(/Gmail/)).toHaveCount(0);
  await login(page); await expect(page.getByText(/Gmail/)).toHaveCount(0);
  await page.goto('/settings'); await expect(page.getByRole('button', { name: /Trello —/ })).toBeVisible();
  await expect(page.getByText(/Gmail/)).toHaveCount(0);
});
for (const width of [1440, 375]) for (const theme of ['light', 'dark']) {
  test(`GMAIL-03: personal OAuth, preview, receipt and disconnect ${width} ${theme}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(value => localStorage.setItem('ati-theme', value), theme);
    await login(page);
    const token = await page.evaluate(() => localStorage.getItem('wap_access_token'));
    await page.request.delete('/api/connections/gmail', { headers: { Authorization: `Bearer ${token}` } });
    await page.goto('/settings#gmail');
    const row = page.locator('#service-row-gmail');
    await expect(row).toBeFocused(); await expect(row).toContainText('không xoá vĩnh viễn');
    expect(await row.getByRole('heading', { name: 'Gmail' }).evaluate(element => getComputedStyle(element).color)).toBe(theme === 'dark' ? 'rgb(241, 245, 249)' : 'rgb(17, 24, 39)');
    expect(await row.getByRole('button', { name: 'Kết nối Gmail', exact: true }).evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(255, 87, 1)');
    await page.evaluate(() => { window.location.hash = 'slack'; });
    await expect(page.getByRole('dialog', { name: 'Slack' })).toBeVisible();
    await page.evaluate(() => { window.location.hash = 'gmail'; });
    await expect(page.getByRole('dialog', { name: 'Slack' })).toHaveCount(0);
    await expect(row).toBeFocused();
    await page.screenshot({ path: info.outputPath(`gmail-not-connected-${width}-${theme}.png`), fullPage: true });
    await page.route('**/api/connections/gmail/start', async route => {
      await expect(row.getByRole('button', { name: /Kết nối/ })).toBeDisabled();
      await expect(row.getByRole('status')).toContainText('Đang chuyển hướng');
      await page.screenshot({ path: info.outputPath(`gmail-redirect-pending-${width}-${theme}.png`), fullPage: true });
      await route.continue();
    });
    let callbacks = 0;
    await page.route('**/api/connections/gmail/callback', async route => {
      callbacks++;
      expect(new URL(page.url()).search).toBe('');
      await expect(page.getByRole('heading', { name: 'Kết nối Gmail', exact: true })).toBeVisible();
      await expect(page.locator('h1')).toHaveCount(1); await expect(page.getByRole('main')).toHaveCount(1);
      await page.screenshot({ path: info.outputPath(`gmail-callback-${width}-${theme}.png`) });
      await route.continue();
    });
    await page.getByRole('button', { name: 'Kết nối Gmail', exact: true }).click();
    await expect(row).toContainText('gmail-owner@example.test');
    await expect(page.getByRole('status')).toContainText('Đã kết nối gmail-owner@example.test');
    expect(callbacks).toBe(1);
    await page.screenshot({ path: info.outputPath(`gmail-connected-${width}-${theme}.png`), fullPage: true });
    // Exercise the UI for a grant the backend has marked invalid, using only
    // this disposable database and this test user's own credential row.
    const ownerId = await page.evaluate(() => JSON.parse(localStorage.getItem('wap_user')!).id);
    const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
      expect((await db.query("UPDATE service_credentials SET status='reconnect_required' WHERE service='gmail' AND user_id=$1 RETURNING id", [ownerId])).rowCount).toBe(1);
    } finally { await db.end(); }
    await page.reload(); await expect(row).toContainText('Cần kết nối lại');
    await expect(row).toContainText('7 ngày');
    await page.screenshot({ path: info.outputPath(`gmail-reconnect-required-${width}-${theme}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Kết nối lại', exact: true }).click();
    await expect(row).toContainText('Đã kết nối'); expect(callbacks).toBe(2);
    await page.goto('/');
    await page.getByRole('textbox').fill('Trả lời email mới nhất trong luồng Họp nhóm ATI');
    await page.getByRole('button', { name: 'Gửi yêu cầu', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tôi sẽ làm 1 việc, theo thứ tự');
    await expect(page.getByText('Gửi từ: gmail-owner@example.test', { exact: true })).toBeVisible();
    const destinationLine = page.locator('#plan-cards-container p').filter({ hasText: 'Đích đến:' });
    await expect(destinationLine).toHaveText('Đích đến: Họp nhóm ATI');
    // A thread title can be one long unbroken string; give this pending plan one
    // in the disposable database and check that it wraps instead of widening the page.
    const longTitle = 'X'.repeat(120);
    const conversationPath = new URL(page.url()).pathname;
    const labelsDb = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const updated = await labelsDb.query("UPDATE plans SET resource_labels = resource_labels || jsonb_build_object('gmail-thread-1', $1::text) WHERE conv_id = $2 AND status = 'pending' AND resource_labels->>'gmail-thread-1' = 'Họp nhóm ATI' RETURNING id", [longTitle, new URL(page.url()).pathname.split('/').pop()]);
      expect(updated.rowCount).toBe(1);
      await certifyFixturePlan(labelsDb, updated.rows[0].id);
    } finally { await labelsDb.end(); }
    // Reopen within the app: the SQL-only fixture edit does not change the SSE
    // buffer. A full reload replays its old label and races the updated plan read.
    await page.locator('#btn-open-history').click();
    await page.getByRole('button', { name: 'Cuộc hội thoại mới', exact: true }).click();
    await page.waitForURL(url => url.pathname.startsWith('/c/') && url.pathname !== conversationPath);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${conversationPath}$`));
    await expect(page.getByText('Gửi từ: gmail-owner@example.test', { exact: true })).toBeVisible();
    await expect(destinationLine).toHaveText(`Đích đến: ${longTitle}`);
    expect(await destinationLine.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Xem trước', exact: true }).click();
    const preview = page.getByRole('dialog', { name: 'Xem trước nội dung' });
    await expect(preview).toContainText('lan@example.com'); await expect(preview).toContainText("lấy từ luồng thư 'Họp nhóm ATI'");
    await expect(preview).toContainText('Bcc');
    await expect(preview).toContainText('Mình đồng ý, hẹn gặp lúc 9 giờ.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`gmail-preview-${width}-${theme}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Đóng xem trước', exact: true }).click();
    await page.getByRole('button', { name: 'Duyệt kế hoạch', exact: true }).click();
    await expect(page.locator('#moment-6')).toBeVisible();
    const receiptDestination = page.locator('#moment-6 p').filter({ hasText: longTitle });
    await expect(receiptDestination).toHaveText(longTitle);
    expect(await receiptDestination.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.goto('/settings#gmail'); await page.getByRole('button', { name: 'Ngắt kết nối', exact: true }).click();
    await page.getByRole('button', { name: 'Xác nhận ngắt kết nối', exact: true }).click();
    await expect(row).toContainText('Chưa kết nối');
    await page.goto('/'); await page.getByRole('textbox').fill('Trả lời email trong luồng Họp nhóm ATI');
    await page.getByRole('button', { name: 'Gửi yêu cầu', exact: true }).click();
    await expect(page.getByRole('link', { name: /Kết nối Gmail/ })).toBeVisible();
  });
}
