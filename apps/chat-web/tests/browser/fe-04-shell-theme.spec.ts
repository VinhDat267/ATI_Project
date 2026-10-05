import { test, expect, type Page } from '@playwright/test';
const email = process.env.CHAT_ADMIN_EMAIL || 'admin@example.com';
const password = process.env.CHAT_ADMIN_PASSWORD || 'admin123';
async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email); await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByPlaceholder('Mô tả công việc bạn muốn thực hiện...')).toBeVisible();
}
test('FE-04: saved dark bootstrap paints before React and public routes need no session', async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem('ati-theme', 'dark'));
  await page.route('**/src/main.tsx', route => route.abort());
  await page.goto('/guide', { waitUntil: 'load' });
  await expect(page.locator('html')).toHaveClass(/dark/);
  expect(await page.locator('html').evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(11, 16, 32)');
  await page.screenshot({ path: info.outputPath('FE04-dark-before-react.png'), fullPage: true });
  await page.unroute('**/src/main.tsx'); await page.reload();
  await expect(page.getByRole('heading', { name: 'Cẩm nang', level: 1 })).toBeVisible();
  await page.goto('/privacy'); await expect(page.getByRole('heading', { name: 'Chính sách an toàn', level: 1 })).toBeVisible();
  await expect(page.getByLabel('Mật khẩu')).toHaveCount(0);
});
test('FE-04: shell menu, protected routes, cross-tab theme and mobile sandbox warning', async ({ page, context }, info) => {
  await login(page);
  const composer = page.getByPlaceholder('Mô tả công việc bạn muốn thực hiện...');
  await composer.focus();
  expect(await composer.evaluate(el => ({ width: getComputedStyle(el).outlineWidth, style: getComputedStyle(el).outlineStyle, color: getComputedStyle(el).outlineColor }))).toEqual({ width: '2px', style: 'solid', color: 'rgb(255, 87, 1)' });
  const avatar = page.getByRole('button', { name: /Menu người dùng/ });
  await avatar.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Nhật ký điều phối' })).toBeFocused();
  await page.getByRole('menuitem', { name: 'Nhật ký điều phối' }).press('Escape'); await expect(avatar).toBeFocused();
  await avatar.click(); await page.getByRole('menuitem', { name: 'Kết nối dịch vụ' }).click();
  await expect(page).toHaveURL(/\/settings$/); await expect(page.getByRole('heading', { name: /Cài đặt & Tích hợp/, level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Nhật ký điều phối', exact: true }).click();
  await expect(page).toHaveURL(/\/history$/); await expect(page.getByRole('heading', { name: 'Nhật ký điều phối', level: 1 })).toBeVisible();
  const other = await context.newPage(); await other.goto('/guide');
  await page.getByRole('button', { name: 'Chuyển sang giao diện Tối' }).click();
  await expect(other.locator('html')).toHaveClass(/dark/);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText('Thử nghiệm · không gọi dịch vụ thật', { exact: true })).toBeVisible();
  await expect(page.getByText('Chế độ thử nghiệm: kế hoạch mẫu, không gọi dịch vụ thật', { exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Là gì?' }).click();
  await expect(page.getByText(/Chế độ do máy chủ quyết định/)).toBeVisible();
  await page.screenshot({ path: info.outputPath('FE04-mobile-dark-shell.png'), fullPage: true });
  await other.close();
});
