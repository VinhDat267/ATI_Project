import { test, expect } from '@playwright/test';
import pg from 'pg';

for (const width of [1440, 375]) for (const theme of ['light', 'dark']) {
  test(`ANS-01: read answer, reload and follow-up write ${width} ${theme}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(value => localStorage.setItem('ati-theme', value), theme);
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill(process.env.CHAT_ADMIN_EMAIL!);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(process.env.CHAT_ADMIN_PASSWORD!);
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hôm nay bạn muốn nhờ việc gì?');
    const answerEvent = page.waitForResponse(response => response.url().includes('/stream') && response.status() === 200);
    await page.getByRole('textbox').fill('Xem các issue Jira đang mở');
    await page.getByRole('button', { name: 'Gửi yêu cầu', exact: true }).click();
    await answerEvent;
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Câu trả lời');
    const text = page.locator('[data-answer-text]');
    await expect(text).toContainText('<b>x</b> https://a.example');
    await expect(text.locator('b,a')).toHaveCount(0);
    await expect(page.getByText('Chưa có gì được ghi lên công cụ nào.')).toBeVisible();
    await expect(page.getByText(/1 lần tra cứu/)).toBeVisible();
    await page.getByRole('button', { name: 'Đã tra cứu' }).click();
    const link = page.getByRole('link', { name: 'https://ati-test.atlassian.net/browse/ATI-42' });
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(page.getByRole('textbox')).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`answer-${width}-${theme}.png`), fullPage: true });
    const conversationId = new URL(page.url()).pathname.split('/').at(-1)!;
    const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const saved = (await db.query("SELECT content,metadata FROM messages WHERE conv_id=$1 AND metadata->>'type'='answer'", [conversationId])).rows[0];
      expect(saved.metadata.replyToMessageId).toBeTruthy();
      expect(saved.metadata.lookups[0].tool).toBe('jira.search_issues');
      expect((await db.query('SELECT * FROM plans WHERE conv_id=$1', [conversationId])).rows).toHaveLength(0);
      await page.reload();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Câu trả lời');
      await expect(text).toContainText('<b>x</b>');
      await page.getByRole('textbox').fill('Gửi tóm tắt này vào Slack');
      await page.getByRole('button', { name: 'Gửi tin nhắn', exact: true }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tôi sẽ làm 1 việc, theo thứ tự');
      await expect(page.getByRole('button', { name: /Duyệt/ })).toBeVisible();
      const plans = (await db.query('SELECT id,status,plan_json FROM plans WHERE conv_id=$1', [conversationId])).rows;
      expect(plans).toHaveLength(1); expect(plans[0].status).toBe('pending');
      expect(plans[0].plan_json.steps[0].tool).toBe('slack.send_message');
      expect((await db.query('SELECT * FROM execution_steps WHERE plan_id=$1', [plans[0].id])).rows).toHaveLength(0);
    } finally { await db.end(); }
  });
}
