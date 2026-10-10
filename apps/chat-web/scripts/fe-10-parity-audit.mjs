import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const appOrigin = process.env.FE10_APP_ORIGIN || 'http://127.0.0.1:5174';
const prototypeOrigin = process.env.FE10_PROTOTYPE_ORIGIN || 'http://127.0.0.1:5181';
const output = resolve('node_modules/.cache/fe10-parity');
const pages = [
  { id: 'guide', app: '/guide', prototype: '/guide' },
  { id: 'privacy', app: '/privacy', prototype: '/privacy' },
  { id: '404', app: '/fe-10-khong-ton-tai', prototype: '/404' },
];
const viewports = [{ width: 1440, height: 900 }, { width: 375, height: 812 }];

await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const manifest = [];
try {
  for (const viewport of viewports) {
    for (const theme of ['light', 'dark']) {
      for (const entry of pages) {
        const context = await browser.newContext({ viewport });
        await context.addInitScript(value => localStorage.setItem('ati-theme', value), theme);
        const app = await context.newPage();
        const prototype = await context.newPage();
        await Promise.all([
          app.goto(`${appOrigin}${entry.app}`, { waitUntil: 'networkidle' }),
          prototype.goto(`${prototypeOrigin}${entry.prototype}`, { waitUntil: 'networkidle' }),
        ]);
        const stem = `${entry.id}-${viewport.width}x${viewport.height}-${theme}`;
        const appPath = resolve(output, `${stem}-app.png`);
        const prototypePath = resolve(output, `${stem}-prototype.png`);
        await Promise.all([app.screenshot({ path: appPath, fullPage: true }), prototype.screenshot({ path: prototypePath, fullPage: true })]);
        const [appBytes, prototypeBytes] = await Promise.all([readFile(appPath), readFile(prototypePath)]);
        const comparison = await context.newPage();
        await comparison.setViewportSize({ width: viewport.width * 2 + 32, height: viewport.height });
        await comparison.setContent(`<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#20242d;color:white;font:14px system-ui}.row{display:flex;gap:16px;align-items:flex-start}.shot{width:${viewport.width}px}.label{position:sticky;top:0;padding:6px 10px;background:#111827;z-index:1}.shot img{display:block;width:100%;height:auto}</style><div class="row"><div class="shot"><div class="label">APP · ${entry.id} · ${theme}</div><img src="data:image/png;base64,${appBytes.toString('base64')}"></div><div class="shot"><div class="label">PROTOTYPE · ${entry.id} · ${theme}</div><img src="data:image/png;base64,${prototypeBytes.toString('base64')}"></div></div>`);
        const comparisonPath = resolve(output, `${stem}-side-by-side.png`);
        await comparison.screenshot({ path: comparisonPath, fullPage: true });
        const digest = bytes => createHash('sha256').update(bytes).digest('hex');
        manifest.push({
          id: entry.id, viewport, theme,
          app: { file: appPath, sha256: digest(appBytes) },
          prototype: { file: prototypePath, sha256: digest(prototypeBytes) },
          sideBySide: { file: comparisonPath, sha256: digest(await readFile(comparisonPath)) },
        });
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
}
await writeFile(resolve(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`FE-10 parity evidence (${manifest.length} comparisons)\n${JSON.stringify(manifest, null, 2)}`);
