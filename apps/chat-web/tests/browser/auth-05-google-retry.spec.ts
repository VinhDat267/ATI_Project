import { test, expect } from '@playwright/test';

for (const leave of ['email', 'home'] as const) {
  test(`AUTH-05: a Google retry ignores a delayed response after leaving for ${leave}`, async ({ page }) => {
    // Observe response consumption without contacting Google's consent service.
    await page.addInitScript(() => {
      const nativeFetch = window.fetch;
      window.fetch = async (...args) => {
        const response = await nativeFetch(...args);
        if (String(args[0]) === '/api/auth/google/start') {
          void response.clone().arrayBuffer().then(() => sessionStorage.setItem('google-retry-response-read', 'true'));
        }
        return response;
      };
    });
    await page.goto('/auth/google/callback?error=access_denied');
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/auth/google/start', async route => {
      await gate;
      await route.fulfill({ json: { url: new URL('/guide', route.request().url()).href } });
    });
    try {
      const started = page.waitForRequest('**/api/auth/google/start');
      await page.getByRole('button', { name: 'Thử lại với Google', exact: true }).click();
      await started;
      await page.getByRole('link', { name: leave === 'email' ? 'Đăng nhập bằng Email & Mật khẩu' : '← Quay về trang chủ', exact: true }).click();
      const destination = leave === 'email' ? /\/login$/ : /\/$/;
      await expect(page).toHaveURL(destination);
      release();
      await page.waitForFunction(() => sessionStorage.getItem('google-retry-response-read') === 'true');
      await expect(page).toHaveURL(destination);
      if (leave === 'email') await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
    } finally { release(); }
  });
}

test('AUTH-05: a Google retry still redirects while its page is active', async ({ page }) => {
  await page.route('**/api/auth/google/start', route => route.fulfill({
    json: { url: new URL('/guide', route.request().url()).href },
  }));
  await page.goto('/auth/google/callback?error=access_denied');
  await page.getByRole('button', { name: 'Thử lại với Google', exact: true }).click();
  await expect(page).toHaveURL(/\/guide$/);
});
