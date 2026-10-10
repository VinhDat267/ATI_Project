import { test, expect } from '@playwright/test';
import pg from 'pg';
import { pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';

const password = 'Fe11Return!password';
function hashPassword() {
  const salt = randomBytes(16).toString('hex');
  return `pbkdf2_sha256$210000$${salt}$${pbkdf2Sync(password, salt, 210000, 32, 'sha256').toString('hex')}`;
}

test('FE-11: revoked session logs back into the same saved conversation', async ({ page }) => {
  test.setTimeout(60_000);
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const id = randomUUID(), email = `fe11-return-${id}@example.test`;
  try {
    const userId = (await db.query("INSERT INTO users(email,password,name,status,email_verified,role) VALUES($1,$2,'FE11 Return','active',true,'member') RETURNING id", [email, hashPassword()])).rows[0].id;
    const conversationId = (await db.query("INSERT INTO conversations(user_id,status) VALUES($1,'chatting') RETURNING id", [userId])).rows[0].id;
    await db.query(`INSERT INTO messages(conv_id,role,content,metadata,created_at) VALUES
      ($1,'user','FE11 durable request',NULL,now() - interval '1 second'),
      ($1,'assistant','FE11 durable planning error','{"type":"planning_error"}'::jsonb,now())`, [conversationId]);

    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await expect(page.getByRole('textbox', { name: /Mô tả công việc|Nhập câu trả lời/ })).toBeVisible();
    await page.goto(`/c/${conversationId}`);
    await expect(page).toHaveURL(new RegExp(`/c/${conversationId}$`));
    const oldTokens = await page.evaluate(() => ({ access: localStorage.getItem('wap_access_token'), refresh: localStorage.getItem('wap_refresh_token') }));
    const otherSession = await page.request.post('/api/auth/login', { data: { email, password } });
    const otherAccessToken = (await otherSession.json()).accessToken;
    await page.goto('about:blank');
    expect((await page.request.post('/api/auth/logout-all', { headers: { Authorization: `Bearer ${otherAccessToken}` } })).status()).toBe(200);
    expect((await page.request.get('/api/auth/me', { headers: { Authorization: `Bearer ${oldTokens.access}` } })).status()).toBe(401);
    const revokedRefresh = await page.request.post('/api/auth/refresh', { data: { refreshToken: oldTokens.refresh } });
    expect(revokedRefresh.status()).toBe(401);

    await page.goto(`/c/${conversationId}`);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText('Phiên đăng nhập đã hết hạn')).toBeVisible();
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/c/${conversationId}$`));
    await expect(page.getByRole('region', { name: 'Cockpit' }).getByText('FE11 durable request')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'Sự cố máy chủ' })).toBeVisible();
  } finally {
    await db.query('DELETE FROM messages WHERE conv_id IN (SELECT id FROM conversations WHERE user_id=(SELECT id FROM users WHERE email=$1))', [email]);
    await db.query('DELETE FROM conversations WHERE user_id=(SELECT id FROM users WHERE email=$1)', [email]);
    await db.query('DELETE FROM users WHERE email=$1', [email]);
    await db.end();
  }
});
