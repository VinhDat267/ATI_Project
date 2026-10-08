import { test, expect, type Page } from '@playwright/test';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../../../chat-api/src/db/repositories/user-repo.js';

async function login(page: Page, email = process.env.CHAT_ADMIN_EMAIL!, password = process.env.CHAT_ADMIN_PASSWORD!) {
  await page.goto('/login'); await page.getByLabel('Email').fill(email); await page.getByLabel('Mật khẩu').fill(password); await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByRole('button', { name: /Menu người dùng/ })).toBeVisible();
}
async function headers(page: Page) { return { Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem('wap_access_token'))}` }; }

test('FE-07: admin saves, checks, edits scope without keys, and restores the service row after Escape', async ({ page }) => {
  await login(page); await page.goto('/settings#notion'); const dialog = page.getByRole('dialog', { name: 'Notion' }); await expect(dialog).toBeVisible();
  const before = await page.request.get('/api/services', { headers: await headers(page) });
  const notion = (await before.json()).services.find((s: any) => s.id === 'notion');
  if (!notion.configured) {
    await expect(dialog.getByRole('button', { name: 'Kiểm tra kết nối', exact: true })).toBeDisabled();
    await expect(dialog.locator('#test-unconfigured-note')).toBeVisible();
  }
  await dialog.getByLabel('Internal integration token', { exact: true }).fill('synthetic-fe07-notion-token');
  if (!(await dialog.locator('#scope-chips-container').textContent())?.includes('11111111111141118111111111111111')) {
    await dialog.locator('#new-scope-input').fill('11111111111141118111111111111111'); await dialog.getByRole('button', { name: 'Thêm', exact: true }).click();
  }
  await dialog.getByRole('button', { name: 'Lưu thay đổi' }).click(); await expect(dialog.locator('#test-result-box')).toContainText('Chưa kiểm tra');
  await expect(dialog.getByLabel('Internal integration token', { exact: true })).toHaveValue('');
  await expect(dialog.getByLabel('Internal integration token', { exact: true })).toHaveAttribute('placeholder', 'Đã lưu · nhập lại nếu muốn thay');
  await dialog.getByRole('button', { name: 'Kiểm tra kết nối', exact: true }).click();
  // The API checks the real provider even in sandbox; synthetic keys must not
  // be presented as verified. Preserve the real rejection/timeout result.
  await expect(dialog.locator('#test-result-box')).toContainText(/bị từ chối|Không thể xác nhận|Kiểm tra kết nối thất bại|10 giây/);
  await expect(dialog.locator('#drawer-header-status-badge')).toContainText('Không kết nối được');
  await dialog.locator('#new-scope-input').fill('22222222222242228222222222222222'); await dialog.getByRole('button', { name: 'Thêm', exact: true }).click();
  const saved = page.waitForResponse(r => r.url().endsWith('/notion/scope') && r.request().method() === 'PUT');
  await dialog.getByRole('button', { name: 'Lưu thay đổi' }).click(); expect((await saved).status()).toBe(200);
  await expect(dialog.locator('#drawer-header-status-badge')).toContainText('Chưa kiểm tra');
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(page.locator('#service-row-notion')).toBeFocused();
  await expect(page.locator('#list-connected-services #service-row-notion')).toBeVisible();
  await page.goto('/settings#unknown-service'); await expect(page.getByRole('heading', { name: 'Kết nối dịch vụ', exact: true })).toBeVisible(); await expect(page.getByRole('dialog')).toHaveCount(0);
});

for (const theme of ['light', 'dark'] as const) {
  test(`FE-07: ${theme} mobile page/drawer has no overflow, full-height panel and trapped focus`, async ({ page }) => {
    await page.addInitScript(theme => localStorage.setItem('ati-theme', theme), theme);
    await page.setViewportSize({ width: 375, height: 812 }); await login(page); await page.goto('/settings');
    await expect(page.locator('#service-row-notion')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
    await page.goto('/settings#notion'); const dialog = page.getByRole('dialog', { name: 'Notion' }); await expect(dialog).toBeVisible();
    const panel = await page.locator('#drawer-panel').boundingBox(); expect(panel!.width).toBe(375); expect(panel!.height).toBe(812); expect(panel!.x).toBe(0); expect(panel!.y).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
    const first = dialog.getByRole('button', { name: 'Đóng ngăn chi tiết' }); await expect(first).toBeFocused();
    await page.keyboard.press('Shift+Tab'); await expect(dialog.getByRole('button', { name: 'Kiểm tra kết nối', exact: true })).toBeFocused();
    await page.keyboard.press('Tab'); await expect(first).toBeFocused(); await page.keyboard.press('Escape'); await expect(page.locator('#service-row-notion')).toBeFocused();
    expect(await page.locator('html').getAttribute('data-proto-page')).toBe('settings');
  });
}
test('FE-07: member sees locked keys and chips but can check a configured service', async ({ browser, request }) => {
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL }); const id = randomUUID(), email = `fe07-${id}@localhost.test`, password = 'FE07-member-sandbox-only';
  const context = await browser.newContext(); const page = await context.newPage();
  try {
    // Seed this case through the real API so --grep needs no earlier admin test.
    const auth = await request.post('/api/auth/login', { data: { email: process.env.CHAT_ADMIN_EMAIL!, password: process.env.CHAT_ADMIN_PASSWORD! } });
    expect(auth.status()).toBe(200);
    const seeded = await request.post('/api/services/notion/credentials', {
      headers: { Authorization: `Bearer ${(await auth.json()).accessToken}` },
      data: { credentials: { token: 'synthetic-fe07-notion-token' }, allowedScope: ['11111111111141118111111111111111'] },
    });
    expect(seeded.status()).toBe(200);
    await db.query("INSERT INTO users(id,email,password,name,status,role,email_verified) VALUES($1,$2,$3,'FE07 Member','active','member',true)", [id, email, hashPassword(password)]);
    await login(page, email, password); await page.goto('/settings#notion'); const dialog = page.getByRole('dialog', { name: 'Notion' }); await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Internal integration token', { exact: true })).toBeDisabled(); await expect(dialog.getByRole('button', { name: 'Lưu thay đổi' })).toBeDisabled();
    await expect(dialog.locator('#drawer-member-warning')).toContainText('Chỉ quản trị viên thay đổi được khoá dùng chung của nhóm.');
    await expect(dialog.getByRole('button', { name: /^Xoá mục/ })).toHaveCount(0); await expect(dialog.locator('#new-scope-input')).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Kiểm tra kết nối', exact: true })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Kiểm tra kết nối', exact: true }).click(); await expect(dialog.locator('#test-result-box')).toContainText(/bị từ chối|Không thể xác nhận|Kiểm tra kết nối thất bại|10 giây/);
    await expect(dialog.locator('#drawer-header-status-badge')).toContainText('Không kết nối được');
  } finally { await context.close(); await db.query('DELETE FROM users WHERE id=$1', [id]); await db.end(); }
});
