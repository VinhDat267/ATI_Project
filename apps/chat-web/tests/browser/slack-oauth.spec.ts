import { test, expect } from '@playwright/test';
for (const width of [375, 1440]) for (const theme of ['light', 'dark']) {
  test(`SLACK-02: OAuth metadata, two workspaces and independent disconnect ${width} ${theme}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(value => localStorage.setItem('ati-theme', value), theme);
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill(process.env.CHAT_ADMIN_EMAIL!);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(process.env.CHAT_ADMIN_PASSWORD!);
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hôm nay bạn muốn nhờ việc gì?');
    const token = await page.evaluate(() => localStorage.getItem('wap_access_token'));
    const headers = { Authorization: `Bearer ${token}` };
    const existing = await (await page.request.get('/api/connections/myslack', { headers })).json();
    for (const row of existing.connections) await page.request.delete('/api/connections/myslack/' + row.id, { headers });
    await page.goto('/settings');
    for (let i = 0; i < 2; i++) {
      await page.getByRole('button', { name: 'Kết nối workspace Slack' }).click();
      await expect(page.getByRole('heading', { name: 'Đã kết nối Slack' })).toBeVisible();
      expect(new URL(page.url()).search).toBe('');
      await expect(page.getByText('Đang hoàn tất kết nối Slack…', { exact: true })).toHaveCount(0);
      if (i === 0) await page.screenshot({ path: info.outputPath(`slack-connected-${width}-${theme}.png`), fullPage: true });
      await page.getByRole('button', { name: 'Về Kết nối dịch vụ' }).click();
      await expect(page.locator('#myslack li')).toHaveCount(i + 1);
    }
    await expect(page.locator('#myslack')).toContainText('ATI chưa đọc tin');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`slack-workspaces-${width}-${theme}.png`), fullPage: true });
    await page.locator('#myslack li').first().getByRole('button', { name: /Ngắt kết nối/ }).click();
    await expect(page.locator('#myslack li')).toHaveCount(1);
    await expect(page.locator('#myslack [role=status]')).toContainText('thu hồi quyền Slack');
  });
}
