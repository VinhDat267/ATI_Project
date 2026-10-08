import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { hashPassword } from '../../../chat-api/src/db/repositories/user-repo';

for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 812 }]) {
  for (const theme of ['light', 'dark']) {
    test(`FE-08: landing preserves five moments without horizontal overflow ${viewport.width} ${theme}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.addInitScript(value => localStorage.setItem('ati-theme', value), theme);
      await page.goto('/');
      await expect(page.locator('.moment-trigger')).toHaveCount(5);
      await expect(page.getByRole('heading', { name: 'Nói một câu. Việc trên nhiều công cụ được làm xong — sau khi bạn duyệt.' })).toBeVisible();
      await expect(page.locator('#email-sim-modal')).toHaveCount(0);
      for (let moment = 1; moment <= 5; moment++) {
        if (viewport.width === 1440) await page.locator(`#trigger-moment-${moment}`).scrollIntoViewIfNeeded();
        else await page.locator('.stage-fallback-list > div').nth(moment - 1).scrollIntoViewIfNeeded();
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      }
      await page.goto('/login');
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByRole('dialog')).toHaveCount(0);
    });
  }
}

test('FE-08: reduced motion uses the vertical story and every panel can be read', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/');
  await expect(page.locator('.stage-interactive-desktop')).toBeHidden();
  await expect(page.locator('.stage-fallback-list')).toBeVisible();
  expect(await page.locator('.stage-fallback-list').evaluate(element => getComputedStyle(element).position)).not.toBe('sticky');
});

test('FE-08: signup blocks short passwords without an API request', async ({ page }) => {
  // Native browser validation, with the public capability response at its HTTP boundary.
  // AUTH-02 separately verifies enabled registration against real PostgreSQL/outbox.
  await page.route('**/api/auth/config', route => route.fulfill({ json: { signupEnabled: true, googleEnabled: false } }));
  const writes: string[] = []; page.on('request', request => { if (request.url().endsWith('/api/auth/signup')) writes.push(request.url()); });
  await page.goto('/signup');
  await page.getByLabel('Họ tên', { exact: true }).fill('FE08');
  await page.getByLabel('Email', { exact: true }).fill('fe08@example.test');
  await page.getByLabel('Mật khẩu', { exact: true }).fill('short');
  await page.getByRole('button', { name: 'Gửi yêu cầu đăng ký' }).click();
  expect(await page.getByLabel('Mật khẩu', { exact: true }).evaluate((input: HTMLInputElement) => input.validity.tooShort)).toBe(true);
  expect(writes).toHaveLength(0);
});

test('FE-08: real login lockout uses Retry-After and continues counting elapsed time', async ({ page }) => {
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const email = `fe08-lock-${randomUUID()}@example.test`;
  try {
    await db.query("INSERT INTO users(email,password,name,status,email_verified,role) VALUES($1,$2,'FE08','active',true,'member')", [email, hashPassword('Fe08Valid!password')]);
    await page.goto('/login'); await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Mật khẩu', { exact: true }).fill('wrong-password');
    for (let attempt = 0; attempt < 5; attempt++) {
      await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
      await expect(page.getByRole('alert')).toContainText('mật khẩu không chính xác');
    }
    const [response] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/api/auth/login') && response.status() === 429),
      page.getByRole('button', { name: 'Đăng nhập', exact: true }).click(),
    ]);
    const retryAfter = Number(response.headers()['retry-after']); expect(retryAfter).toBeGreaterThan(0);
    await expect(page.getByRole('heading', { name: 'Sai mật khẩu quá nhiều lần' })).toBeVisible();
    const seconds = async () => page.locator('#blocked-timer-display').evaluate(element => {
      const [minutes, seconds] = element.textContent!.trim().split(':').map(Number); return minutes * 60 + seconds;
    });
    const initial = await seconds(); expect(Math.abs(initial - retryAfter)).toBeLessThanOrEqual(2);
    await page.clock.install(); await page.clock.fastForward(3000);
    await expect.poll(seconds).toBeLessThanOrEqual(initial - 2);
    await expect(page.getByText('Bạn vẫn có thể đặt lại mật khẩu qua email ngay bây giờ, nhưng cần chờ hết thời gian trên rồi mới đăng nhập lại được.')).toBeVisible();
    await expect(page.getByText('đăng nhập lại ngay', { exact: false })).toHaveCount(0);
  } finally { await db.query('DELETE FROM users WHERE email=$1', [email]); await db.end(); }
});

test('FE-08: pending and disabled email accounts show safe real account states', async ({ page }) => {
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const email = `fe08-pending-${randomUUID()}@example.test`;
  try {
    await db.query("INSERT INTO users(email,password,name,status,email_verified,role) VALUES($1,$2,'FE08','pending',false,'member')", [email, hashPassword('Fe08Valid!password')]);
    await page.goto('/login'); await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Mật khẩu', { exact: true }).fill('Fe08Valid!password');
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Tài khoản đang chờ duyệt' })).toBeVisible();
    await expect(page.getByText('Cần xác minh', { exact: true })).toBeVisible();
    await expect(page.getByText(process.env.CHAT_ADMIN_EMAIL!, { exact: false })).toHaveCount(0);
    await db.query("UPDATE users SET status='disabled' WHERE email=$1", [email]);
    await page.getByRole('link', { name: 'Thử đăng nhập lại', exact: true }).click();
    await page.getByLabel('Mật khẩu', { exact: true }).fill('Fe08Valid!password');
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Tài khoản đã bị tạm khóa' })).toBeVisible();
    await expect(page.getByText('Hãy liên hệ quản trị viên của nhóm để được mở khoá.')).toBeVisible();
    await expect(page.getByRole('button', { name: /gửi yêu cầu/i })).toHaveCount(0);
  } finally { await db.query('DELETE FROM users WHERE email=$1', [email]); await db.end(); }
});
