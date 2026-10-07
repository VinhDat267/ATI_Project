// So bản React với bản mẫu HTML gốc: từng phần tử (thẻ, class, vị trí, computed style) và ảnh chụp từng pixel.
//   node scripts/verify-parity.mjs [trang ...] [--state=tên]   ví dụ: node scripts/verify-parity.mjs 404 privacy
// Mỗi trang so lúc mở trang (4 tổ hợp) và các trạng thái thao tác khai ở scripts/parity-states.mjs.
// Kết quả ở .parity/: ảnh gốc, ảnh React, ảnh khác biệt và report.json. Exit 1 nếu còn khác biệt.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { STATES } from './parity-states.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const reactDir = path.resolve(here, '..');
const prototypesDir = path.resolve(reactDir, '..');
const outDir = path.join(reactDir, '.parity');
// Đổi cổng qua biến môi trường khi cần chạy hai lần so cùng lúc (ví dụ hai worktree).
const ORIGINAL_PORT = Number(process.env.PARITY_ORIGINAL_PORT ?? 5190);
const REACT_PORT = Number(process.env.PARITY_REACT_PORT ?? 5191);
// Font đầy đủ của design system; bản React nạp sẵn, bản gốc được bổ sung khi so (xem README).
const FONTS_HREF = 'https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&family=JetBrains+Mono:wght@400;500;600&family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600&display=swap';
const ROUTES = { index: '/', 404: '/404' };
const VIEWPORTS = [{ width: 1440, height: 900 }, { width: 375, height: 812 }];
const THEMES = ['light', 'dark'];
const args = process.argv.slice(2);
const onlyState = args.find(a => a.startsWith('--state='))?.slice('--state='.length);
const named = args.filter(a => !a.startsWith('--'));
const pages = named.length ? named : ['404', 'privacy', 'errors', 'responses', 'auth-action', 'account', 'users', 'settings', 'history', 'guide', 'index', 'app-stage'];

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
      // Bỏ các lớp bóng không vẽ gì: màu trong suốt, hoặc mọi kích thước bằng 0 (lớp ring-offset của v3).
      const invisible = l => l.startsWith('rgba(0,0,0,0)') || (!/\binset\b/.test(l) && (l.match(/-?[\d.]+px/g) ?? []).every(n => parseFloat(n) === 0));
      const layers = v === 'none' ? [] : splitTop(v).filter(l => !invisible(l));
      v = layers.length ? layers.join(', ') : 'none';
    }
    if (prop === 'fontFamily') v = v.replace(/'/g, '"');
    // Gradient: v3 để mặc định vị trí điểm màu, v4 ghi rõ 0% / 50% / 100%; hai cách vẽ như nhau.
    if (prop === 'backgroundImage') {
      v = v.replace(/linear-gradient\(((?:[^()]|\([^()]*\))*)\)/g, (_, inner) => {
        const args = splitTop(inner);
        const lead = /^(to |-?[\d.]+(deg|rad|turn))/.test(args[0]) ? [args.shift()] : [];
        const defaults = args.length === 3 ? ['0%', '50%', '100%'] : args.length === 2 ? ['0%', '100%'] : [];
        const stops = args.map((stop, i) => (defaults[i] && stop.endsWith(' ' + defaults[i]) ? stop.slice(0, -defaults[i].length - 1) : stop));
        return `linear-gradient(${[...lead, ...stops].join(', ')})`;
      });
    }
    // rounded-full: v3 là 9999px, v4 là calc(infinity * 1px); hiển thị như nhau.
    if (/Radius$/.test(prop) && parseFloat(v) >= 9999) v = 'full';
    return v;
  };
  // v3 dồn translate/rotate/scale vào thuộc tính transform; v4 dùng các thuộc tính translate, rotate, scale riêng.
  // Gộp cả bốn thành một ma trận để so. 'none' khi cả bốn đều none: khác với ma trận đơn vị, vì có transform thì
  // phần tử thành lớp vẽ riêng (ảnh hưởng thứ tự vẽ và cách khử răng cưa chữ).
  const effectiveTransform = (cs, el) => {
    // Phần tử không có hộp (display: none): Chromium trả transform là none dù class có đặt, còn translate vẫn trả giá trị.
    if (!el.getClientRects().length) return '';
    if ([cs.transform, cs.translate, cs.rotate, cs.scale].every(v => v === 'none')) return 'none';
    const len = (v, size) => (v.endsWith('%') ? (parseFloat(v) / 100) * size : parseFloat(v));
    let m = new DOMMatrix();
    if (cs.translate !== 'none') {
      const [x = '0px', y = '0px', z = '0px'] = cs.translate.split(' ');
      // Phần trăm tính theo kích thước của phần tử. SVG không có offsetWidth/offsetHeight nên lấy từ getBoundingClientRect
      // (đúng khi không kèm rotate/scale, như các biểu tượng -translate-y-1/2 trong bản mẫu).
      const box = el instanceof HTMLElement ? { width: el.offsetWidth, height: el.offsetHeight } : el.getBoundingClientRect();
      m = m.translate(len(x, box.width), len(y, box.height), parseFloat(z));
    }
    if (cs.rotate !== 'none') {
      const parts = cs.rotate.split(' ');
      const angle = parseFloat(parts.at(-1)) * ({ deg: 1, rad: 180 / Math.PI, turn: 360, grad: 0.9 }[parts.at(-1).replace(/^[-\d.]+/, '')] ?? 1);
      const axis = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[parts[0]] ?? (parts.length === 4 ? parts.slice(0, 3).map(Number) : [0, 0, 1]);
      m = m.rotateAxisAngle(...axis, angle);
    }
    if (cs.scale !== 'none') {
      const [sx, sy = sx, sz = 1] = cs.scale.split(' ').map(s => (s.endsWith('%') ? parseFloat(s) / 100 : Number(s)));
      m = m.scale(sx, sy, sz);
    }
    if (cs.transform !== 'none') m = m.multiply(new DOMMatrix(cs.transform));
    return `matrix(${[m.a, m.b, m.c, m.d, m.e, m.f].map(n => Math.round(n * 1000) / 1000 || 0).join(',')})`;
  };
  const skip = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE', 'TITLE']);
  const items = [];
  const describe = el => {
    // Đọc vị trí trước để trình duyệt tính xong layout, rồi mới đọc style (margin auto chỉ ra số px khi layout đã xong).
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const style = {};
    for (const p of PROPS) style[p] = norm(p, cs[p]);
    style.transform = effectiveTransform(cs, el);
    items.push({
      tag: el.tagName.toLowerCase(),
      id: el.id || '',
      // Bản React đổi space-*/divide-y/outline-none sang v3-* (xem v3-compat.css) và dùng hậu tố ! khi cần; quy về tên gốc để so.
      cls: (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean)
        .map(c => c.replace(/(^|:)(-?)v3-/, '$1$2').replace(/!$/, '')).sort().join(' '),
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
    // Margin auto: Chrome đôi khi trả 0px thay vì giá trị đã tính (thấy ở phần tử trong khối fixed) dù vị trí trùng khớp.
    // Vị trí của phần tử đã phản ánh margin auto, nên bỏ so giá trị margin theo chiều có auto.
    const autoX = /(^|\s|:)(m|mx)-auto(\s|$)|(^|\s|:)m[lr]-auto(\s|$)/.test(a.cls);
    const autoY = /(^|\s|:)(m|my)-auto(\s|$)|(^|\s|:)m[tb]-auto(\s|$)/.test(a.cls);
    for (const p of Object.keys(a.style)) {
      if ((autoX && /^margin(Left|Right)$/.test(p)) || (autoY && /^margin(Top|Bottom)$/.test(p))) continue;
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

async function capture(browser, url, viewport, theme, isOriginal, steps = [], motion = false) {
  // Mặc định bật giảm chuyển động để hiệu ứng JS xong ngay; trạng thái `motion: true` tắt đi (index ẩn hẳn sân khấu tương tác khi giảm chuyển động).
  const context = await browser.newContext({ viewport, reducedMotion: motion ? 'no-preference' : 'reduce', colorScheme: 'light', deviceScaleFactor: 1 });
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
  for (const [action, selector, value] of steps) {
    if (action === 'click') await page.click(selector, { timeout: 5000, ...(value ?? {}) });
    else if (action === 'fill') await page.fill(selector, value, { timeout: 5000 });
    else if (action === 'press') await page.press(selector, value, { timeout: 5000 });
    else if (action === 'select') await page.selectOption(selector, value, { timeout: 5000 });
    // Cuộn phần tử vào giữa màn hình trước khi bấm, để vị trí cuộn không phụ thuộc cách Playwright tự cuộn (có thể khác nhau giữa các lần thử).
    else if (action === 'scroll') await page.locator(selector).evaluate(el => el.scrollIntoView({ block: 'center', inline: 'center' }));
    else if (action === 'wait') await page.waitForTimeout(Number(selector));
    // Đưa chuột tới toạ độ (x, y). Bấm xong mà nút bị đẩy khỏi chỗ con trỏ thì Chromium chỉ bỏ :hover ở lần di chuột kế
    // tiếp, nên lúc chụp nút còn hay hết hover tuỳ thời điểm; đưa chuột ra chỗ khác cho hai bản cùng một trạng thái.
    else if (action === 'move') await page.mouse.move(Number(selector), Number(value));
    else throw new Error(`Bước không hỗ trợ: ${action}`);
    // Chờ hai khung hình để trang ổn định trước bước sau. Thiếu bước này, bấm ngay sau khi cuộn thì Playwright đôi khi
    // tự cuộn thêm và vị trí cuộn cuối khác nhau giữa các lần (users-xac-nhan-khoa: 583 hay 189, ở cả hai bản).
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  if (steps.length) await page.waitForTimeout(300);
  // Thao tác có thể làm hiện chữ ở độ đậm/bảng mã chưa tải; chờ font xong rồi mới chụp.
  await page.evaluate(() => document.fonts.ready);
  // Ép vẽ lại cả trang trước khi chụp, cho cả hai bản. Bản React dựng trang bằng JS sau lần vẽ đầu, Chromium giữ lại
  // mảnh header đã vẽ ở lượt trước nên mép avatar tròn lệch vài mức màu dù DOM và style giống hệt. Ảnh cả trang của trang
  // cao hơn khung nhìn đã tự vẽ lại (Playwright giãn khung để chụp); trang vừa khít khung nhìn thì không, nên lệch chỉ lộ ở đó.
  await page.setViewportSize({ width: viewport.width + 1, height: viewport.height });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.setViewportSize(viewport);
  // Chờ hai khung hình để layout ổn định trước khi đọc style (tránh đọc margin auto giữa chừng).
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const items = await page.evaluate(snapshotInPage);
  const png = await page.screenshot({ fullPage: true });
  await context.close();
  return { items, png, errors };
}

let browser;
const attemptCounter = new Map();
async function runCase(pageId, { steps, query, viewport, theme, motion }, name) {
  const attempt = attemptCounter.get(name) ?? 0;
  attemptCounter.set(name, attempt + 1);
  let orig;
  let react;
  try {
    orig = await capture(browser, `http://127.0.0.1:${ORIGINAL_PORT}/${pageId}.html${query}`, viewport, theme, true, steps, motion);
    react = await capture(browser, `http://127.0.0.1:${REACT_PORT}${ROUTES[pageId] ?? '/' + pageId}${query}`, viewport, theme, false, steps, motion);
  } catch (error) {
    const message = String(error.message ?? error).split('\n')[0];
    return { ok: false, attempt, record: { error: `bản ${orig ? 'React' : 'gốc'}: ${message}` } };
  }
  fs.writeFileSync(path.join(outDir, `${name}-original.png`), orig.png);
  fs.writeFileSync(path.join(outDir, `${name}-react.png`), react.png);
  const diffs = compare(orig.items, react.items);
  const pixels = await pixelDiff(browser, orig.png, react.png, path.join(outDir, `${name}-diff.png`));
  const ok = diffs.length === 0 && pixels.diffPixels === 0 && react.errors.length === 0;
  return { ok, attempt, record: { elements: [orig.items.length, react.items.length], diffs: diffs.length, pixels, reactErrors: react.errors, originalErrors: orig.errors, firstDiffs: diffs.slice(0, 40) } };
}

fs.mkdirSync(outDir, { recursive: true });
const staticServer = await serveStatic(prototypesDir, ORIGINAL_PORT);
const vite = await createServer({ root: reactDir, configFile: path.join(reactDir, 'vite.config.ts'), logLevel: 'error', server: { port: REACT_PORT, strictPort: true, host: '127.0.0.1' } });
await vite.listen();
const report = [];
let failed = false;
try {
  for (const pageId of pages) {
    // Mỗi trang dùng một tiến trình Chromium mới: sau vài trăm context trong cùng tiến trình, nét chữ và mép hình tròn
    // đôi khi vẽ lệch lẻ pixel và lặp lại ở cả lần chạy lại, dù chạy riêng trang đó thì đạt.
    browser = await chromium.launch();
    const cases = [
      ...VIEWPORTS.flatMap(viewport => THEMES.map(theme => ({ state: null, steps: [], query: '', viewport, theme }))),
      ...(STATES[pageId] ?? []).flatMap(({ name: state, steps, query = '', only, motion = false }) => [
        { state, steps, query, motion, viewport: VIEWPORTS[0], theme: 'light' },
        { state, steps, query, motion, viewport: VIEWPORTS[1], theme: 'dark' },
      ].filter(c => !only || c.viewport.width === only)),
    ].filter(c => !onlyState || c.state === onlyState);
    for (const { state, steps, query, viewport, theme, motion } of cases) {
      const name = `${pageId}${state ? '-' + state : ''}-${viewport.width}-${theme}`;
      // Lệch thì chạy lại đúng một lần và chỉ tính đạt nếu lần chạy lại khớp hoàn toàn: khác biệt thật luôn lặp lại,
      // còn dao động của trình duyệt (lẻ pixel, đua thời gian) thì không.
      let result;
      let firstAttempt;
      for (let attempt = 0; attempt < 2; attempt++) {
        result = await runCase(pageId, { steps, query, viewport, theme, motion }, name);
        if (result.ok) break;
        if (attempt === 0) {
          // Lần chạy lại dùng tiến trình Chromium mới, để dao động của tiến trình cũ không lặp lại.
          await browser.close();
          browser = await chromium.launch();
          firstAttempt = result.record;
          // Giữ ảnh của lần lệch đầu (lần chạy lại ghi đè tên gốc) để xem dao động nằm ở đâu.
          for (const kind of ['original', 'react', 'diff']) {
            const file = path.join(outDir, `${name}-${kind}.png`);
            if (fs.existsSync(file)) fs.copyFileSync(file, path.join(outDir, `${name}-first-${kind}.png`));
          }
        }
      }
      const { ok, record, attempts } = { ...result, attempts: result.attempt + 1 };
      if (!ok) failed = true;
      // Ghi lại lần lệch đầu để biết dao động là gì.
      report.push({ case: name, ok, attempts, ...record, ...(firstAttempt ? { firstAttempt } : {}) });
      if (record.error) { console.log(`LỖI  ${name.padEnd(40)} ${record.error}`); continue; }
      const { diffs, pixels, elements, reactErrors } = record;
      console.log(`${ok ? 'ĐẠT ' : 'LỆCH'} ${name.padEnd(40)} phần tử ${elements[0]}/${elements[1]}  khác ${diffs}  pixel ${pixels.diffPixels} (${(pixels.ratio * 100).toFixed(3)}%) ảnh ${pixels.size}${reactErrors.length ? `  lỗi console React: ${reactErrors.length}` : ''}${attempts > 1 ? '  (chạy lại 1 lần)' : ''}`);
      for (const d of record.firstDiffs.slice(0, 8)) console.log(`     [${d.index}] ${d.kind} ${d.element ?? ''} gốc=${d.original} react=${d.react}`);
    }
    await browser.close();
    browser = undefined;
  }
} finally {
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  await browser?.close();
  await vite.close();
  staticServer.close();
}
console.log(failed ? '\nCÒN KHÁC BIỆT: xem .parity/report.json' : '\nĐẠT: bản React khớp bản gốc ở mọi trường hợp');
process.exit(failed ? 1 : 0);
