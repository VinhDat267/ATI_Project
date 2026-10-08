import { test, expect } from '@playwright/test';
import pg from 'pg';

test('AUTH-04: Google signup waits for approval, approved Google login enters chat and scrubs callback URL', async ({ page }, testInfo) => {
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const email = 'auth04-google@example.test';
  let userId: string | undefined;
  const callbackQueries: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname === '/api/auth/google/callback') callbackQueries.push(new URL(page.url()).search);
  });
  try {
    expect((await db.query('SELECT id FROM users WHERE email=$1', [email])).rowCount).toBe(0);
    await page.goto('/signup');
    await page.getByRole('button', { name: 'Tiếp tục với Google' }).click();
    await expect(page.getByRole('status')).toContainText('chờ quản trị viên duyệt');
    await expect(page).toHaveURL(/\/auth\/google\/callback$/);
    expect(await page.evaluate(() => localStorage.getItem('wap_access_token'))).toBeNull();
    const pending = (await db.query('SELECT id,status,email_verified,password,google_sub FROM users WHERE email=$1', [email])).rows[0];
    userId = pending.id;
    expect(pending).toMatchObject({ status: 'pending', email_verified: true, password: null, google_sub: 'fixture-google-user' });
    await page.screenshot({ path: testInfo.outputPath('AUTH04-google-pending.png'), fullPage: true });
    await db.query("UPDATE users SET status='active', updated_at=now() WHERE id=$1 AND status='pending'", [userId]);
    await page.getByRole('link', { name: 'Thử đăng nhập lại' }).click();
    await page.getByRole('button', { name: 'Tiếp tục với Google' }).click();
    await expect(page.getByRole('textbox', { name: /Mô tả công việc bạn muốn thực hiện|Nhập câu trả lời làm rõ yêu cầu/ })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
    expect(await page.evaluate(() => Boolean(localStorage.getItem('wap_access_token')))).toBe(true);
    expect(callbackQueries).toEqual(['', '']);
    expect(await page.evaluate(() => JSON.stringify(history.state))).not.toMatch(/code|state/);
    await page.screenshot({ path: testInfo.outputPath('AUTH04-google-active.png'), fullPage: true });
  } finally {
    // This scenario owns only this fake provider identity, never a development user.
    if (userId) {
      await db.query('DELETE FROM email_outbox WHERE to_address=$1', [email]);
      await db.query('DELETE FROM users WHERE id=$1 AND email=$2', [userId, email]);
    }
    await db.end();
  }
});
