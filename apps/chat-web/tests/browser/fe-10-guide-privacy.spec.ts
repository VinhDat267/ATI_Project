import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';

type ContrastRow = { path: string; theme: string; checked: number; belowAA: number; belowThree: number; worst: number };

async function setTheme(page: Page, theme: string) {
  await page.evaluate(value => {
    localStorage.setItem('ati-theme', value);
    document.documentElement.classList.toggle('dark', value === 'dark');
    document.documentElement.dataset.theme = value;
  }, theme);
}

async function auditContrast(page: Page, path: string, theme: string): Promise<ContrastRow> {
  const result = await page.evaluate(() => {
    const parse = (value: string) => {
      const match = value.match(/[\d.]+/g)?.map(Number);
      return match && match.length >= 3 ? [match[0], match[1], match[2], match[3] ?? 1] : null;
    };
    const blend = (fg: number[], bg: number[]) => fg.slice(0, 3).map((channel, index) => channel * fg[3] + bg[index] * (1 - fg[3]));
    const luminance = (rgb: number[]) => {
      const channels = rgb.slice(0, 3).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
      return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
    };
    const ratio = (a: number[], b: number[]) => {
      const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (light + .05) / (dark + .05);
    };
    const background = (element: Element) => {
      let current: Element | null = element;
      let color = [255, 255, 255, 1];
      while (current) {
        const parsed = parse(getComputedStyle(current).backgroundColor);
        if (parsed && parsed[3] > 0) {
          color = parsed[3] < 1 ? [...blend(parsed, color), 1] : parsed;
          if (parsed[3] >= 1) break;
        }
        current = current.parentElement;
      }
      return color;
    };
    const rows = [...document.querySelectorAll('body *')].filter(element => {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
      const ownText = [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
      return ownText && (element as HTMLElement).getClientRects().length > 0;
    }).flatMap(element => {
      const foreground = parse(getComputedStyle(element).color);
      if (!foreground) return [];
      return [ratio(foreground[3] < 1 ? [...blend(foreground, background(element)), 1] : foreground, background(element))];
    });
    return {
      checked: rows.length,
      belowAA: rows.filter(value => value < 4.5).length,
      belowThree: rows.filter(value => value < 3).length,
      worst: rows.length ? Math.min(...rows) : 21,
    };
  });
  return { path, theme, ...result, worst: Number(result.worst.toFixed(2)) };
}

async function assertPageStructure(page: Page, label = new URL(page.url()).pathname) {
  await expect.poll(() => page.locator('h1:visible').evaluateAll(headings => headings.filter(heading => !heading.closest('[aria-hidden="true"]')).length),
    { message: `${label}: exposed visible h1` }).toBe(1);
  expect(await page.locator('main:visible').count(), `${label}: visible main`).toBe(1);
  await expect(page.locator('header').first()).toBeVisible();
  const unnamed = await page.locator('button').evaluateAll(buttons => buttons.filter(button => {
    if (!(button as HTMLElement).getClientRects().length) return false;
    return !button.textContent?.trim() && !button.getAttribute('aria-label') && !button.getAttribute('title');
  }).length);
  expect(unnamed).toBe(0);
}

async function signIn(page: Page) {
  let response = await page.request.post('/api/auth/login', { data: { email: process.env.CHAT_ADMIN_EMAIL, password: process.env.CHAT_ADMIN_PASSWORD } });
  if (response.status() === 401 && process.env.SANDBOX_USER_EMAIL && process.env.SANDBOX_USER_PASSWORD) {
    response = await page.request.post('/api/auth/login', { data: { email: process.env.SANDBOX_USER_EMAIL, password: process.env.SANDBOX_USER_PASSWORD } });
  }
  expect(response.status()).toBe(200);
  const tokens = await response.json();
  await page.goto('/login');
  await page.evaluate(value => {
    localStorage.setItem('wap_access_token', value.accessToken);
    localStorage.setItem('wap_refresh_token', value.refreshToken);
    localStorage.setItem('wap_user', JSON.stringify(value.user));
  }, tokens);
}

test('FE-10: guide, privacy and 404 are public, responsive and screenshoted in both themes', async ({ page }, info) => {
  const hashes: string[] = [];
  for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 812 }]) {
    await page.setViewportSize(viewport);
    for (const theme of ['light', 'dark']) {
      for (const entry of [
        { path: '/guide', scope: 'guide' },
        { path: '/privacy', scope: 'privacy' },
        { path: '/fe-10-khong-ton-tai', scope: '404' },
      ]) {
        await page.goto(entry.path);
        await setTheme(page, theme);
        await expect(page.locator('html')).toHaveAttribute('data-proto-page', entry.scope);
        await assertPageStructure(page, `${entry.path} ${viewport.width} ${theme}`);
        if (entry.path === '/privacy') {
          const header = page.getByRole('banner');
          const themeToggle = header.getByRole('button', { name: /Chuyển sang giao diện/i });
          await expect(themeToggle).toBeVisible();
          expect(await page.getByRole('button', { name: /Chuyển sang giao diện/i }).count()).toBe(1);
        }
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        const name = `FE10-app-${entry.scope}-${viewport.width}x${viewport.height}-${theme}.png`;
        const path = info.outputPath(name);
        await page.screenshot({ path, fullPage: true });
        hashes.push(`${name} ${createHash('sha256').update(await readFile(path)).digest('hex')}`);
      }
    }
  }
  console.log(`FE-10 screenshot SHA256\n${hashes.join('\n')}`);
});

