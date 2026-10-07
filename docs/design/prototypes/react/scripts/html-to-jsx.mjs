// Chuyển một trang bản mẫu HTML sang khung React: JSX của <body>, CSS của các thẻ <style>, thông tin <head>.
// Chạy một lần cho mỗi trang, sau đó sửa tay file .tsx (nối state, chuyển JS inline sang React).
//   node scripts/html-to-jsx.mjs <trang.html> <TênComponent> [thư-mục-ra]
// Ví dụ: node scripts/html-to-jsx.mjs 404.html NotFound
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';
import { classOf, createRenderer } from './lib/html-jsx.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const prototypesDir = path.resolve(here, '../..');
const [file, component, outArg] = process.argv.slice(2);
if (!file || !component) {
  console.error('Cách dùng: node scripts/html-to-jsx.mjs <trang.html> <TênComponent> [thư-mục-ra]');
  process.exit(2);
}
const outDir = path.resolve(here, '..', outArg ?? `src/pages/${component}`);
const html = fs.readFileSync(path.join(prototypesDir, file), 'utf8');
const document = parse(html);
const { renderChildren, handlers, skipped } = createRenderer();

const htmlEl = document.childNodes.find(n => n.tagName === 'html');
const head = htmlEl.childNodes.find(n => n.tagName === 'head');
const body = htmlEl.childNodes.find(n => n.tagName === 'body');
const title = head.childNodes.find(n => n.tagName === 'title')?.childNodes.map(c => c.value).join('').trim() ?? '';
for (const node of head.childNodes) if (node.tagName === 'style') skipped.styles.push(node.childNodes.map(c => c.value).join(''));
const jsx = renderChildren(body, 3);
const bodyAttrs = (body.attrs ?? []).filter(a => a.name !== 'class');
if (bodyAttrs.length) console.warn('Thuộc tính <body> chưa chuyển:', bodyAttrs);

const todos = handlers.filter(h => !h.fn);
const actionNames = [...new Set(handlers.filter(h => h.fn).map(h => h.fn))];
const tsx = `// Chuyển từ docs/design/prototypes/${file} bằng scripts/html-to-jsx.mjs, sau đó sửa tay.
import { usePrototypePage, type PageMeta } from '../../app/usePrototypePage';
${handlers.length ? "import { todo } from '../../app/todo';\n" : ''}import css from './page.css?inline';

export const meta: PageMeta = {
  id: ${JSON.stringify(path.basename(file, '.html'))},
  title: ${JSON.stringify(title)},
  htmlClass: ${JSON.stringify(classOf(htmlEl).trim())},
  bodyClass: ${JSON.stringify(classOf(body).trim().replace(/\s+/g, ' '))},
  css,
};

export function ${component}Page() {
  usePrototypePage(meta);
${actionNames.length ? `  const actions = {\n${actionNames.map(n => `    ${n}: (...args: unknown[]) => { void args; todo(${JSON.stringify(n)}); },`).join('\n')}\n  };\n` : ''}  return (
    <>
${jsx.join('\n')}
    </>
  );
}
`;
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, `${component}Page.tsx`), tsx);
const styles = skipped.styles.map(css => css.replace(/^\n+/, '').replace(/\s+$/, ''));
// Biến --font-body/--font-display/--font-mono của trang trùng tên biến theme mà Tailwind v4 khai trên :root (đứng sau
// nên đè biến của trang); đổi tên thành --page-font-* ở cả chỗ khai lẫn chỗ dùng. Tailwind v3 của bản mẫu không có biến này.
const pageCss = styles.join('\n\n').replace(/--font-(body|display|mono)\b/g, '--page-font-$1');
fs.writeFileSync(path.join(outDir, 'page.css'), `/* <style> của ${file}, giữ nguyên thứ tự (biến --font-* đổi thành --page-font-*). */\n${pageCss}\n`);
console.log(`${file} → ${path.relative(process.cwd(), outDir)}`);
console.log(`  JSX ${jsx.length} dòng, CSS ${skipped.styles.length} khối, script inline ${skipped.scripts.length} khối (${skipped.scripts.join('\n').split('\n').length} dòng, cần chuyển tay)`);
console.log(`  handler: ${handlers.length} (${actionNames.length} hàm: ${actionNames.join(', ') || '—'}; ${todos.length} đoạn code cần chuyển tay)`);
