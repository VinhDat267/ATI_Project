import { test, expect, type Page } from '@playwright/test';
import pg from 'pg';

const email = process.env.CHAT_ADMIN_EMAIL!;
const password = process.env.CHAT_ADMIN_PASSWORD!;
async function login(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Đăng nhập vào hệ thống' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByPlaceholder('Mô tả công việc bạn muốn thực hiện...')).toBeVisible();
  return page.evaluate(() => ({ access: localStorage.getItem('wap_access_token')!, refresh: localStorage.getItem('wap_refresh_token')! }));
}

test('AUTH-01: logout revokes server tokens and Back/Reload cannot restore chat', async ({ page }, testInfo) => {
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const pair = await login(page);
    const sid = JSON.parse(Buffer.from(pair.access.split('.')[1], 'base64url').toString()).sid;
    await page.getByRole('button', { name: /Menu người dùng/ }).click();
    await page.getByRole('menuitem', { name: /Đăng xuất/ }).click();
    await expect(page.getByPlaceholder('Mô tả công việc bạn muốn thực hiện...')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('wap_refresh_token'))).toBeNull();
    expect((await page.request.get('/api/auth/me', { headers: { Authorization: `Bearer ${pair.access}` } })).status()).toBe(401);
    expect((await page.request.post('/api/auth/refresh', { data: { refreshToken: pair.refresh } })).status()).toBe(401);
    expect((await db.query('SELECT revoked_at IS NOT NULL AS revoked FROM auth_sessions WHERE id=$1', [sid])).rows[0].revoked).toBe(true);
    await page.goBack();
    await expect(page.getByPlaceholder('Mô tả công việc bạn muốn thực hiện...')).toHaveCount(0);
    await page.reload();
    await expect(page.getByPlaceholder('Mô tả công việc bạn muốn thực hiện...')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('AUTH01-logged-out.png'), fullPage: true });
  } finally { await db.end(); }
});

test('AUTH-01: logout-all invalidates two independent browser sessions immediately', async ({ browser }) => {
  const first = await browser.newContext(), second = await browser.newContext();
  try {
    const one = await first.newPage(), two = await second.newPage();
    const a = await login(one), b = await login(two);
    expect((await one.request.post('/api/auth/logout-all', { headers: { Authorization: `Bearer ${a.access}` } })).status()).toBe(200);
    for (const pair of [a, b]) {
      expect((await one.request.get('/api/auth/me', { headers: { Authorization: `Bearer ${pair.access}` } })).status()).toBe(401);
      expect((await one.request.post('/api/auth/refresh', { data: { refreshToken: pair.refresh } })).status()).toBe(401);
    }
    await two.reload();
    await expect(two.getByPlaceholder('Mô tả công việc bạn muốn thực hiện...')).toHaveCount(0);
    await expect.poll(() => two.evaluate(() => localStorage.getItem('wap_refresh_token'))).toBeNull();
  } finally { await first.close(); await second.close(); }
});
