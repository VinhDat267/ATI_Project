// Đọc bảng màu mặc định của Tailwind v3 (bản CDN mà các bản mẫu dùng) và ghi src/styles/v3-palette.css.
// Tailwind v4 đổi bảng màu sang OKLCH nên màu lệch nhẹ; ghi đè bằng mã hex v3 để giữ đúng màu bản mẫu.
//   node scripts/extract-v3-palette.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../src/styles/v3-palette.css');
const palettes = ['slate', 'gray', 'zinc', 'neutral', 'stone', 'red', 'orange', 'amber', 'yellow', 'lime', 'green',
  'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose'];
const shades = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<!doctype html><html><head><script src="https://cdn.tailwindcss.com"></script></head><body></body></html>');
await page.waitForFunction(() => typeof window.tailwind !== 'undefined');
const colors = await page.evaluate(async ({ palettes, shades }) => {
  for (const p of palettes) for (const s of shades) {
    const el = document.createElement('div');
    el.className = `bg-${p}-${s}`;
    el.dataset.key = `${p}-${s}`;
    document.body.appendChild(el);
  }
  await new Promise(r => setTimeout(r, 1500));
  const hex = rgb => '#' + rgb.match(/\d+/g).slice(0, 3).map(n => Number(n).toString(16).padStart(2, '0')).join('');
  return [...document.body.children].map(el => [el.dataset.key, hex(getComputedStyle(el).backgroundColor)]);
}, { palettes, shades });
await browser.close();
const missing = colors.filter(([, v]) => v === '#000000');
if (missing.length) throw new Error(`Không đọc được màu: ${missing.map(([k]) => k).join(', ')}`);
fs.writeFileSync(out, `/* Bảng màu mặc định của Tailwind v3 CDN, sinh bởi scripts/extract-v3-palette.mjs. Không sửa tay. */
@theme {
${colors.map(([k, v]) => `  --color-${k}: ${v};`).join('\n')}
}
`);
console.log(`v3-palette.css: ${colors.length} màu`);
