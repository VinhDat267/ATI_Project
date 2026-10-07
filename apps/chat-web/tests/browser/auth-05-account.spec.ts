import { test, expect, type Page } from '@playwright/test';
import pg from 'pg';
import { pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';

const password = 'Auth05Browser!password';
// A dedicated account keeps session revocation and renaming away from the shared admin.
const storedPassword = () => {
  const salt = randomBytes(16).toString('hex');
  return `pbkdf2_sha256$210000$${salt}$${pbkdf2Sync(password, salt, 210000, 32, 'sha256').toString('hex')}`;
};
async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email); await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByRole('textbox', { name: /Mô tả công việc bạn muốn thực hiện|Nhập câu trả lời làm rõ yêu cầu/ })).toBeVisible();
}

test('AUTH-05: logging out every other device sends the other browser to login on its next action; a new name reaches the menu', async ({ browser }, info) => {
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const email = `auth05-${randomUUID()}@example.test`;
  const first = await browser.newContext(), second = await browser.newContext();
  try {
    await db.query("INSERT INTO users(email,password,name,status,email_verified,role) VALUES($1,$2,'Người thử AUTH-05','active',true,'member')", [email, storedPassword()]);
    const one = await first.newPage(), two = await second.newPage();
    await login(one, email); await login(two, email);

    await one.getByRole('button', { name: /Menu người dùng/ }).click();
    await one.getByRole('menuitem', { name: 'Tài khoản' }).click();
    await expect(one).toHaveURL(/\/account$/);
    await expect(one.getByText('Phiên này', { exact: true })).toBeVisible();
    await expect(one.getByRole('button', { name: 'Đăng xuất phiên này' })).toHaveCount(1);
    await one.screenshot({ path: info.outputPath('AUTH05-account.png'), fullPage: true });
    await one.getByRole('button', { name: 'Đăng xuất khỏi mọi thiết bị khác' }).click();
    await expect(one.getByRole('main').getByRole('status')).toContainText('Đã đăng xuất 1 phiên khác');
    await expect(one.getByRole('button', { name: 'Đăng xuất phiên này' })).toHaveCount(0);

    // The other browser still shows the workspace until its next request meets the revoked session.
    // Opening history makes the next authenticated request and detects revocation.
    await two.getByRole('button', {name:'Mở danh sách hội thoại'}).click();
    await expect(two).toHaveURL(/\/login$/);
    await expect(two.getByRole('button', { name: 'Đăng nhập', exact: true })).toBeVisible();

    await one.getByLabel('Tên hiển thị').fill('Tên mới AUTH-05');
    await one.getByRole('button', { name: 'Lưu tên' }).click();
    await expect(one.getByRole('main').getByRole('status')).toContainText('Đã lưu tên mới');
    await one.getByRole('button', { name: 'Về workspace' }).click();
    await expect(one.getByRole('button', { name: 'Menu người dùng: Tên mới AUTH-05', exact: true })).toBeVisible();
    expect((await db.query('SELECT name FROM users WHERE email=$1', [email])).rows[0].name).toBe('Tên mới AUTH-05');
  } finally { await first.close(); await second.close(); await db.end(); }
});
