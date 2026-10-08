import { test, expect, type Page } from '@playwright/test';
const email = process.env.CHAT_ADMIN_EMAIL || 'admin@example.com';
const password = process.env.CHAT_ADMIN_PASSWORD || 'admin123';
async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email); await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByRole('textbox', { name: /Mô tả công việc bạn muốn thực hiện|Nhập câu trả lời làm rõ yêu cầu/ })).toBeVisible();
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
  await expect(page.getByLabel('Mật khẩu', { exact: true })).toHaveCount(0);
});
test('FE-04: shell menu, protected routes, cross-tab theme and mobile sandbox warning', async ({ page, context }, info) => {
  await login(page);
  const composer = page.getByRole('textbox', { name: /Mô tả công việc bạn muốn thực hiện|Nhập câu trả lời làm rõ yêu cầu/ });
  await composer.focus();
  // Spec 1.2.6: prototype inputs use their containing frame, without a second orange outline.
  expect(await composer.evaluate(el => getComputedStyle(el).outlineColor)).toBe('rgba(0, 0, 0, 0)');
  await expect.poll(() => composer.evaluate(el => getComputedStyle(el.closest('form')!).borderColor)).toBe('rgb(255, 87, 1)');
  const avatar = page.getByRole('button', { name: /Menu người dùng/ });
  await avatar.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Nhật ký điều phối' })).toBeFocused();
  await page.getByRole('menuitem', { name: 'Nhật ký điều phối' }).press('Escape'); await expect(avatar).toBeFocused();
  await avatar.click(); await page.getByRole('menuitem', { name: 'Kết nối dịch vụ' }).click();
  await expect(page).toHaveURL(/\/settings$/); await expect(page.getByRole('heading', { name: 'Kết nối dịch vụ', level: 1 })).toBeVisible();
  await page.getByRole('link', { name: 'Nhật ký', exact: true }).click();
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

for (const theme of ['light', 'dark'] as const) {
  test(`FE-04: solid brand buttons keep the approved weight compensation in ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme }); await page.goto('/login');
    const loginButton = page.getByRole('button', { name: 'Đăng nhập', exact: true });
    expect(await loginButton.evaluate(el => ({ weight: getComputedStyle(el).fontWeight, size: getComputedStyle(el).fontSize }))).toEqual({ weight: '600', size: '14px' });
    await page.getByLabel('Email', { exact: true }).fill(email); await page.getByLabel('Mật khẩu', { exact: true }).fill(password); await loginButton.click();
    await page.getByRole('button',{name:'Mở danh sách hội thoại'}).click();
    const newConversation = page.getByRole('button', { name: /Cuộc hội thoại mới/ });
    await expect(newConversation).toBeVisible();
    // Cockpit uses prototype typography under spec 1.2. Other pages retain FE-04.
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /Menu người dùng/ }).click(); await page.getByRole('menuitem', { name: 'Kết nối dịch vụ' }).click();
    await page.getByRole('button', { name: /Trello —/ }).click();
    const save = page.getByRole('button', { name: 'Lưu thay đổi', exact: true });
    await expect(save).toBeVisible(); expect(await save.evaluate(el => getComputedStyle(el).fontWeight)).toBe('600');
  });
  test(`FE-04: retained landing comparison copy is readable on its rendered ${theme} backgrounds`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: theme }); await page.goto('/');
    const paragraph = page.getByText('Hệ quả: Thao tác lặp lại và khó theo dõi công việc giữa các ứng dụng.', { exact: true });
    await paragraph.scrollIntoViewIfNeeded();
    for (const target of [paragraph, page.getByText('Quy trình truyền thống', { exact: true }), page.getByText('Chuyển tab và nhập liệu nhiều lần', { exact: true })]) {
      const values = await target.evaluate(el => {
        let background: Element = el;
        while (background.parentElement && getComputedStyle(background).backgroundColor === 'rgba(0, 0, 0, 0)') background = background.parentElement;
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d')!;
        const rgb = (color: string) => { context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3); };
        return { color: rgb(getComputedStyle(el).color), background: rgb(getComputedStyle(background).backgroundColor) };
      });
      const luminance = (color: number[]) => { const values = color.map(x => x / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4); return .2126 * values[0] + .7152 * values[1] + .0722 * values[2]; };
      const x = luminance(values.color), y = luminance(values.background);
      expect((Math.max(x, y) + .05) / (Math.min(x, y) + .05), JSON.stringify(values)).toBeGreaterThanOrEqual(4.5);
    }
    const gradient = await page.getByText('Đột phá', { exact: true }).locator('..').evaluate(el => getComputedStyle(el).backgroundImage);
    if (theme === 'dark') expect(gradient).not.toContain('rgb(255, 255, 255)');
    await page.screenshot({ path: info.outputPath(`FE04-comparison-${theme}.png`), animations: 'disabled' });
  });
}

test('FE-04: mobile prototype drawers preserve scope editing with source-sized touch targets', async ({ page }, info) => {
  await login(page); await page.getByRole('button', {name:'Mở danh sách hội thoại'}).click(); await page.getByRole('button', {name:/Cuộc hội thoại mới/}).click();
  await expect(page).toHaveURL(/\/c\//);
  await page.setViewportSize({ width: 375, height: 812 });
  const open = page.getByRole('button', { name: 'Mở danh sách hội thoại' });
  await expect(open).toBeVisible(); await info.attach('cockpit-prototype-history-target',{body:JSON.stringify(await open.boundingBox()),contentType:'application/json'}); await open.click();
  const close = page.getByRole('button', { name: 'Đóng Lịch sử yêu cầu' });
  await expect(close).toBeVisible(); await expect(page.getByRole('button', { name: /^Đổi tên / }).first()).toBeVisible();
  await page.screenshot({ path: info.outputPath('FE04-mobile-drawer-targets.png'), animations: 'disabled' });
  await close.click();
  await page.getByRole('button', { name: /Menu người dùng/ }).click(); await page.getByRole('menuitem', { name: 'Kết nối dịch vụ' }).click();
  // Spec 1.1.4/1.2.6: Settings now uses the React prototype's sizes;
  // retire only the 40x40 dimension assertion, retain scope add/remove behavior.
  await page.getByRole('button', { name: /Trello —/ }).click();
  await page.getByLabel('Thêm Board ID').fill('fe04-touch-target'); await page.getByRole('button', { name: 'Thêm', exact: true }).click();
  const remove = page.getByRole('button', { name: 'Xoá mục fe04-touch-target', exact: true });
  await expect(remove).toBeVisible(); await remove.click(); await expect(remove).toHaveCount(0);
});
