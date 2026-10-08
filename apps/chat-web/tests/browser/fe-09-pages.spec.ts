import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import pg from 'pg';
import { hashPassword, UserRepo } from '../../../chat-api/src/db/repositories/user-repo.js';
import { AdminUserRepo } from '../../../chat-api/src/db/repositories/admin-user-repo.js';

const password = 'Fe09Browser!password';
async function session(page: Page, email: string, secret = password) {
  const response = await page.request.post('/api/auth/login', { data: { email, password: secret } });
  expect(response.status()).toBe(200);
  const tokens = await response.json();
  await page.goto('/login');
  await page.evaluate(value => {
    localStorage.setItem('wap_access_token', value.accessToken); localStorage.setItem('wap_refresh_token', value.refreshToken); localStorage.setItem('wap_user', JSON.stringify(value.user));
  }, tokens);
  return { headers: { Authorization: `Bearer ${tokens.accessToken}` }, user: tokens.user };
}

test('FE-09: own title history uses a cursor, Enter/Esc and guarded late PATCH, with saved route reload', async ({ page }) => {
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const email = `fe09-history-${randomUUID()}@example.test`;
  let owner: string | undefined;
  try {
    owner = (await db.query("INSERT INTO users(email,password,name,status,email_verified) VALUES($1,$2,'FE09 History','active',true) RETURNING id", [email, hashPassword(password)])).rows[0].id;
    const { headers } = await session(page, email);
    const ids: string[] = [];
    for (let i = 0; i < 23; i++) {
      const response = await page.request.post('/api/conversations', { headers, data: { title: `FE09 title ${i}` } });
      expect(response.status()).toBe(201);
      const id = (await response.json()).conversation.id; ids.push(id);
      // Creation deliberately starts untitled; seed the supported title through PATCH.
      expect((await page.request.patch(`/api/conversations/${id}`, { headers, data: { title: `FE09 title ${i}` } })).status()).toBe(200);
    }
    await page.goto('/history');
    await expect(page.getByRole('heading', { name: 'FE09 title 22' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'FE09 title 0', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Tải thêm', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'FE09 title 0', exact: true })).toBeVisible();
    await expect(page.locator('select')).toHaveCount(0);
    await expect(page.getByText('Xem biên nhận', { exact: true })).toHaveCount(0);
    await page.getByRole('searchbox').fill('FE09 title 0');
    await page.getByRole('button', { name: 'Đổi tên FE09 title 0', exact: true }).click();
    await page.getByRole('textbox', { name: 'Tiêu đề hội thoại' }).fill('Cancelled');
    await page.getByRole('textbox', { name: 'Tiêu đề hội thoại' }).press('Escape');
    await expect(page.getByRole('heading', { name: 'FE09 title 0', exact: true })).toBeVisible();
    let release!: () => void, ready!: () => void;
    const held = new Promise<void>(resolve => release = resolve), started = new Promise<void>(resolve => ready = resolve);
    await page.route(`**/api/conversations/${ids[0]}`, async route => {
      if (route.request().method() !== 'PATCH') return route.continue();
      const response = await route.fetch(); expect(response.status()).toBe(200); ready(); await held; await route.fulfill({ response });
    });
    try {
      await page.getByRole('button', { name: 'Đổi tên FE09 title 0', exact: true }).click();
      const input = page.getByRole('textbox', { name: 'Tiêu đề hội thoại' });
      await input.fill('Sent title A'); await input.press('Enter'); await started;
      await input.fill('Unsaved draft B'); release();
      await expect(page.getByRole('status')).toContainText('Đã đổi tên hội thoại');
      await expect(input).toHaveValue('Unsaved draft B');
      expect((await page.request.get(`/api/conversations/${ids[0]}`, { headers }).then(response => response.json())).conversation.title).toBe('Sent title A');
      await input.press('Escape');
      await page.getByRole('link', { name: 'Mở hội thoại', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/c/${ids[0]}$`)); await page.reload();
      await expect(page.getByRole('textbox', { name: 'Mô tả công việc bạn muốn thực hiện' })).toBeVisible();
    } finally { release(); }
  } finally {
    if (owner) {
      await db.query('DELETE FROM conversations WHERE user_id=$1', [owner]);
      await db.query('DELETE FROM users WHERE id=$1', [owner]);
    }
    await db.end();
  }
});

test('FE-09: unverified approval is disabled and own admin row has no member actions', async ({ page }) => {
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const email = `fe09-unverified-${randomUUID()}@example.test`;
  let id: string | undefined;
  try {
    id = (await db.query("INSERT INTO users(email,password,name,status,email_verified) VALUES($1,$2,'FE09 Unverified','pending',false) RETURNING id", [email, hashPassword(password)])).rows[0].id;
    await session(page, process.env.CHAT_ADMIN_EMAIL!, process.env.CHAT_ADMIN_PASSWORD!);
    await page.goto('/admin/users');
    await page.getByRole('searchbox', { name: 'Tìm kiếm theo tên hoặc email' }).fill(email);
    const candidate = page.locator('#pending-list-container > div').filter({ hasText: email });
    await expect(candidate.getByRole('button', { name: /Duyệt & kích hoạt/ })).toBeDisabled();
    await expect(candidate).toContainText('Người này cần bấm link xác minh trong email trước.');
    await expect(page.getByRole('button', { name: /Từ chối|Mời/ })).toHaveCount(0);
    await page.getByRole('tab', { name: /Thành viên/ }).click();
    await page.getByRole('searchbox').fill(process.env.CHAT_ADMIN_EMAIL!);
    const own = page.locator('#table-members-body tr').filter({ hasText: process.env.CHAT_ADMIN_EMAIL! });
    await expect(own).toContainText('Bạn'); await expect(own.locator('button')).toHaveCount(0);
  } finally { if (id) await db.query('DELETE FROM users WHERE id=$1', [id]); await db.end(); }
});

test('FE-09: actual approval HTTP 503 remains visible and preserves the pending account', async ({ page }, info) => {
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const email = `fe09-no-email-${randomUUID()}@example.test`;
  // Load the native API at runtime so frontend tsc does not impose its different
  // compiler settings on backend packages, which have their own typecheck gate.
  const backendModule = '../../../chat-api/src/app.js';
  const { createApp } = await import(backendModule);
  const app = createApp({ jwtSecret: process.env.JWT_SECRET!, userRepo: new UserRepo(db), adminUserRepo: new AdminUserRepo(db), adminAuditLogger: { info() {} } });
  // This native backend deliberately has no email sender. Forward its response,
  // rather than constructing a nominal error body in the browser fixture.
  const server: Server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing HTTP fixture address');
  let id: string | undefined;
  try {
    id = (await db.query("INSERT INTO users(email,password,name,status,email_verified) VALUES($1,$2,'FE09 Email Unavailable','pending',true) RETURNING id", [email, hashPassword(password)])).rows[0].id;
    await session(page, process.env.CHAT_ADMIN_EMAIL!, process.env.CHAT_ADMIN_PASSWORD!);
    let responses = 0;
    await page.route(`**/api/admin/users/${id}/approve`, async route => {
      const response = await route.fetch({ url: `http://127.0.0.1:${address.port}/api/admin/users/${id}/approve` });
      expect(response.status()).toBe(503);
      expect((await response.json()).code).toBe('APPROVAL_EMAIL_UNAVAILABLE');
      responses++;
      await route.fulfill({ response });
    });
    await page.goto('/admin/users');
    await page.getByRole('searchbox').fill(email);
    const candidate = page.locator('#pending-list-container > div').filter({ hasText: email });
    await candidate.getByRole('button', { name: /Duyệt & kích hoạt/ }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /Xác nhận duyệt/ }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Chưa cấu hình email thông báo duyệt tài khoản.');
    await expect(dialog.getByRole('button', { name: /Xác nhận duyệt/ })).toBeEnabled();
    await dialog.getByRole('button', { name: /Xác nhận duyệt/ }).click();
    await expect.poll(() => responses).toBe(2);
    await expect(dialog.getByRole('alert')).toBeVisible();
    expect((await db.query('SELECT status FROM users WHERE id=$1', [id])).rows[0].status).toBe('pending');
    await page.screenshot({ path: info.outputPath('FE09-actual-503.png') });
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (id) await db.query('DELETE FROM users WHERE id=$1', [id]);
    await db.end();
  }
});

test('FE-09: Account Users History retain prototype layouts in light/dark at desktop and mobile without horizontal scrolling', async ({ page }) => {
  await session(page, process.env.CHAT_ADMIN_EMAIL!, process.env.CHAT_ADMIN_PASSWORD!);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 812 }]) {
    await page.setViewportSize(viewport);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(value => localStorage.setItem('ati-theme', value), theme);
      for (const path of ['/account', '/admin/users', '/history']) {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        expect(await page.evaluate(() => document.documentElement.dataset.protoPage)).toBe(path === '/admin/users' ? 'users' : path.slice(1));
        expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(theme === 'dark');
        const avatar = page.getByRole('button', { name: /Menu người dùng/ });
        expect(await avatar.evaluate(element => getComputedStyle(element).width)).toBe('32px');
        await avatar.press('ArrowDown');
        const menu = page.getByRole('menu');
        await expect(page.getByRole('menuitem', { name: 'Nhật ký điều phối', exact: true })).toBeFocused();
        const box = await menu.boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
        expect(await page.getByRole('menuitem').first().evaluate(element => getComputedStyle(element).display)).toBe('flex');
        await page.getByRole('menuitem').first().press('Escape');
        await expect(menu).toHaveCount(0); await expect(avatar).toBeFocused();
      }
    }
  }
});