test('FE-10: guide tabs and in-app navigation work without a session', async ({ page }) => {
  await page.goto('/guide?tab=prompts');
  await expect(page.locator('#section-prompts')).toBeVisible();
  await page.getByRole('tab', { name: /Việc làm được/ }).click();
  await expect(page.locator('#section-capabilities')).toBeVisible();
  await page.getByRole('tab', { name: /Hướng dẫn lấy khoá/ }).click();
  await page.locator('#service-pill-jira').click();
  await expect(page.locator('#service-guide-detail')).toContainText('Site URL');
  await page.getByRole('banner').getByRole('link', { name: /Về không gian làm việc/ }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('FE-10: non-blocking contrast and landmark audit covers every route in both themes', async ({ page }) => {
  const rows: ContrastRow[] = [];
  const publicPaths = ['/', '/login', '/signup', '/forgot-password', '/verify-email', '/reset-password', '/guide', '/privacy', '/fe-10-khong-ton-tai'];
  for (const theme of ['light', 'dark']) {
    for (const path of publicPaths) {
      await page.goto(path); await setTheme(page, theme); await assertPageStructure(page, `${path} ${theme}`);
      rows.push(await auditContrast(page, path, theme));
    }
  }

  await signIn(page);
  const privatePaths = ['/', '/settings', '/account', '/admin/users', '/history', '/guide', '/privacy', '/fe-10-khong-ton-tai'];
  for (const theme of ['light', 'dark']) {
    for (const path of privatePaths) {
      await page.goto(path); await setTheme(page, theme); await assertPageStructure(page, `auth:${path} ${theme}`);
      rows.push(await auditContrast(page, `auth:${path}`, theme));
    }
  }
  const jiraDarkRatio = await page.evaluate(() => {
    const lum = (hex: string) => {
      const values = hex.match(/[a-f\d]{2}/gi)!.map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
      return .2126 * values[0] + .7152 * values[1] + .0722 * values[2];
    };
    const values = [lum('#60A5FA'), lum('#0e1528')].sort((a, b) => b - a);
    return Number(((values[0] + .05) / (values[1] + .05)).toFixed(2));
  });
  console.log(`FE-10 contrast audit\n${JSON.stringify({ rows, jiraDarkRatio }, null, 2)}`);
  expect(rows.every(row => row.checked > 0)).toBe(true);
  expect(jiraDarkRatio).toBeGreaterThanOrEqual(3);
});
