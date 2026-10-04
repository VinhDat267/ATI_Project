import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import pg from 'pg';

const password = 'Auth02Browser!original';
const newPassword = 'Auth02Browser!changed';
async function mailLink(db: pg.Pool, email: string, view: string) {
  // Reset and resend emails are delivered after the response (AUTH-02b), so wait for the outbox row.
  let mail: any;
  await expect.poll(async () => (mail = (await db.query('SELECT * FROM email_outbox WHERE to_address=$1 AND body_text LIKE $2 ORDER BY created_at DESC LIMIT 1', [email, `%view=${view}%`])).rows[0])).toBeDefined();
  const link = new URL(mail.body_text.match(/http[^\s]+/)[0]);
  expect(link.searchParams.get('view')).toBe(view);
  return `${link.pathname}${link.search}`;
}
async function login(page: Page, email: string, value: string) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(value);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
}

test('AUTH-02: signup, outbox verification, pending approval and password recovery revoke old sessions', async ({ page }, testInfo) => {
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const email = `auth02-browser-${randomUUID()}@example.test`;
  const adminEmail = process.env.CHAT_ADMIN_EMAIL!;
  try {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Tạo tài khoản', exact: true }).click();
    await page.getByLabel('Họ tên', { exact: true }).fill('AUTH02 Browser');
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Tạo tài khoản', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Kiểm tra email để xác minh');
    const user = (await db.query('SELECT * FROM users WHERE email=$1', [email])).rows[0];
    expect(user).toMatchObject({ status: 'pending', email_verified: false });
    const verifyLink = await mailLink(db, email, 'verify-email');
    await page.goto(verifyLink);
    await expect(page.getByRole('status')).toContainText('chờ quản trị viên duyệt');
    expect(page.url()).not.toContain('token=');
    const [healthRequest] = await Promise.all([
      page.waitForRequest(request => request.url().endsWith('/api/health')),
      page.evaluate(() => fetch('/api/health').then(response => response.json())),
    ]);
    expect(healthRequest.headers().referer || '').toBe('');
    expect((await db.query('SELECT status,email_verified FROM users WHERE id=$1', [user.id])).rows[0]).toEqual({ status: 'pending', email_verified: true });
    await page.screenshot({ path: testInfo.outputPath('AUTH02-verified-pending.png'), fullPage: true });
    await login(page, email, password);
    await expect(page.getByRole('alert')).toContainText('chờ quản trị viên duyệt');

    // This task can run before AUTH-03 is present. Prefer its real approval
    // route once integrated; the task card explicitly permits DB approval in
    // the isolated AUTH-02 branch where that route does not exist yet.
    const admin = await page.request.post('/api/auth/login', { data: { email: adminEmail, password: process.env.CHAT_ADMIN_PASSWORD } });
    expect(admin.status()).toBe(200);
    const adminToken = (await admin.json()).accessToken;
    const approval = await page.request.post(`/api/admin/users/${user.id}/approve`, { headers: { Authorization: `Bearer ${adminToken}` } });
    if (approval.status() === 404) await db.query("UPDATE users SET status='active',updated_at=now() WHERE id=$1 AND status='pending' AND email_verified=true", [user.id]);
    else expect(approval.status()).toBe(200);
    await login(page, email, password);
    await expect(page.getByPlaceholder('Mô tả công việc bạn muốn thực hiện...')).toBeVisible();
    const oldTokens = await page.evaluate(() => ({ access: localStorage.getItem('wap_access_token')!, refresh: localStorage.getItem('wap_refresh_token')! }));
    await page.getByRole('button', { name: /Đăng xuất/ }).click();
    // Create another active session so the reset proof cannot be satisfied by
    // the explicit browser logout alone.
    const second = await page.request.post('/api/auth/login', { data: { email, password } });
    expect(second.status()).toBe(200); const secondTokens = await second.json();
    await page.goto('/login');
    await page.getByRole('button', { name: 'Quên mật khẩu?' }).click();
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByRole('button', { name: 'Gửi link đặt lại mật khẩu' }).click();
    await expect(page.getByRole('status')).toContainText('Nếu email có trong hệ thống');
    const resetLink = await mailLink(db, email, 'reset-password');
    await page.goto(resetLink);
    await expect(page.getByLabel('Mật khẩu mới', { exact: true })).toBeVisible();
    expect(page.url()).not.toContain('token=');
    await page.getByLabel('Mật khẩu mới', { exact: true }).fill(newPassword);
    await page.getByLabel('Nhập lại mật khẩu', { exact: true }).fill(newPassword);
    await page.getByRole('button', { name: 'Đặt lại mật khẩu', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Đăng nhập', exact: true })).toBeVisible();
    for (const tokens of [{ accessToken: oldTokens.access, refreshToken: oldTokens.refresh }, secondTokens]) {
      expect((await page.request.get('/api/auth/me', { headers: { Authorization: `Bearer ${tokens.accessToken}` } })).status()).toBe(401);
      expect((await page.request.post('/api/auth/refresh', { data: { refreshToken: tokens.refreshToken } })).status()).toBe(401);
    }
    await login(page, email, password);
    await expect(page.getByRole('alert')).toContainText('mật khẩu không chính xác');
    await page.getByLabel('Mật khẩu', { exact: true }).fill(newPassword);
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await expect(page.getByPlaceholder('Mô tả công việc bạn muốn thực hiện...')).toBeVisible();
    expect((await db.query('SELECT count(*)::int AS count FROM auth_sessions WHERE user_id=$1 AND revoked_at IS NULL', [user.id])).rows[0].count).toBe(1);
    await page.goto(resetLink);
    await page.getByLabel('Mật khẩu mới', { exact: true }).fill(newPassword);
    await page.getByLabel('Nhập lại mật khẩu', { exact: true }).fill(newPassword);
    await page.getByRole('button', { name: 'Đặt lại mật khẩu', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('đã dùng');
    await page.screenshot({ path: testInfo.outputPath('AUTH02-used-reset-link.png'), fullPage: true });
  } finally {
    await db.query('DELETE FROM email_outbox WHERE to_address=$1 OR body_text LIKE $2', [email, `%${email}%`]);
    await db.query('DELETE FROM users WHERE email=$1', [email]); await db.end();
  }
});

test('AUTH-02: closed signup config hides the login action and blocks the signup view', async ({ page }) => {
  // The canonical AUTH-02 scenario explicitly opens registration; this test
  // exercises the closed branch in a dedicated HTTP app in the API suite.
  // Browser evidence checks the page's dependence on the live config response.
  await page.route('**/api/auth/config', async route => route.fulfill({ json: { signupEnabled: false, googleEnabled: false } }));
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Quên mật khẩu?' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tạo tài khoản', exact: true })).toHaveCount(0);
  await page.goto('/signup');
  await expect(page.getByRole('status')).toContainText('đang đóng');
  await expect(page.getByRole('button', { name: 'Tạo tài khoản', exact: true })).toHaveCount(0);
});
