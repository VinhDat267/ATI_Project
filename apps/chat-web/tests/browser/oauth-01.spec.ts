import { test, expect, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(process.env.CHAT_ADMIN_EMAIL!);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(process.env.CHAT_ADMIN_PASSWORD!);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hôm nay bạn muốn nhờ việc gì?');
}

/** Tabs through the refusal actions from the title; each one must be on screen, not under the fixed composer. */
async function tabThroughActions(page: Page) {
  await page.locator('#response-card-title').focus();
  const seen: string[] = [];
  for (;;) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element?.closest('#s1-action-area')) return null;
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return { name: element.textContent?.trim() ?? '', top: rect.top, bottom: rect.bottom, viewport: innerHeight,
        unobscured: rect.top >= 0 && rect.bottom <= innerHeight && (hit === element || element.contains(hit)), blocker: hit?.id || hit?.tagName };
    });
    if (!stop) return seen;
    expect(stop.unobscured, JSON.stringify(stop)).toBe(true);
    seen.push(stop.name);
  }
}

for (const width of [1440, 375]) {
  test(`OAUTH-01 from chat: actions reached with Tab stay above the composer ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await login(page);
    const token = await page.evaluate(() => localStorage.getItem('wap_access_token'));
    await page.request.delete('/api/connections/gmail', { headers: { Authorization: `Bearer ${token}` } });
    await page.getByRole('textbox').fill('Trả lời email mới nhất trong luồng Họp nhóm ATI');
    await page.getByRole('button', { name: 'Gửi yêu cầu', exact: true }).click();
    const connect = page.getByRole('link', { name: /Kết nối Gmail/ });
    await expect(connect).toBeVisible();
    expect(await tabThroughActions(page)).toEqual(['Kết nối Gmail→', 'Sửa yêu cầu']);

    // Connected, a status line above the actions pushes them down. Only the keyboard moves focus here,
    // so Playwright does not scroll the page the way it does before a click.
    await connect.click();
    await expect(page.getByText('Gmail đã được kết nối. Bạn có thể gửi lại yêu cầu.')).toBeVisible();
    await page.evaluate(() => scrollTo(0, 0));
    expect(await tabThroughActions(page)).toEqual(['Gửi lại yêu cầu', 'Sửa yêu cầu']);
  });
}

for (const width of [1440, 375]) for (const theme of ['light', 'dark']) {
  test(`OAUTH-01 from chat: connect Gmail from the refusal, come back to the conversation and send again ${width} ${theme}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(value => localStorage.setItem('ati-theme', value), theme);
    await login(page);
    const token = await page.evaluate(() => localStorage.getItem('wap_access_token'));
    await page.request.delete('/api/connections/gmail', { headers: { Authorization: `Bearer ${token}` } });

    await page.getByRole('textbox').fill('Trả lời email mới nhất trong luồng Họp nhóm ATI');
    await page.getByRole('button', { name: 'Gửi yêu cầu', exact: true }).click();
    const connect = page.getByRole('link', { name: /Kết nối Gmail/ });
    await expect(connect).toBeVisible();
    const conversation = new URL(page.url()).pathname;
    expect(conversation).toMatch(/^\/c\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('button', { name: 'Gửi lại yêu cầu' })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`oauth-01-refusal-${width}-${theme}.png`), fullPage: true });

    // The fake Google consent answers at once; the callback page then returns here, not to /settings.
    await connect.click();
    await expect(page).toHaveURL(new RegExp(`${conversation}$`));
    await expect(page.getByText('Đã kết nối · gmail-owner@example.test')).toBeVisible();
    await expect(page.getByText('Gmail đã được kết nối. Bạn có thể gửi lại yêu cầu.')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`oauth-01-connected-${width}-${theme}.png`), fullPage: true });

    // Nothing was sent again on its own: the plan comes only after the button, and still waits for approval.
    await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('Tôi sẽ làm 1 việc, theo thứ tự');
    await page.getByRole('button', { name: 'Gửi lại yêu cầu' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tôi sẽ làm 1 việc, theo thứ tự');
    await expect(page.getByText('Gửi từ: gmail-owner@example.test', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Duyệt kế hoạch', exact: true })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(conversation);
    await page.screenshot({ path: info.outputPath(`oauth-01-plan-${width}-${theme}.png`), fullPage: true });
  });
}
