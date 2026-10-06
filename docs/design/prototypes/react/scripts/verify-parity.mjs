// So bản React với bản mẫu HTML gốc: từng phần tử (thẻ, class, vị trí, computed style) và ảnh chụp từng pixel.
//   node scripts/verify-parity.mjs [trang ...]        ví dụ: node scripts/verify-parity.mjs 404 privacy
// Kết quả ở .parity/: ảnh gốc, ảnh React, ảnh khác biệt và report.json. Exit 1 nếu còn khác biệt.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const reactDir = path.resolve(here, '..');
const prototypesDir = path.resolve(reactDir, '..');
const outDir = path.join(reactDir, '.parity');
const ORIGINAL_PORT = 5190;
const REACT_PORT = 5191;
// Font đầy đủ của design system; bản React nạp sẵn, bản gốc được bổ sung khi so (xem README).
const FONTS_HREF = 'https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&family=JetBrains+Mono:wght@400;500;600&family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600&display=swap';
const ROUTES = { index: '/', 404: '/404' };
const VIEWPORTS = [{ width: 1440, height: 900 }, { width: 375, height: 812 }];
const THEMES = ['light', 'dark'];
const pages = process.argv.slice(2).length ? process.argv.slice(2) : ['404', 'privacy'];

function serveStatic(root, port) {
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' };
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
    const file = path.resolve(root, rel);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}

// Chạy trong trang: liệt kê phần tử theo thứ tự DOM, kèm vị trí và computed style đã chuẩn hoá màu.
function snapshotInPage() {
  const PROPS = ['display', 'position', 'float', 'visibility', 'opacity', 'zIndex', 'overflowX', 'overflowY',
    'color', 'backgroundColor', 'backgroundImage', 'boxShadow', 'filter', 'backdropFilter',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle',
    'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
    'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius',
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'textAlign',
    'textDecorationLine', 'textTransform', 'whiteSpace', 'textOverflow', 'cursor',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
    'rowGap', 'columnGap', 'justifyContent', 'alignItems', 'flexDirection', 'flexWrap', 'gridTemplateColumns',
    'fill', 'stroke', 'strokeWidth', 'outlineStyle', 'outlineWidth', 'outlineColor'];
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const colorCache = new Map();
  const toRgba = value => {
    if (colorCache.has(value)) return colorCache.get(value);
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    const out = a === 0 ? 'rgba(0,0,0,0)' : `rgba(${r},${g},${b},${a})`;
    colorCache.set(value, out);
    return out;
  };
  const COLOR = /(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*(?:\([^()]*\)[^()]*)*\)|#[0-9a-fA-F]{3,8}\b|\btransparent\b/g;
  const normColors = value => value.replace(COLOR, m => toRgba(m));
  const splitTop = value => {
    const parts = []; let depth = 0; let start = 0;
    for (let i = 0; i < value.length; i++) {
      if (value[i] === '(') depth++; else if (value[i] === ')') depth--;
      else if (value[i] === ',' && depth === 0) { parts.push(value.slice(start, i).trim()); start = i + 1; }
    }
    parts.push(value.slice(start).trim());
    return parts;
  };
  const norm = (prop, value) => {
    let v = normColors(value);
    if (prop === 'boxShadow') {
      const layers = v === 'none' ? [] : splitTop(v).filter(l => !l.startsWith('rgba(0,0,0,0)'));
      v = layers.length ? layers.join(', ') : 'none';
    }
    if (prop === 'fontFamily') v = v.replace(/'/g, '"');
    // rounded-full: v3 là 9999px, v4 là calc(infinity * 1px); hiển thị như nhau.
    if (/Radius$/.test(prop) && parseFloat(v) >= 9999) v = 'full';
    return v;
  };
  const skip = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE', 'TITLE']);
  const items = [];
  const describe = el => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const style = {};
    for (const p of PROPS) style[p] = norm(p, cs[p]);
    items.push({
      tag: el.tagName.toLowerCase(),
      id: el.id || '',
      // Bản React đổi space-*/divide-* sang v3-* (xem v3-compat.css); quy về tên gốc để so.
      cls: (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean)
        .map(c => c.replace(/(^|:)v3-divide-color-/, '$1divide-').replace(/(^|:)v3-/, '$1')).sort().join(' '),
      text: [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.nodeValue).join('').replace(/\s+/g, ' ').trim(),
      rect: [r.x + scrollX, r.y + scrollY, r.width, r.height].map(n => Math.round(n * 2) / 2),
      style,
    });
  };
  const walk = parent => {
    for (const el of parent.children) {
      if (skip.has(el.tagName)) continue;
      if (el.id === 'root' || el.hasAttribute('data-proto-slot')) { walk(el); continue; }
      describe(el);
      walk(el);
    }
  };
  describe(document.documentElement);
  describe(document.body);
  walk(document.body);
  return items;
}

function compare(orig, react) {
  const diffs = [];
  const numbers = s => s.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
  const sameValue = (a, b) => {
    if (a === b) return true;
    if (a.replace(/-?\d+(\.\d+)?/g, '#') !== b.replace(/-?\d+(\.\d+)?/g, '#')) return false;
    const na = numbers(a); const nb = numbers(b);
    return na.length === nb.length && na.every((n, i) => Math.abs(n - nb[i]) <= 2);
  };
  const label = item => `${item.tag}${item.id ? '#' + item.id : ''}${item.cls ? '.' + item.cls.split(' ').slice(0, 4).join('.') : ''}`;
  const count = Math.max(orig.length, react.length);
  for (let i = 0; i < count; i++) {
    const a = orig[i]; const b = react[i];
    if (!a || !b || a.tag !== b.tag || a.cls !== b.cls) {
      diffs.push({ index: i, kind: 'structure', original: a && label(a), react: b && label(b) });
      break; // cấu trúc lệch thì các phần tử sau so theo vị trí không còn ý nghĩa
    }
    if (a.text !== b.text) diffs.push({ index: i, kind: 'text', element: label(a), original: a.text, react: b.text });
    if (a.rect.some((n, k) => Math.abs(n - b.rect[k]) > 1)) diffs.push({ index: i, kind: 'rect', element: label(a), original: a.rect.join(','), react: b.rect.join(',') });
    for (const p of Object.keys(a.style)) {
      if (!sameValue(a.style[p], b.style[p])) diffs.push({ index: i, kind: p, element: label(a), original: a.style[p], react: b.style[p] });
    }
  }
  return diffs;
}

