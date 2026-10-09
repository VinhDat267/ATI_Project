import { test, expect, type Page } from '@playwright/test';
import { createHmac, randomUUID, randomBytes, pbkdf2Sync } from 'node:crypto';
import pg from 'pg';

const password = 'Auth05GoogleBrowser!password';
let db: pg.Pool, email: string, userId: string;
test.beforeAll(() => { db = new pg.Pool({ connectionString: process.env.DATABASE_URL }); });
test.afterAll(async () => { await db.end(); });
test.beforeEach(async () => {
  email = `auth05-google-${randomUUID()}@example.test`;
  const salt = randomBytes(16).toString('hex');
  const storedPassword = `pbkdf2_sha256$210000$${salt}$${pbkdf2Sync(password, salt, 210000, 32, 'sha256').toString('hex')}`;
  userId = (await db.query("INSERT INTO users(email,password,name,status,email_verified) VALUES($1,$2,'Google Account Fixture','active',true) RETURNING id", [email, storedPassword])).rows[0].id;
});
test.afterEach(async () => { await db.query('DELETE FROM users WHERE id=$1 AND email=$2', [userId, email]); });
async function openAccount(page: Page) {
  await page.goto('/login'); await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByRole('textbox', { name: /Mô tả công việc bạn muốn thực hiện|Nhập câu trả lời làm rõ yêu cầu/ })).toBeVisible();
  await page.getByRole('button', { name: /Menu người dùng/ }).click();
    await page.getByRole('menuitem', { name: 'Tài khoản', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Liên kết Google', exact: true })).toBeVisible();
}
async function expireAccess(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('wap_access_token'));
  const [header, body] = token!.split('.');
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
  payload.exp = Math.floor(Date.now() / 1000) - 60;
  const data = `${header}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
  const expired = `${data}.${createHmac('sha256', process.env.JWT_SECRET!).update(data).digest('base64url')}`;
  await page.evaluate(value => localStorage.setItem('wap_access_token', value), expired);
  return payload.sid;
}
test('AUTH-05 Google: link and unlink refresh expired access while preserving the current session', async ({ page }, info) => {
  await openAccount(page);
  const paths: string[] = []; page.on('request', request => paths.push(new URL(request.url()).pathname));
  const originalSid = await expireAccess(page);
  await page.getByRole('button', { name: 'Liên kết Google', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Đã liên kết tài khoản Google');
  expect(paths.filter(path => path === '/api/auth/refresh')).toHaveLength(1);
  expect(paths.filter(path => path === '/api/auth/google/callback')).toHaveLength(1);
  await page.getByRole('button', { name: 'Về trang tài khoản', exact: true }).click();
  await expect(page.getByText('Đã liên kết (auth04-google@example.test)')).toBeVisible();
  expect((await db.query('SELECT google_sub FROM users WHERE id=$1', [userId])).rows[0].google_sub).toBe('fixture-google-user');
  expect(await expireAccess(page)).toBe(originalSid);
  await page.getByRole('button', { name: 'Gỡ liên kết', exact: true }).click();
  const currentPassword = page.getByLabel('Mật khẩu hiện tại để gỡ Google', { exact: true });
  await expect(currentPassword).toHaveAttribute('type', 'password');
  await currentPassword.fill(password);
  await page.getByRole('button', { name: 'Xác nhận gỡ liên kết', exact: true }).click();
  await expect(page.getByRole('main').getByRole('status')).toContainText('Đã gỡ liên kết Google');
  expect(paths.filter(path => path === '/api/auth/refresh')).toHaveLength(2);
  expect((await db.query('SELECT google_sub,google_email FROM users WHERE id=$1', [userId])).rows[0]).toEqual({ google_sub: null, google_email: null });
  await expect(page.getByText('Phiên này', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('AUTH05-Google-expired-access-recovered.png'), fullPage: true });
});
test('AUTH-05 Google: a revoked account session goes to login instead of repeatedly failing linking', async ({ page }) => {
  await openAccount(page);
  await db.query('UPDATE auth_sessions SET revoked_at=now() WHERE user_id=$1', [userId]);
  await page.getByRole('button', { name: 'Liên kết Google', exact: true }).click();
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('wap_access_token'))).toBeNull();
});
for (const leave of ['logout', 'workspace'] as const) {
  test(`AUTH-05 Google: ignores a successful pending start after ${leave}`, async ({ page }) => {
    // Observe delivery of the real body even when the client discards it after
    // logout. The clone leaves the application's response and JSON read intact.
    await page.addInitScript(() => {
      const native = window.fetch;
      window.fetch = async (...args) => {
        const response = await native(...args);
        if (String(args[0]) === '/api/auth/google/start') {
          void response.clone().arrayBuffer().then(() => sessionStorage.setItem('auth05-test-start-read', 'true'));
        }
        return response;
      };
    });
    await openAccount(page);
    let release!: () => void, ready!: () => void;
    const gate = new Promise<void>(resolve => release = resolve), started = new Promise<void>(resolve => ready = resolve);
    await page.route('**/api/auth/google/start', async route => {
      const response = await route.fetch(); expect(response.status()).toBe(200); ready(); await gate; await route.fulfill({ response });
    });
    try {
      await page.getByRole('button', { name: 'Liên kết Google', exact: true }).click(); await started;
      await page.getByRole('button', { name: leave === 'logout' ? 'Đăng xuất' : 'Về workspace', exact: true }).click();
      if (leave === 'logout') {
        await expect.poll(() => page.evaluate(() => localStorage.getItem('wap_access_token'))).toBeNull();
        await expect(page.getByRole('button', { name: 'Đăng nhập vào hệ thống', exact: true })).toBeVisible();
      } else await expect(page.getByRole('textbox', { name: /Mô tả công việc bạn muốn thực hiện|Nhập câu trả lời làm rõ yêu cầu/ })).toBeVisible();
      release();
      await page.waitForFunction(() => sessionStorage.getItem('auth05-test-start-read') === 'true');
      await expect(page).toHaveURL(/\/$/);
      expect((await db.query('SELECT google_sub FROM users WHERE id=$1', [userId])).rows[0].google_sub).toBeNull();
    } finally { release(); }
  });
}
