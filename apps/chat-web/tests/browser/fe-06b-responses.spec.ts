import { test, expect, type Page } from '@playwright/test';
import pg from 'pg';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { hashPassword } from '../../../chat-api/src/db/repositories/user-repo.js';
import { randomUUID } from 'node:crypto';

const evidence = resolve('node_modules/.cache/fe06b/screenshots');
const fixtures = [
  { key: 'unavailable', prompt: 'Tạo page Notion ghi biên bản họp sprint và báo lên Slack #ati-test', content: 'Từ chối yêu cầu: Notion chưa được kết nối hoặc chưa có tài nguyên được phép.', metadata: { type: 'refusal', reason: 'Notion chưa được kết nối hoặc chưa có tài nguyên được phép.', suggestion: 'Vì yêu cầu cần Notion, tôi không làm riêng phần Slack.', unavailableServices: [{ id: 'notion', name: 'Notion' }] } },
  { key: 'unsupported', prompt: 'Xoá hết các card cũ trong bảng To Do', content: 'Từ chối yêu cầu: Tôi chưa có thao tác xoá card trên Trello.\nGợi ý: Bạn có thể lưu trữ các card cũ thay vì xoá.', metadata: { type: 'refusal', reason: 'Tôi chưa có thao tác xoá card trên Trello.', suggestion: 'Bạn có thể lưu trữ các card cũ thay vì xoá.' } },
  { key: 'read-only', prompt: 'Liệt kê các issue đang mở trong ati-test', content: 'Bạn muốn làm gì với danh sách issue này?', metadata: { type: 'clarification', context: 'Tôi làm những việc có thay đổi trên công cụ, như tạo, ghi hoặc gửi. Bạn chọn một việc bên dưới, hoặc tự nhập.', options: ['Gửi danh sách lên Slack #ati-test', 'Ghi danh sách vào Google Sheets', 'Tạo một card Trello tổng hợp'] } },
  { key: 'destination', prompt: 'Báo kênh #marketing là bản build mới đã lên', content: 'Tôi không thấy kênh #marketing', metadata: { type: 'clarification', context: 'Trong các kênh Slack nhóm cho phép, tôi chỉ thấy #ati-test. Bạn muốn gửi vào kênh nào?', options: ['Gửi vào #ati-test'] } },
  { key: 'server', prompt: 'Tạo card Trello cho lỗi đăng nhập Google, tạo issue GitHub, ghi vào Google Sheets và báo kênh Slack', content: 'Không thể lập kế hoạch lúc này. Hãy thử lại.', metadata: { type: 'planning_error' } },
];
async function login(page: Page, email = process.env.CHAT_ADMIN_EMAIL!, password = process.env.CHAT_ADMIN_PASSWORD!) {
  await page.goto('/login'); await page.getByLabel('Email', { exact: true }).fill(email); await page.getByLabel('Mật khẩu', { exact: true }).fill(password); await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hôm nay bạn muốn nhờ việc gì?');
}
async function capture(page: Page, key: string, width: number, theme: string) {
  await expect(page.locator('textarea:visible')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: resolve(evidence, `app-${key}-${width}-${theme}.png`), animations: 'disabled' });
}
for (const width of [1440, 375]) for (const theme of ['light', 'dark'] as const) {
  test(`FE-06B: responses and general errors ${width} ${theme}`, async ({ page, context }) => {
    test.setTimeout(90_000); await mkdir(evidence, { recursive: true }); await page.setViewportSize({ width, height: width === 375 ? 812 : 900 }); await page.emulateMedia({ colorScheme: theme });
    await login(page);
    const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const owner = (await db.query('SELECT id FROM users WHERE email=$1', [process.env.CHAT_ADMIN_EMAIL])).rows[0].id;
      for (const fixture of fixtures) {
        const id = (await db.query('INSERT INTO conversations(user_id,title) VALUES($1,$2) RETURNING id', [owner, `FE06B ${fixture.key} ${width} ${theme}`])).rows[0].id;
        await db.query("INSERT INTO messages(conv_id,role,content) VALUES($1,'user',$2)", [id, fixture.prompt]);
        await db.query("INSERT INTO messages(conv_id,role,content,metadata) VALUES($1,'assistant',$2,$3::jsonb)", [id, fixture.content, JSON.stringify(fixture.metadata)]);
        // Planning errors are persisted as system messages in production.
        if (fixture.key === 'server') await db.query("UPDATE messages SET role='system' WHERE conv_id=$1 AND role='assistant'", [id]);
        await page.goto(`/c/${id}`);
        if (fixture.key === 'server') await expect(page.getByText('Không thể lập kế hoạch lúc này. Hãy thử lại.', { exact: true })).toBeVisible();
        else await expect(page.getByText('Chưa có gì được ghi lên công cụ nào.', { exact: true })).toBeVisible();
        if (fixture.key === 'unavailable') await expect(page.getByRole('link', { name: 'Kết nối Notion' })).toHaveAttribute('href', '/settings#notion');
        if (fixture.key === 'destination') await expect(page.getByRole('link', { name: /Thêm ở Kết nối dịch vụ/ })).toHaveAttribute('href', '/settings#slack');
        if (fixture.key === 'read-only') await expect(page.getByRole('radio')).toHaveCount(3);
        if (fixture.key !== 'server') expect(await page.getByRole('button', { name: 'Gửi tin nhắn', exact: true }).evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(255, 87, 1)');
        await capture(page, fixture.key, width, theme);
        if (fixture.key === 'unsupported') { await page.getByRole('button', { name: 'Sửa yêu cầu', exact: true }).click(); await expect(page.getByRole('textbox')).toHaveValue(fixture.prompt); await expect(page.getByRole('textbox')).toBeFocused(); }
      }
      await context.setOffline(true); await expect(page.locator('#network-offline-banner')).toBeVisible(); await capture(page, 'offline', width, theme);
      await page.locator('#network-offline-banner').getByRole('button', { name: 'Thử lại', exact: true }).click();
      await expect(page.locator('#network-offline-banner').getByRole('button')).toHaveText('Thử lại');
      await context.setOffline(false); await expect(page.locator('#network-offline-banner')).toHaveCount(0);

      const slowId = (await db.query('INSERT INTO conversations(user_id,title) VALUES($1,$2) RETURNING id', [owner, 'FE06B slow request'])).rows[0].id;
      const slowPrompt = 'Tạo card Trello, gửi Slack, tạo issue GitHub rồi ghi vào Google Sheets';
      await db.query("INSERT INTO messages(conv_id,role,content) VALUES($1,'user',$2)", [slowId, slowPrompt]);
      await page.route(`**/api/conversations/${slowId}/stream`, route => route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'event: agent_state\ndata: {"state":"planning","requestId":"slow-case"}\n\nevent: gather_progress\ndata: {"steps":[{"tool":"trello.list_boards","status":"completed","result":"To Do"},{"tool":"slack.list_channels","status":"completed","result":"#ati-test"},{"tool":"github.search_issues","status":"running"}],"summary":"2/3 công cụ đã khảo sát"}\n\n' }));
      await page.clock.install(); await page.goto(`/c/${slowId}`); await expect(page.locator('#moment-2')).toBeVisible(); await page.clock.fastForward(16_000);
      await expect(page.getByRole('button', { name: 'Thôi chờ, giữ lại câu yêu cầu' })).toBeVisible(); await capture(page, 'slow', width, theme);
      await page.getByRole('button', { name: 'Thôi chờ, giữ lại câu yêu cầu' }).click(); await expect(page.getByRole('textbox')).toHaveValue(slowPrompt); await expect(page.getByRole('button', { name: 'Gửi yêu cầu', exact: true })).toBeDisabled();
    } finally { await db.end(); }
  });
}
test('FE-06B: durable responses respect member permissions and session expiry returns to login', async ({ page }) => {
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL }); const id = randomUUID(), email = `fe06b-${id}@example.test`, password = 'FE06b-member-test-only';
  try {
    await db.query("INSERT INTO users(id,email,password,name,status,role,email_verified) VALUES($1,$2,$3,'FE06B Member','active','member',true)", [id, email, hashPassword(password)]);
    await login(page, email, password);
    const conv = (await db.query('INSERT INTO conversations(user_id,title) VALUES($1,$2) RETURNING id', [id, 'FE06B member refusal'])).rows[0].id;
    await db.query("INSERT INTO messages(conv_id,role,content) VALUES($1,'user',$2)", [conv, fixtures[0].prompt]);
    await db.query("INSERT INTO messages(conv_id,role,content,metadata) VALUES($1,'assistant',$2,$3::jsonb)", [conv, fixtures[0].content, JSON.stringify(fixtures[0].metadata)]);
    await page.goto(`/c/${conv}`); await expect(page.getByText(/Chỉ quản trị viên kết nối được dịch vụ mới/)).toBeVisible(); await expect(page.getByRole('link', { name: 'Kết nối Notion' })).toHaveCount(0);
    await page.getByRole('textbox').fill('Bản nháp chưa gửi');
    await page.evaluate(async modulePath => { const { authStorage } = await import(modulePath); authStorage.clearStoredTokens(); }, '/src/services/auth-storage.ts');
    await expect(page).toHaveURL(/\/login$/); await expect(page.getByText('Phiên đăng nhập đã hết hạn', { exact: true })).toBeVisible();
    await expect(page.getByText(/bản nháp.*(?:lưu|giữ)/i)).toHaveCount(0);
    for (const width of [1440, 375]) for (const theme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 900 }); await page.emulateMedia({ colorScheme: theme });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: resolve(evidence, `app-session-${width}-${theme}.png`), animations: 'disabled' });
    }
  } finally { await db.end(); }
});
