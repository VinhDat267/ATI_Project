import { chromium } from '@playwright/test';
import fs from 'node:fs';
const [a, b, x, y, w, h, out, scale] = process.argv.slice(2).map((v, i) => (i >= 2 && i <= 5) || i === 7 ? Number(v) : v);
const br = await chromium.launch(); const p = await br.newPage({ viewport: { width: w * scale * 2 + 10, height: h * scale } });
const img = f => `<div style="position:relative;width:${w * scale}px;height:${h * scale}px;overflow:hidden;display:inline-block;margin-right:10px"><img src="data:image/png;base64,${fs.readFileSync(f).toString('base64')}" style="position:absolute;left:${-x * scale}px;top:${-y * scale}px;transform-origin:0 0;transform:scale(${scale});image-rendering:pixelated"></div>`;
await p.setContent(`<body style="margin:0;background:#f0f;white-space:nowrap">${img(a)}${img(b)}</body>`);
await p.waitForTimeout(150);
await p.screenshot({ path: out });
await br.close();
