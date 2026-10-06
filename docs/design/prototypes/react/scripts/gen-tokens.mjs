// Sinh src/styles/tokens.css từ cấu hình tailwind.config inline của 12 bản mẫu.
// Mỗi token trỏ tới biến --p-* do từng trang khai (theo :root[data-proto-page]), nên trang nào giữ đúng giá trị
// của trang đó. Trang không khai token thì class tương ứng không có tác dụng, như Tailwind v3 CDN.
//   node scripts/gen-tokens.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const prototypesDir = path.resolve(here, '../..');
const out = path.resolve(here, '../src/styles/tokens.css');
// Token mặc định của Tailwind mà trang có thể ghi đè: thiếu thì dùng giá trị mặc định (giống v3 và v4).
const DEFAULTS = {
  '--font-sans': 'ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"',
  '--font-serif': 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
  '--font-mono': 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
};

function readConfig(file) {
  const html = fs.readFileSync(path.join(prototypesDir, file), 'utf8');
  const script = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes('tailwind.config'));
  if (!script) return null;
  const sandbox = { tailwind: {} };
  vm.runInNewContext(script, sandbox);
  return sandbox.tailwind.config;
}
function flattenColors(prefix, value, into) {
  for (const [key, v] of Object.entries(value)) {
    const name = key === 'DEFAULT' ? prefix : `${prefix}-${key}`;
    if (v && typeof v === 'object') flattenColors(name, v, into); else into[`--color${name}`] = String(v);
  }
}
function tokensOf(config) {
  const extend = config?.theme?.extend ?? {};
  if (config?.theme && Object.keys(config.theme).some(k => k !== 'extend')) throw new Error('Cấu hình ghi đè theme gốc, chưa hỗ trợ');
  const tokens = {};
  flattenColors('', extend.colors ?? {}, tokens);
  for (const [key, list] of Object.entries(extend.fontFamily ?? {})) tokens[`--font-${key}`] = [].concat(list).join(', ');
  for (const [key, value] of Object.entries(extend.boxShadow ?? {})) tokens[`--shadow-${key}`] = value;
  const unknown = Object.keys(extend).filter(k => !['colors', 'fontFamily', 'boxShadow'].includes(k));
  if (unknown.length) throw new Error(`Chưa hỗ trợ theme.extend: ${unknown.join(', ')}`);
  return tokens;
}

const pages = fs.readdirSync(prototypesDir).filter(f => f.endsWith('.html')).sort();
const perPage = Object.fromEntries(pages.map(f => [path.basename(f, '.html'), tokensOf(readConfig(f))]));
const names = [...new Set(Object.values(perPage).flatMap(t => Object.keys(t)))].sort();
const pv = name => `--p-${name.slice(2)}`;
const theme = names.map(n => `  ${n}: var(${pv(n)}${DEFAULTS[n] ? `, ${DEFAULTS[n]}` : ''});`);
const blocks = Object.entries(perPage).map(([id, tokens]) =>
  `:root[data-proto-page="${id}"] {\n${Object.entries(tokens).sort().map(([n, v]) => `  ${pv(n)}: ${v};`).join('\n')}\n}`);
const css = `/* Sinh tự động bởi scripts/gen-tokens.mjs từ tailwind.config của 12 bản mẫu. Không sửa tay. */
@theme {
${theme.join('\n')}
}

${blocks.join('\n\n')}
`;
fs.writeFileSync(out, css);
console.log(`tokens.css: ${names.length} token, ${pages.length} trang`);
