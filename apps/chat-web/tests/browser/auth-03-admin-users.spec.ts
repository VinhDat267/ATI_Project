import { test, expect, type Page } from '@playwright/test';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../../../chat-api/src/db/repositories/user-repo.js';

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByPlaceholder('Mô tả công việc bạn muốn thực hiện...')).toBeVisible();
}

test('AUTH-03: admin approves a pending account, member logs in, disable revokes the browser session', async ({ browser }, testInfo) => {
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const id = randomUUID();
  const email = `auth03-${id}@example.test`;
  const password = 'Auth03Browser!password';
  const adminContext = await browser.newContext(), memberContext = await browser.newContext();
  const admin = await adminContext.newPage(), member = await memberContext.newPage();
  try {
    await db.query("INSERT INTO users(id,email,password,name,status,role,email_verified) VALUES($1,$2,$3,'AUTH03 browser candidate','pending','member',true)", [id, email, hashPassword(password)]);
    expect((await member.request.post('/api/auth/login', { data: { email, password } })).status()).toBe(403);
    await login(admin, process.env.CHAT_ADMIN_EMAIL!, process.env.CHAT_ADMIN_PASSWORD!);
    await admin.getByRole('button', { name: 'Quản lý người dùng' }).click();
    await expect(admin).toHaveURL(/\/admin\/users$/);
    await admin.getByRole('tab', { name: /Chờ duyệt/ }).click();
    await admin.getByRole('searchbox', { name: 'Tìm theo email hoặc tên' }).fill(email);
    await admin.getByRole('button', { name: 'Tìm kiếm', exact: true }).click();
    const row = admin.getByRole('row').filter({ hasText: email });
    await row.getByRole('button', { name: 'Duyệt', exact: true }).click();
    await expect(admin.getByRole('dialog')).toContainText('Người này sẽ dùng được các service đã kết nối của nhóm');
    expect((await db.query('SELECT status FROM users WHERE id=$1', [id])).rows[0].status).toBe('pending');
    await admin.getByRole('button', { name: 'Xác nhận duyệt', exact: true }).click();
    await expect(admin.getByRole('dialog')).toHaveCount(0);
    await expect.poll(async () => (await db.query('SELECT status FROM users WHERE id=$1', [id])).rows[0].status).toBe('active');
    await expect.poll(async () => (await db.query('SELECT count(*)::int AS n FROM email_outbox WHERE to_address=$1', [email])).rows[0].n).toBe(1);
    const notification = (await db.query('SELECT subject,body_text,body_html FROM email_outbox WHERE to_address=$1', [email])).rows[0];
    expect(notification.subject).toMatch(/duyệt/i);
    expect(notification.body_text).toMatch(/duyệt/i);
    await login(member, email, password);
    await expect(member.getByRole('button', { name: 'Quản lý người dùng' })).toHaveCount(0);
    await member.goto('/admin/users');
    await expect(member.getByRole('alert')).toContainText('quyền quản trị');
    await member.getByRole('button', { name: 'Về trang chính' }).click();
    const oldAccess = await member.evaluate(() => localStorage.getItem('wap_access_token')!);
    const oldRefresh = await member.evaluate(() => localStorage.getItem('wap_refresh_token')!);
    await admin.getByRole('tab', { name: 'Tất cả người dùng' }).click();
    await row.getByRole('button', { name: 'Khóa', exact: true }).click();
    await expect(admin.getByRole('dialog')).toContainText('Mọi phiên đăng nhập');
    await admin.getByRole('button', { name: 'Xác nhận khóa', exact: true }).click();
    await expect(admin.getByRole('dialog')).toHaveCount(0);
    await member.getByRole('button', { name: /Cuộc hội thoại mới/ }).click();
    await expect(member.getByLabel('Email', { exact: true })).toBeVisible();
    expect((await member.request.get('/api/auth/me', { headers: { Authorization: `Bearer ${oldAccess}` } })).status()).toBe(401);
    expect((await member.request.post('/api/auth/refresh', { data: { refreshToken: oldRefresh } })).status()).toBe(401);
    expect((await db.query('SELECT count(*)::int AS n FROM auth_sessions WHERE user_id=$1 AND revoked_at IS NULL', [id])).rows[0].n).toBe(0);
    await admin.screenshot({ path: testInfo.outputPath('AUTH03-admin-disabled.png'), fullPage: true });
    await member.screenshot({ path: testInfo.outputPath('AUTH03-member-session-revoked.png'), fullPage: true });
  } finally {
    await adminContext.close(); await memberContext.close();
    await db.query('DELETE FROM email_outbox WHERE to_address=$1', [email]);
    await db.query('DELETE FROM users WHERE id=$1', [id]); await db.end();
  }
});
