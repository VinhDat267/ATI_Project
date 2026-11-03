import { test, expect } from '@playwright/test';

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
    test(`PL-03: Planora public landing responsive without overflow ${vp.label} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.addInitScript(val => localStorage.setItem('ati-theme', val), theme);
      await page.goto('/');

      // Single h1 heading and main landmark
      await expect(page.getByRole('main')).toHaveCount(1);
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);

      // Hero 3D Rotator & Trust Pills
      await expect(page.locator('.planora-hero-rotator')).toBeVisible();
      await expect(page.locator('.hero-edge-layer')).toHaveCount(14);
      await expect(page.getByTestId('landing-hero-trust-pills')).toBeVisible();

      // 3-step workflow illustration (replacing Make orbital graphic)
      await expect(page.locator('#how')).toBeVisible();
      await expect(page.locator('.workflow-step-card')).toHaveCount(3);

      // Integrated services & Roadmap
      await expect(page.locator('[data-od-id="integrations-section"]')).toBeVisible();
      await expect(page.locator('.roadmap-toggle')).toBeVisible();

      // No horizontal overflow across all sections
      const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      expect(noOverflow).toBe(true);
    });

    test(`PL-03: Planora AuthFrame split layout and tap targets ${vp.label} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.addInitScript(val => localStorage.setItem('ati-theme', val), theme);
      await page.goto('/login');

      const modal = page.locator('#auth-modal');
      await expect(modal).toBeVisible();

      const emailInput = page.getByLabel('Email', { exact: true });
      await expect(emailInput).toBeVisible();
      const emailBox = await emailInput.boundingBox();
      expect(emailBox?.height).toBeGreaterThanOrEqual(40);

      const loginBtn = page.getByRole('button', { name: 'Đăng nhập', exact: true });
      await expect(loginBtn).toBeVisible();
      const btnBox = await loginBtn.boundingBox();
      expect(btnBox?.height).toBeGreaterThanOrEqual(44);

      const editorial = page.locator('.planora-auth-editorial');
      if (vp.width >= 1024) {
        // Desktop split layout reveals editorial paper art SVG panel
        await expect(editorial).toBeVisible();
      } else {
        // Mobile / Tablet collapses to clean focused card
        await expect(editorial).toBeHidden();
      }

      // Escape key closes modal and restores URL
      await page.keyboard.press('Escape');
      await expect(page).toHaveURL(/\/$/);
      await expect(modal).toHaveCount(0);
    });
  }
}

test('PL-03: Planora public landing honors prefers-reduced-motion', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');

  const floatEl = page.locator('.hero-float');
  await expect(floatEl).toBeVisible();
  const animationPlayState = await floatEl.evaluate(el => getComputedStyle(el).animationName);
  expect(animationPlayState).toBe('none');
});
