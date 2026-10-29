import { test, expect } from '@playwright/test';
for (const width of [375, 1440]) for (const theme of ['light', 'dark']) {
  test(`NOTION-01: OAuth, database scope and independent disconnect ${width} ${theme}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(value => localStorage.setItem('ati-theme', value), theme);
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill(process.env.CHAT_ADMIN_EMAIL!);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(process.env.CHAT_ADMIN_PASSWORD!);
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hôm nay bạn muốn nhờ việc gì?');
    const token = await page.evaluate(() => localStorage.getItem('wap_access_token')), headers = { Authorization: `Bearer ${token}` };
    const existing = await (await page.request.get('/api/connections/mynotion', { headers })).json();
    for (const row of existing.connections) await page.request.delete('/api/connections/mynotion/' + row.id, { headers });
    await page.goto('/settings');
    for (let i = 0; i < 2; i++) {
      await page.getByRole('button', { name: 'Kết nối workspace Notion' }).click();
      await expect(page.getByRole('heading', { name: 'Đã kết nối Notion' })).toBeVisible(); expect(new URL(page.url()).search).toBe('');
      if (i === 0) await page.screenshot({ path: info.outputPath(`notion-connected-${width}-${theme}.png`), fullPage: true });
      await page.getByRole('button', { name: 'Về Kết nối dịch vụ' }).click(); await expect(page.locator('#mynotion li')).toHaveCount(i + 1);
    }
    const first = page.locator('#mynotion li').first();
    await first.getByRole('button', { name: /Chọn database/ }).click(); await first.getByRole('checkbox', { name: 'Tasks fixture' }).check();
    await first.getByRole('button', { name: 'Lưu database được dùng' }).click();
    await expect(first).toContainText('Đã chọn 1 database');
    await expect(page.locator('#mynotion [role=status]')).toContainText('Công cụ Notion cá nhân chưa được mở');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`notion-scope-${width}-${theme}.png`), fullPage: true });
    await first.getByRole('button', { name: /Ngắt kết nối/ }).click(); await expect(page.locator('#mynotion li')).toHaveCount(1);
    await expect(page.locator('#mynotion [role=status]')).toContainText('thu hồi quyền Notion');
  });
}
