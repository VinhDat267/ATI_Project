import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

async function login(page: Page, email: string, pass: string) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(pass);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByRole('main')).toBeVisible();
}

const VIEWPORTS = [1440, 1024, 768, 375];
const THEMES = ['light', 'dark'] as const;

for (const width of VIEWPORTS) {
  for (const theme of THEMES) {
    test(`PL-02: Planora shell & sidebar ${width}px ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript((val) => localStorage.setItem('ati-theme', val), theme);

      await login(page, process.env.CHAT_ADMIN_EMAIL!, process.env.CHAT_ADMIN_PASSWORD!);

      // Single main landmark and single h1
      await expect(page.getByRole('main')).toHaveCount(1);
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);

      // Verify global navigation
      const nav = page.getByRole('navigation', { name: 'Điều hướng chính' });
      const sidebar = page.locator('.planora-sidebar');

      if (width >= 1024) {
        // Desktop (>= 1024px): sidebar is permanent, nav is exposed (count = 1), 248px width
        await expect(nav).toHaveCount(1);
        await expect(sidebar).toBeVisible();
        const box = await sidebar.boundingBox();
        expect(box?.width).toBeCloseTo(248, -1); // ~248px
      } else {
        // Mobile / Tablet (< 1024px): sidebar is drawer, initially closed and hidden from a11y tree (nav count = 0)
        await expect(nav).toHaveCount(0);
        const toggleBtn = page.getByRole('button', { name: /Mở menu điều hướng/i });
        await expect(toggleBtn).toBeVisible();

        // Open drawer
        await toggleBtn.click();
        await expect(sidebar).toHaveClass(/planora-sidebar-open/);
        await expect(sidebar).toBeVisible();
        // Once drawer is open, navigation is exposed to accessibility tree (nav count = 1)
        await expect(nav).toHaveCount(1);

        // Backdrop visible
        const backdrop = page.locator('.planora-drawer-backdrop.open');
        await expect(backdrop).toBeVisible();

        // Press Escape to close drawer
        await page.keyboard.press('Escape');
        await expect(sidebar).not.toHaveClass(/planora-sidebar-open/);
        // Drawer is closed and hidden again (nav count = 0), focus restored to toggle button
        await expect(nav).toHaveCount(0);
        await expect(toggleBtn).toBeFocused();
      }

      // No horizontal overflow
      const noOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      );
      expect(noOverflow).toBe(true);

      // Screenshot directory
      const screenshotDir = resolve(process.cwd(), 'apps/chat-web/tests/screenshots/planora-shell');
      await mkdir(screenshotDir, { recursive: true });
      const screenshotPath = resolve(screenshotDir, `shell-${width}-${theme}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      await page.screenshot({ path: testInfo.outputPath(`shell-${width}-${theme}.png`), fullPage: true });
    });
  }
}
