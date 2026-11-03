import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';

async function login(page: Page, email: string, pass: string) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(pass);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByRole('main')).toBeVisible();
}

const VIEWPORTS = [
  { width: 1440, height: 900, label: '1440x900' },
  { width: 1024, height: 768, label: '1024x768' },
  { width: 768, height: 1024, label: '768x1024' },
  { width: 375, height: 812, label: '375x812' },
  { width: 320, height: 568, label: '320x568' },
];

const THEMES = ['light', 'dark'] as const;

for (const vp of VIEWPORTS) {
  for (const theme of THEMES) {
    test(`PL-05: Planora chat workspace and one-composer policy ${vp.label} ${theme}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.addInitScript(val => localStorage.setItem('ati-theme', val), theme);

      await login(page, process.env.CHAT_ADMIN_EMAIL!, process.env.CHAT_ADMIN_PASSWORD!);

      // Single main landmark
      await expect(page.getByRole('main')).toHaveCount(1);

      // Workspace container exists
      const workspace = page.locator('.planora-chat-workspace');
      await expect(workspace).toBeVisible();

      // One-Composer Policy: exactly one visible composer textarea
      const textareas = page.locator('textarea:visible');
      await expect(textareas).toHaveCount(1);

      const composer = page.getByRole('textbox', {
        name: /Mô tả công việc bạn muốn thực hiện|Nhập câu trả lời làm rõ yêu cầu/,
      });
      await expect(composer).toBeVisible();

      // F5 regression: hit-test at start of composer textarea must not hit sidebar
      if (vp.width >= 1024) {
        const inputReceivesClick = await page.evaluate(() => {
          const t = document.querySelector('textarea');
          if (!t) return false;
          const r = t.getBoundingClientRect();
          const at = document.elementFromPoint(r.x + 10, r.y + r.height / 2);
          return at === t || t.contains(at);
        });
        expect(inputReceivesClick).toBe(true);
      }

      // No horizontal overflow
      const noOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      );
      expect(noOverflow).toBe(true);

      // Verify conversation feed area exists
      const feed = page.locator('.planora-conversation-feed');
      await expect(feed).toBeVisible();

      // Open conversation history drawer if button is available
      const historyBtn = page.getByRole('button', { name: 'Mở danh sách hội thoại' });
      if (await historyBtn.isVisible()) {
        await historyBtn.click();
        const drawer = page.getByRole('dialog', { name: 'Lịch sử yêu cầu' });
        await expect(drawer).toBeVisible();

        // Close drawer
        await page.keyboard.press('Escape');
        await expect(drawer).not.toBeVisible();
      }

      // Save screenshot for primary breakpoints
      if (['1440x900', '375x812'].includes(vp.label)) {
        const screenshotDir = resolve(
          process.cwd(),
          'apps/chat-web/tests/screenshots/planora-chat'
        );
        await mkdir(screenshotDir, { recursive: true });
        const screenshotPath = resolve(
          screenshotDir,
          `chat-${theme}-${vp.label}.png`
        );
        await page.screenshot({ path: screenshotPath, fullPage: true });
        await page.screenshot({
          path: testInfo.outputPath(`chat-${theme}-${vp.label}.png`),
          fullPage: true,
        });
      }
    });
  }
}

test('PL-05: R1 long conversation feed scrolls independently within viewport without expanding shell', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const userRow = await pool.query('SELECT id FROM users WHERE email=$1', [process.env.CHAT_ADMIN_EMAIL]);
    if (!userRow.rows.length) return;
    const userId = userRow.rows[0].id;
    const convId = (
      await pool.query('INSERT INTO conversations(user_id, title) VALUES($1, $2) RETURNING id', [
        userId,
        'PL-05 Long Feed Test',
      ])
    ).rows[0].id;

    for (let i = 0; i < 80; i++) {
      await pool.query('INSERT INTO messages(conv_id, role, content) VALUES($1, $2, $3)', [
        convId,
        i % 2 === 0 ? 'user' : 'assistant',
        `Tin nhắn kiểm tra cuộn độc lập thứ ${i + 1}.`,
      ]);
    }

    await login(page, process.env.CHAT_ADMIN_EMAIL!, process.env.CHAT_ADMIN_PASSWORD!);
    await page.goto(`/c/${convId}`);

    const feed = page.locator('.planora-conversation-feed');
    await expect(feed).toBeVisible();

    // R1: Container must be bounded by viewport and scroll independently
    const metrics = await feed.evaluate((el) => ({
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
      scrollTop: el.scrollTop,
    }));

    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
    expect(metrics.clientHeight).toBeLessThan(900);

    // Reading history preserved
    await feed.evaluate((el) => {
      el.scrollTop = 100;
      el.dispatchEvent(new Event('scroll'));
    });
    await expect.poll(() => feed.evaluate((el) => el.scrollTop)).toBe(100);

    // Bottom spacing: last message should not be obscured by global bottom bar
    const lastMsg = feed.locator('> div').last();
    const lastMsgBox = await lastMsg.boundingBox();
    const bottomBar = page.locator('#global-bottom-bar');
    if (await bottomBar.isVisible()) {
      const barBox = await bottomBar.boundingBox();
      if (lastMsgBox && barBox) {
        expect(lastMsgBox.y + lastMsgBox.height).toBeLessThanOrEqual(barBox.y + 10);
      }
    }
  } finally {
    await pool.end();
  }
});
