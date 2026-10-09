import { test, expect, type Page } from '@playwright/test';
import pg from 'pg';
const email = process.env.CHAT_ADMIN_EMAIL, password = process.env.CHAT_ADMIN_PASSWORD;
const connectionString = process.env.DATABASE_URL;
if (!email || !password || !connectionString) throw new Error('FE-03b browser requires provisioned local test account and database');
async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email!); await page.getByLabel('Mật khẩu', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Hôm nay bạn muốn nhờ việc gì?' })).toBeVisible();
}
const conversationIds = async (pool: pg.Pool) => (await pool.query(
  'SELECT c.id FROM conversations c JOIN users u ON u.id = c.user_id WHERE u.email = $1', [email])).rows.map(row => row.id as string);
test('FE-03b: a message sent while New conversation is pending goes to that conversation', async ({ page }) => {
  const pool = new pg.Pool({ connectionString });
  try {
    await login(page);
    const before = new Set(await conversationIds(pool));
    let releaseCreate!: () => void, releaseSend!: () => void;
    const createGate = new Promise<void>(resolve => { releaseCreate = resolve; });
    const sendGate = new Promise<void>(resolve => { releaseSend = resolve; });
    let creates = 0;
    await page.route(/\/api\/conversations$/, async route => {
      if (route.request().method() !== 'POST') return route.continue();
      creates++; await createGate; await route.continue();
    });
    await page.route('**/api/conversations/*/messages', async route => { await sendGate; await route.continue(); });

    await page.getByRole('button', {name:'Mở danh sách hội thoại'}).click(); await page.getByRole('button', {name:/Cuộc hội thoại mới/}).click();
    await expect.poll(() => creates).toBe(1);
    const content = `FE-03b gửi khi đang tạo hội thoại ${Date.now()}`;
    const input = page.getByRole('textbox', { name: /Mô tả công việc bạn muốn thực hiện|Nhập câu trả lời làm rõ yêu cầu/ });
    await input.fill(content); await input.press('Enter');
    releaseCreate();

    await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
    await expect(page.getByText('Đang lập kế hoạch…')).toBeVisible();
    await expect(page.getByRole('heading',{level:1})).toBeVisible();
    releaseSend();
    await expect(page.getByRole('button', { name: /Duyệt kế hoạch/ })).toBeVisible();

    const shown = new URL(page.url()).pathname.split('/').pop()!;
    expect(creates).toBe(1);
    expect((await conversationIds(pool)).filter(id => !before.has(id))).toEqual([shown]);
    const saved = await pool.query("SELECT conv_id FROM messages WHERE role = 'user' AND content = $1", [content]);
    expect(saved.rows.map(row => row.conv_id)).toEqual([shown]);
  } finally { await pool.end(); }
});
