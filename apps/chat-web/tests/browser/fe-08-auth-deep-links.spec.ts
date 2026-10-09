import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { hashPassword } from '../../../chat-api/src/db/repositories/user-repo';

for (const entry of [
  { status: 'pending', path: '/history', heading: 'Tài khoản đang chờ duyệt', responseStatus: 403 },
  { status: 'disabled', path: '/account', heading: 'Tài khoản đã bị tạm khóa', responseStatus: 403 },
  { status: 'active', path: '/c/private-deep-link', heading: 'Sai mật khẩu quá nhiều lần', responseStatus: 429 },
]) {
  test(`FE-08: real ${entry.status} login feedback survives protected deep link ${entry.path}`, async ({ page }) => {
    const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const email = `fe08-deep-${randomUUID()}@example.test`, password = 'Fe08DeepLink!password';
    try {
      await db.query("INSERT INTO users(email,password,name,status,email_verified,role) VALUES($1,$2,'Deep link',$3,true,'member')", [email, hashPassword(password), entry.status]);
      await page.goto(entry.path);
      await page.getByLabel('Email', { exact: true }).fill(email);
      await page.getByLabel('Mật khẩu', { exact: true }).fill(entry.status === 'active' ? 'wrong-password' : password);
      const submit = page.getByRole('button', { name: 'Đăng nhập', exact: true });
      if (entry.status === 'active') {
        for (let index = 0; index < 5; index++) {
          await submit.click();
          await expect(page.getByRole('alert')).toContainText('mật khẩu không chính xác');
        }
      }
      const [response] = await Promise.all([
        page.waitForResponse(response => response.url().endsWith('/api/auth/login') && response.status() === entry.responseStatus),
        submit.click(),
      ]);
      await expect(page.getByRole('heading', { name: entry.heading, exact: true })).toBeVisible();
      expect(new URL(page.url()).pathname).toBe(entry.path);
      await expect(page.getByText(process.env.CHAT_ADMIN_EMAIL!, { exact: false })).toHaveCount(0);
      if (entry.status === 'active') {
        const seconds = await page.locator('#blocked-timer-display').evaluate(element => {
          const [minutes, seconds] = element.textContent!.trim().split(':').map(Number);
          return minutes * 60 + seconds;
        });
        expect(Math.abs(seconds - Number(response.headers()['retry-after']))).toBeLessThanOrEqual(2);
      }
    } finally {
      await db.query('DELETE FROM users WHERE email=$1', [email]); await db.end();
    }
  });
}
