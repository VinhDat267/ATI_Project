import { test, expect, type Page } from '@playwright/test';
const email = process.env.CHAT_ADMIN_EMAIL || 'admin@example.com';
const password = process.env.CHAT_ADMIN_PASSWORD || 'admin123';
async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email); await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByRole('textbox', { name: /Mô tả công việc bạn muốn thực hiện|Nhập câu trả lời làm rõ yêu cầu/ })).toBeVisible();
}
const notFound = (page: Page) => page.getByRole('heading', { level: 1, name: 'Không tìm thấy trang' });
const prototypeStyles = (page: Page) => page.locator('style[data-proto-theme], style[data-proto-page-css]');
// Tailwind v4 khai @property kiểu <color> cho biến gradient khi có utility gradient của v4; khi đó ghi đè chế độ tối của
// theme.css (dạng "màu var(--tw-gradient-from-position)") không còn hợp lệ. FE-04b đổi màn cũ sang giá trị viết thẳng.
const gradientPropertyRules = (page: Page) => page.evaluate(() => [...document.styleSheets]
  .flatMap(sheet => { try { return [...sheet.cssRules]; } catch { return []; } })
  .filter(rule => rule instanceof CSSPropertyRule && rule.name.startsWith('--tw-gradient')).map(rule => (rule as CSSPropertyRule).name));

test('FE-04b: signed-out 404 uses the prototype layer and theme, and leaving restores the FE-04 rules', async ({ page }) => {
  await page.goto('/khong-co-trang?x=1');
  await expect(notFound(page)).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-proto-page', '404');
  await expect(page.locator('#current-bad-path')).toHaveText('/khong-co-trang?x=1');
  // Thang chữ của bản mẫu (text-xs 12px) và không bị ép vùng chạm 40px như màn chưa chuyển.
  expect(await page.locator('#current-bad-path').evaluate(el => getComputedStyle(el.parentElement!).fontSize)).toBe('12px');
  const headerBack = page.getByRole('banner').getByRole('link', { name: /Về trang chủ/ }).last();
  expect((await headerBack.boundingBox())!.height).toBeLessThan(40);
  // theme.css và CSS của trang đứng trước stylesheet của app, như bản mẫu.
  expect(await page.evaluate(() => {
    const theme = document.querySelector('style[data-proto-theme]')!;
    const app = [...document.querySelectorAll('style[data-vite-dev-id], link[rel="stylesheet"]')].find(el => /index\.css|assets\/index/.test(el.getAttribute('data-vite-dev-id') ?? el.getAttribute('href') ?? ''))!;
    return Boolean(theme.compareDocumentPosition(app) & Node.DOCUMENT_POSITION_FOLLOWING);
  })).toBe(true);
  expect(await gradientPropertyRules(page)).toEqual([]);

  await page.getByRole('button', { name: 'Chuyển sang giao diện tối' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  // theme.css đã áp: <body> có class bg-[#F8F8F6], nên quy tắc "html.dark .bg-[#F8F8F6]" (#0E1528) thắng "html.dark body"
  // (#0B1020), như ở bản React (ảnh 404 tối khớp 0 pixel).
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(14, 21, 40)');
  await page.reload();
  await expect(notFound(page)).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.getByRole('main').getByRole('link', { name: 'Về trang chủ' }).click();
  await expect(page.getByRole('button', { name: 'Đăng nhập vào hệ thống' })).toBeVisible();
  expect(await page.locator('html').getAttribute('data-proto-page')).toBeNull();
  await expect(prototypeStyles(page)).toHaveCount(0);
  await page.goto('/login');
  const loginButton = page.getByRole('button', { name: 'Đăng nhập', exact: true });
  expect(await loginButton.evaluate(el => ({ size: getComputedStyle(el).fontSize, minHeight: getComputedStyle(el).minHeight }))).toEqual({ size: '14px', minHeight: '40px' });
  expect(await gradientPropertyRules(page)).toEqual([]);
});

test('FE-04b: signed-in 404 has no app shell, and Back/Forward keep each screen in its own scope', async ({ page }) => {
  await login(page);
  await page.goto('/khong-co-trang');
  await expect(notFound(page)).toBeVisible();
  await expect(page.getByRole('button', { name: /Menu người dùng/ })).toHaveCount(0);
  await expect(prototypeStyles(page)).toHaveCount(2);

  await page.getByRole('main').getByRole('link', { name: 'Về không gian làm việc chính' }).click();
  const composer = page.getByRole('textbox', { name: /Mô tả công việc bạn muốn thực hiện|Nhập câu trả lời làm rõ yêu cầu/ });
  await expect(composer).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-proto-page','app-stage');
  await expect(prototypeStyles(page)).toHaveCount(2);
  await composer.focus();
  expect(await composer.evaluate(el => ({ width: getComputedStyle(el).outlineWidth, style: getComputedStyle(el).outlineStyle }))).toEqual({ width: '2px', style: 'solid' });

  await page.goBack();
  await expect(notFound(page)).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-proto-page', '404');
  await page.goForward();
  await expect(composer).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-proto-page','app-stage');
});
