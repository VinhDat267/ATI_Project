import { test, expect } from '@playwright/test';
for (const width of [1440, 375])
  for (const theme of ['light', 'dark'] as const) {
    test(`FE-05: FE-05b compact header and real transition focus ${width} ${theme}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
      await page.emulateMedia({ colorScheme: theme });
      await page.goto('/login');
      await page.getByLabel('Email').fill(process.env.CHAT_ADMIN_EMAIL!);
      await page.getByLabel('Mật khẩu').fill(process.env.CHAT_ADMIN_PASSWORD!);
      await page
        .getByRole('button', { name: 'Đăng nhập', exact: true })
        .click();
      await expect(page.locator('html')).toHaveAttribute(
        'data-proto-page',
        'app-stage',
      );
      await expect(
        page.getByRole('heading', { name: 'Hôm nay bạn muốn nhờ việc gì?' }),
      ).toBeVisible();
      await expect(page.locator('textarea:visible')).toHaveCount(1);
      await expect(page.locator('header')).toHaveCount(1);
      await expect(
        page.getByRole('button', { name: 'Cuộc hội thoại mới', exact: true }),
      ).toHaveCount(0);
      await expect(page.locator('#test-mode-banner')).toBeVisible();
      const metrics = await page.evaluate(() => ({
        header: document.querySelector('header')!.getBoundingClientRect()
          .height,
        scroll: document.documentElement.scrollWidth,
        viewport: innerWidth,
      }));
      expect(metrics.header).toBeLessThanOrEqual(width === 375 ? 120 : 100);
      expect(metrics.scroll).toBeLessThanOrEqual(metrics.viewport);
      await info.attach('FE05b-header', {
        body: JSON.stringify(metrics),
        contentType: 'application/json',
      });
      await page
        .getByRole('textbox')
        .fill('Tạo công việc Trello và thông báo Slack');
      await page.getByRole('textbox').press('Enter');
      const approve = page.getByRole('button', {
        name: 'Duyệt kế hoạch',
        exact: true,
      });
      await expect(approve).toBeVisible();
      await expect(page.locator('textarea:visible')).toHaveCount(1);
      await page.route('**/api/plans/*/approve', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        await route.continue();
      });
      await page.evaluate(() => {
        document.scrollingElement!.scrollTop = 300;
      });
      await expect
        .poll(() => page.evaluate(() => document.scrollingElement!.scrollTop))
        .toBeGreaterThan(0);
      await approve.click();
      const heading = page.getByRole('heading', { level: 1 });
      await expect(heading).toHaveText('ATI đang làm');
      await expect(heading).toBeFocused();
      expect(
        await page.evaluate(() => document.scrollingElement!.scrollTop),
      ).toBe(0);
      const rect = await heading.boundingBox();
      expect(rect!.y).toBeGreaterThanOrEqual(metrics.header);
      expect(rect!.y + rect!.height).toBeLessThanOrEqual(
        width === 375 ? 812 : 900,
      );
      await expect(heading).toHaveText('Việc đã xong');
      await expect(heading).toBeFocused();
      expect(
        await page.evaluate(() => document.scrollingElement!.scrollTop),
      ).toBe(0);
      await expect(page.locator('textarea:visible')).toHaveCount(1);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      await page.route('**/api/conversations/*/messages', async (route) => {
        await gate;
        await route.continue();
      });
      try {
        const typing = page.getByRole('textbox');
        await typing.fill('Tạo công việc Trello và thông báo Slack');
        await typing.press('Enter');
        await expect(page.locator('#moment-2')).toBeVisible();
        await expect(page.locator('textarea:visible')).toHaveCount(1);
        await expect(page.getByRole('textbox')).toBeFocused();
      } finally {
        release();
      }
      await expect(approve).toBeVisible();
    });
  }
test('FE-05b clarification before plan has one textarea and explicit radio confirmation', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(process.env.CHAT_ADMIN_EMAIL!);
  await page.getByLabel('Mật khẩu').fill(process.env.CHAT_ADMIN_PASSWORD!);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.locator('#moment-1')).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Mô tả công việc bạn muốn thực hiện' })
    .fill('Tạo task trên board Frontend, gán Minh và thông báo Slack');
  await page.getByRole('textbox').press('Enter');
  await expect(page.locator('#moment-3')).toBeVisible();
  await expect(page.locator('textarea:visible')).toHaveCount(1);
  await page
    .getByRole('radio', { name: 'Để tôi gõ tên hoặc link khác' })
    .click();
  await expect(page.locator('textarea:visible')).toHaveCount(1);
  await page.getByRole('radio').first().click();
  await expect(page.locator('#moment-3')).toBeVisible();
  await page.getByRole('button', { name: 'Xác nhận và tiếp tục' }).click();
  await expect(
    page.getByRole('button', { name: 'Duyệt kế hoạch', exact: true }),
  ).toBeVisible();
});
