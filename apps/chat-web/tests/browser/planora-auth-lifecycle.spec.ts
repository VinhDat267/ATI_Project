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
    test(`PL-04: Verify expired view responsive without overflow ${vp.label} ${theme}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.addInitScript(val => localStorage.setItem('ati-theme', val), theme);
      await page.goto('/resend-verification');

      // Frame rendered
      const card = page.locator('.planora-auth-card');
      await expect(card).toBeVisible();

      // Heading: single level 1 heading
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      await expect(
        page.getByRole('heading', { name: 'Link xác minh không còn hiệu lực' })
      ).toBeVisible();

      // Form controls and tap targets >= 44px
      const emailInput = page.getByLabel('Email', { exact: true });
      await expect(emailInput).toBeVisible();
      const emailBox = await emailInput.boundingBox();
      expect(emailBox?.height).toBeGreaterThanOrEqual(44);

      const submitBtn = page.getByRole('button', { name: 'Gửi lại link xác minh mới' });
      await expect(submitBtn).toBeVisible();
      const submitBox = await submitBtn.boundingBox();
      expect(submitBox?.height).toBeGreaterThanOrEqual(44);

      // Editorial visibility
      if (vp.width >= 1024) {
        await expect(page.locator('.planora-auth-editorial')).toBeVisible();
      } else {
        await expect(page.locator('.planora-auth-editorial')).toBeHidden();
      }

      // No horizontal overflow
      const noOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      );
      expect(noOverflow).toBe(true);

      if (['1440x900', '375x812'].includes(vp.label)) {
        await page.screenshot({
          path: testInfo.outputPath(`PL04-verify-expired-${theme}-${vp.label}.png`),
          fullPage: true,
        });
      }
    });

    test(`PL-04: Reset password view responsive and password strength meter ${vp.label} ${theme}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.addInitScript(val => localStorage.setItem('ati-theme', val), theme);
      await page.goto('/reset-password?token=fixture-reset-token');

      // Heading
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      await expect(page.getByRole('heading', { name: 'Tạo mật khẩu mới' })).toBeVisible();

      // Inputs & tap targets
      const newPass = page.getByLabel('Mật khẩu mới', { exact: true });
      await expect(newPass).toBeVisible();
      const newPassBox = await newPass.boundingBox();
      expect(newPassBox?.height).toBeGreaterThanOrEqual(44);

      const confirmPass = page.getByLabel('Nhập lại mật khẩu', { exact: true });
      await expect(confirmPass).toBeVisible();
      const confirmBox = await confirmPass.boundingBox();
      expect(confirmBox?.height).toBeGreaterThanOrEqual(44);

      const submitBtn = page.getByRole('button', { name: 'Đặt lại mật khẩu' });
      await expect(submitBtn).toBeVisible();
      const submitBox = await submitBtn.boundingBox();
      expect(submitBox?.height).toBeGreaterThanOrEqual(44);

      // Strength meter interaction
      await newPass.fill('Short1!');
      await expect(page.locator('#strength-bar-1')).toBeVisible();
      await expect(page.locator('#strength-text')).toHaveText(/Mật khẩu cần ít nhất 12 ký tự/);

      await newPass.fill('SecurePassword123!@#');
      await expect(page.locator('#strength-text')).toHaveText(/Độ mạnh: Tuyệt vời|Rất an toàn/);

      // No horizontal overflow
      const noOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      );
      expect(noOverflow).toBe(true);

      if (['1440x900', '375x812'].includes(vp.label)) {
        await page.screenshot({
          path: testInfo.outputPath(`PL04-reset-password-${theme}-${vp.label}.png`),
          fullPage: true,
        });
      }
    });
  }
}
