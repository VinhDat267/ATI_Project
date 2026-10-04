import { test, expect, type Page } from '@playwright/test';
import pg from 'pg';
const email = process.env.CHAT_ADMIN_EMAIL, password = process.env.CHAT_ADMIN_PASSWORD;
const connectionString = process.env.DATABASE_URL;
if (!email || !password || !connectionString) throw new Error('FE-03 browser requires provisioned local test account and database');
async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email!); await page.getByLabel('Mật khẩu').fill(password!);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'AI Workflow Platform' })).toBeVisible();
}
const composer = (page: Page) => page.locator('form').filter({ has: page.getByPlaceholder('Mô tả công việc bạn muốn thực hiện...') });
test('FE-03: grounded display names survive preview reload and approved result links are safe', async ({ page }, info) => {
  const pool = new pg.Pool({ connectionString });
  try {
    await login(page);
    const token = await page.evaluate(() => localStorage.getItem('wap_access_token'));
    const response = await page.request.post('/api/conversations', { headers: { Authorization: `Bearer ${token}` } });
    const convId = (await response.json()).conversation.id;
    // Grounding fixture is explicit sandbox data; live lookups are exercised in the
    // PostgreSQL integration test. The production ChatService derives all labels.
    await pool.query("INSERT INTO messages(conv_id,role,content,metadata) VALUES($1,'system','',$2::jsonb)", [convId, JSON.stringify({ type: 'working_memory', state: { __observed: {
      board: [{ id: 'board_frontend', name: 'Frontend' }],
      list: [{ id: 'list_frontend_todo', name: 'Cần làm', boardId: 'board_frontend' }],
      member: [{ id: 'member_minh_dev', name: 'Minh Dev', boardId: 'board_frontend' }],
      channel: [{ id: '#general', name: 'general' }],
    } } })]);
    await page.goto(`/c/${convId}`);
    await page.getByPlaceholder('Mô tả công việc bạn muốn thực hiện...').fill('Tạo công việc Trello và thông báo Slack');
    await composer(page).getByRole('button', { name: 'Gửi', exact: true }).click();
    await expect(page.getByRole('button', { name: /Duyệt kế hoạch/ })).toBeVisible();
    await expect(page.getByText('Cần làm (board Frontend)', { exact: true })).toBeVisible();
    await expect(page.getByText('list_frontend_todo', { exact: true })).toBeVisible();
    await expect(page.getByText('Ghi', { exact: true })).toHaveCount(3);
    await page.reload();
    await expect(page.getByRole('button', { name: /Duyệt kế hoạch/ })).toBeVisible();
    await expect(page.locator('[data-testid="arg-listId"]').last()).toHaveText('list_frontend_todo');
    await page.getByRole('button', { name: /Duyệt kế hoạch/ }).click();
    await expect(page.getByText(/Đã hoàn thành 3\/3 bước/)).toBeVisible();
    const link = page.getByRole('link', { name: 'https://trello.com/c/sandbox/card', exact: true });
    await expect(link).toBeVisible(); await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(page.getByText(/^Kế hoạch đã duyệt:/)).toBeVisible();
    await expect(page.getByRole('main')).toHaveCount(1); await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('log')).toHaveAttribute('aria-live', 'polite');
    await page.screenshot({ path: info.outputPath('fe03-readable-result.png'), fullPage: true });
  } finally { await pool.end(); }
});
test('FE-03: Shift Enter creates a newline and planning disables a second send', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Cuộc hội thoại mới', exact: true }).click();
  const input = page.getByPlaceholder('Mô tả công việc bạn muốn thực hiện...');
  await input.fill('Tạo công việc Trello'); await input.press('Shift+Enter'); await input.press('a');
  await expect(input).toHaveValue('Tạo công việc Trello\na');
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let sent = 0;
  await page.route('**/api/conversations/*/messages', async route => { sent++; await gate; await route.continue(); });
  await input.press('Enter');
  await expect(composer(page).getByRole('button', { name: 'Gửi', exact: true })).toBeDisabled();
  await expect(page.getByText('Đang lập kế hoạch…')).toBeVisible();
  await input.fill('Tin nhắn trùng'); await input.press('Enter');
  await expect.poll(() => sent).toBe(1); release();
  await expect(page.getByRole('button', { name: /Duyệt kế hoạch/ })).toBeVisible();
});