async function pixelDiff(browser, origPng, reactPng, diffPath) {
  const page = await browser.newPage();
  const result = await page.evaluate(async ({ a, b }) => {
    const load = src => new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = src; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const w = Math.max(ia.width, ib.width); const h = Math.max(ia.height, ib.height);
    const read = img => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, w, h).data; };
    const da = read(ia); const db = read(ib);
    const out = document.createElement('canvas'); out.width = w; out.height = h;
    const ox = out.getContext('2d'); const od = ox.createImageData(w, h);
    let diff = 0;
    for (let i = 0; i < da.length; i += 4) {
      const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]), Math.abs(da[i + 3] - db[i + 3]));
      if (d > 16) { diff++; od.data[i] = 255; od.data[i + 3] = 255; } else { const g = (da[i] + da[i + 1] + da[i + 2]) / 3; od.data[i] = od.data[i + 1] = od.data[i + 2] = g; od.data[i + 3] = 60; }
    }
    ox.putImageData(od, 0, 0);
    return { width: w, height: h, sizeA: [ia.width, ia.height], sizeB: [ib.width, ib.height], diff, png: out.toDataURL('image/png') };
  }, { a: `data:image/png;base64,${origPng.toString('base64')}`, b: `data:image/png;base64,${reactPng.toString('base64')}` });
  await page.close();
  fs.writeFileSync(diffPath, Buffer.from(result.png.split(',')[1], 'base64'));
  return { size: result.sizeA.join('x') === result.sizeB.join('x') ? result.sizeA.join('x') : `${result.sizeA.join('x')} vs ${result.sizeB.join('x')}`, diffPixels: result.diff, ratio: result.diff / (result.width * result.height) };
}

async function capture(browser, url, viewport, theme, isOriginal) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce', colorScheme: 'light', deviceScaleFactor: 1 });
  await context.addInitScript(t => { try { localStorage.setItem('ati-theme', t); } catch { /* bỏ qua */ } }, theme);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
  await page.goto(url, { waitUntil: 'networkidle' });
  if (isOriginal) {
    await page.evaluate(href => new Promise(resolve => {
      const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = href; link.onload = resolve; link.onerror = resolve;
      document.head.appendChild(link);
    }), FONTS_HREF);
  }
  await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  const items = await page.evaluate(snapshotInPage);
  const png = await page.screenshot({ fullPage: true });
  await context.close();
  return { items, png, errors };
}

fs.mkdirSync(outDir, { recursive: true });
const staticServer = await serveStatic(prototypesDir, ORIGINAL_PORT);
const vite = await createServer({ root: reactDir, configFile: path.join(reactDir, 'vite.config.ts'), logLevel: 'error', server: { port: REACT_PORT, strictPort: true, host: '127.0.0.1' } });
await vite.listen();
const browser = await chromium.launch();
const report = [];
let failed = false;
try {
  for (const pageId of pages) {
    for (const viewport of VIEWPORTS) {
      for (const theme of THEMES) {
        const name = `${pageId}-${viewport.width}-${theme}`;
        const orig = await capture(browser, `http://127.0.0.1:${ORIGINAL_PORT}/${pageId}.html`, viewport, theme, true);
        const react = await capture(browser, `http://127.0.0.1:${REACT_PORT}${ROUTES[pageId] ?? '/' + pageId}`, viewport, theme, false);
        fs.writeFileSync(path.join(outDir, `${name}-original.png`), orig.png);
        fs.writeFileSync(path.join(outDir, `${name}-react.png`), react.png);
        const diffs = compare(orig.items, react.items);
        const pixels = await pixelDiff(browser, orig.png, react.png, path.join(outDir, `${name}-diff.png`));
        const ok = diffs.length === 0 && pixels.diffPixels === 0 && react.errors.length === 0;
        if (!ok) failed = true;
        report.push({ case: name, ok, elements: [orig.items.length, react.items.length], diffs: diffs.length, pixels, reactErrors: react.errors, originalErrors: orig.errors, firstDiffs: diffs.slice(0, 40) });
        console.log(`${ok ? 'ĐẠT ' : 'LỆCH'} ${name.padEnd(22)} phần tử ${orig.items.length}/${react.items.length}  khác ${diffs.length}  pixel ${pixels.diffPixels} (${(pixels.ratio * 100).toFixed(3)}%) ảnh ${pixels.size}${react.errors.length ? `  lỗi console React: ${react.errors.length}` : ''}`);
        for (const d of diffs.slice(0, 8)) console.log(`     [${d.index}] ${d.kind} ${d.element ?? ''} gốc=${d.original} react=${d.react}`);
      }
    }
  }
} finally {
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  await vite.close();
  staticServer.close();
}
console.log(failed ? '\nCÒN KHÁC BIỆT: xem .parity/report.json' : '\nĐẠT: bản React khớp bản gốc ở mọi trường hợp');
process.exit(failed ? 1 : 0);
