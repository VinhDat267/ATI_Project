// Chuyển một trang bản mẫu HTML sang khung React: JSX của <body>, CSS của các thẻ <style>, thông tin <head>.
// Chạy một lần cho mỗi trang, sau đó sửa tay file .tsx (nối state, chuyển JS inline sang React).
//   node scripts/html-to-jsx.mjs <trang.html> <TênComponent> [thư-mục-ra]
// Ví dụ: node scripts/html-to-jsx.mjs 404.html NotFound
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';

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

// Đường dẫn giữa các trang bản mẫu → route của bản React.
const pageRoutes = {
  'index.html': '/', 'app-stage.html': '/app-stage', 'responses.html': '/responses', 'settings.html': '/settings',
  'account.html': '/account', 'users.html': '/users', 'history.html': '/history', 'auth-action.html': '/auth-action',
  'errors.html': '/errors', 'guide.html': '/guide', 'privacy.html': '/privacy', '404.html': '/404',
};
function rewriteHref(value) {
  const match = /^([a-z0-9-]+\.html)(#.*)?$/.exec(value);
  if (!match || !pageRoutes[match[1]]) return value;
  return pageRoutes[match[1]] + (match[2] ?? '');
}

const ATTR = {
  class: 'className', for: 'htmlFor', tabindex: 'tabIndex', readonly: 'readOnly', maxlength: 'maxLength',
  minlength: 'minLength', colspan: 'colSpan', rowspan: 'rowSpan', autocomplete: 'autoComplete', autofocus: 'autoFocus',
  novalidate: 'noValidate', contenteditable: 'contentEditable', crossorigin: 'crossOrigin', datetime: 'dateTime',
  enctype: 'encType', spellcheck: 'spellCheck', srcset: 'srcSet', inputmode: 'inputMode', enterkeyhint: 'enterKeyHint',
  accesskey: 'accessKey', allowfullscreen: 'allowFullScreen', referrerpolicy: 'referrerPolicy', playsinline: 'playsInline',
  formaction: 'formAction', formnovalidate: 'formNoValidate', hreflang: 'hrefLang', 'accept-charset': 'acceptCharset',
  'xlink:href': 'xlinkHref', 'xml:space': 'xmlSpace', 'xmlns:xlink': 'xmlnsXlink',
};
const NUMERIC = new Set(['tabIndex', 'colSpan', 'rowSpan', 'maxLength', 'minLength', 'rows', 'cols', 'size', 'start', 'span']);
const BOOLEAN = new Set(['disabled', 'readonly', 'required', 'multiple', 'hidden', 'open', 'autofocus', 'novalidate',
  'async', 'defer', 'playsinline', 'controls', 'loop', 'muted', 'autoplay', 'reversed', 'allowfullscreen', 'default',
  'formnovalidate', 'inert', 'itemscope', 'checked', 'selected']);
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const EVENTS = { click: 'onClick', change: 'onChange', input: 'onInput', keydown: 'onKeyDown', keyup: 'onKeyUp',
  submit: 'onSubmit', focus: 'onFocus', blur: 'onBlur', mouseenter: 'onMouseEnter', mouseleave: 'onMouseLeave',
  scroll: 'onScroll', load: 'onLoad', error: 'onError' };
const BLOCK_TAGS = new Set(['address', 'article', 'aside', 'blockquote', 'details', 'dialog', 'div', 'dl', 'dd', 'dt',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main',
  'nav', 'ol', 'p', 'section', 'summary', 'table', 'tbody', 'thead', 'tfoot', 'tr', 'td', 'th', 'ul']);

const camel = name => name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
// Tailwind v4 đổi cách tính space-x/space-y/divide (margin/viền ở phần tử trước thay vì phần tử sau) và
// outline-none (v3: viền trong suốt 2px, vẫn hiện ở chế độ tương phản cao; v4: bỏ hẳn viền).
// Đổi sang các utility v3-* khai trong src/styles/v3-compat.css để giữ đúng cách của v3.
function v3Classes(value) {
  return value.trim().split(/\s+/).map(token => {
    const match = /^((?:[^:[\]]*:)*)(space-[xy]-.+|divide-.+|outline-none)$/.exec(token);
    if (!match) return token;
    const [, variants, base] = match;
    if (/^space-[xy]-/.test(base) || base === 'outline-none') return `${variants}v3-${base}`;
    if (/^divide-[xy](-\d+)?$/.test(base)) return `${variants}v3-${base}`;
    return `${variants}v3-divide-color-${base.slice('divide-'.length)}`;
  }).join(' ');
}
const attr = (node, name) => node.attrs?.find(a => a.name === name)?.value;
const classOf = node => attr(node, 'class') ?? '';
const isElement = node => !!node.tagName;
const isText = node => node.nodeName === '#text';
const isComment = node => node.nodeName === '#comment';

function isBlockLevel(node) {
  if (!isElement(node)) return false;
  const cls = ` ${classOf(node)} `;
  if (/\s(inline|inline-block|inline-flex|inline-grid|contents)\s/.test(cls)) return false;
  if (/\s(block|flex|grid|table|hidden)\s/.test(cls)) return true;
  return BLOCK_TAGS.has(node.tagName);
}
// Văn bản chỉ có khoảng trắng không hiển thị trong flex/grid container (kể cả khi đổi theo breakpoint giữa flex/grid).
function isFlexOrGridContainer(node) {
  const cls = classOf(node).split(/\s+/);
  const base = cls.filter(c => !c.includes(':'));
  const responsive = cls.filter(c => c.includes(':')).map(c => c.split(':').pop());
  const isBox = c => /^(inline-)?(flex|grid)$/.test(c);
  const isOther = c => /^(block|inline|inline-block|table|contents|flow-root|list-item)$/.test(c);
  return base.some(isBox) && !responsive.some(isOther);
}
const preserveWhitespace = node => ['pre', 'textarea'].includes(node.tagName) || /\bwhitespace-pre/.test(classOf(node));

function escapeText(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\{/g, '&#123;').replace(/\}/g, '&#125;').replace(/ /g, '&nbsp;');
}
function attrValue(value) {
  return /["&{}\\\n]/.test(value) ? `{${JSON.stringify(value)}}` : `"${value}"`;
}
function styleObject(css) {
  const entries = css.split(';').map(s => s.trim()).filter(Boolean).map(decl => {
    const i = decl.indexOf(':');
    const prop = decl.slice(0, i).trim();
    const value = decl.slice(i + 1).trim();
    const key = prop.startsWith('--') ? JSON.stringify(prop)
      : camel(prop.replace(/^-ms-/, 'ms-').replace(/^-(webkit|moz)-/, (_, v) => `${v[0].toUpperCase()}${v.slice(1)}-`));
    return `${key}: ${JSON.stringify(value)}`;
  });
  return `{{ ${entries.join(', ')} }}`;
}

const handlers = [];
function eventAttr(event, code) {
  const prop = EVENTS[event];
  if (!prop) throw new Error(`Chưa hỗ trợ sự kiện on${event}`);
  const call = /^\s*([A-Za-z_$][\w$]*)\s*\(([^()]*)\)\s*;?\s*$/.exec(code);
  if (call) {
    const [, fn, rawArgs] = call;
    const args = rawArgs.replace(/\bthis\b/g, 'event.currentTarget');
    handlers.push({ fn, code });
    return `${prop}={(${/\bevent\b/.test(args) ? 'event' : ''}) => actions.${fn}(${args})}`;
  }
  handlers.push({ fn: null, code });
  return `${prop}={(event) => { void event; todo(${JSON.stringify(code)}); }}`;
}

function jsxAttrs(node) {
  const out = [];
  let selectDefault;
  if (node.tagName === 'select') {
    const options = [];
    (function collect(n) { for (const c of n.childNodes ?? []) { if (c.tagName === 'option') options.push(c); collect(c); } })(node);
    const chosen = options.find(o => attr(o, 'selected') !== undefined);
    if (chosen) selectDefault = attr(chosen, 'value') ?? chosen.childNodes.map(c => c.value ?? '').join('').trim();
  }
  for (const { name, value } of node.attrs ?? []) {
    const event = /^on([a-z]+)$/.exec(name);
    if (event) { out.push(eventAttr(event[1], value)); continue; }
    if (name === 'style') { out.push(`style=${styleObject(value)}`); continue; }
    if (node.tagName === 'option' && name === 'selected') continue;
    if (name === 'href') { out.push(`href=${attrValue(rewriteHref(value))}`); continue; }
    if (name === 'value' && ['input', 'textarea'].includes(node.tagName)) { out.push(`defaultValue=${attrValue(value)}`); continue; }
    if (name === 'checked' && node.tagName === 'input') { out.push('defaultChecked'); continue; }
    let prop = ATTR[name] ?? name;
    if (!ATTR[name] && name.includes('-') && !/^(aria|data)-/.test(name)) prop = camel(name);
    if (name === 'class') { out.push(`className=${attrValue(v3Classes(value))}`); continue; }
    if (BOOLEAN.has(name) && (value === '' || value === name)) { out.push(prop); continue; }
    if (NUMERIC.has(prop) && /^-?\d+$/.test(value)) { out.push(`${prop}={${value}}`); continue; }
    out.push(`${prop}=${attrValue(value)}`);
  }
  if (selectDefault !== undefined) out.push(`defaultValue=${attrValue(selectDefault)}`);
  if (node.tagName === 'textarea') {
    const text = node.childNodes.map(c => c.value ?? '').join('').replace(/^\n/, '');
    if (text) out.push(`defaultValue=${attrValue(text)}`);
  }
  return out.length ? ' ' + out.join(' ') : '';
}

const skipped = { scripts: [], styles: [] };
function renderChildren(parent, depth) {
  const kids = parent.childNodes ?? [];
  const lines = [];
  const pad = '  '.repeat(depth);
  kids.forEach((node, index) => {
    if (isElement(node) && node.tagName === 'script') { skipped.scripts.push(node.childNodes.map(c => c.value).join('')); return; }
    if (isElement(node) && node.tagName === 'style') { skipped.styles.push(node.childNodes.map(c => c.value).join('')); return; }
    if (isComment(node)) { lines.push(`${pad}{/* ${node.data.trim().replace(/\*\//g, '* /')} */}`); return; }
    if (isText(node)) {
      if (preserveWhitespace(parent)) { if (node.value) lines.push(`${pad}{${JSON.stringify(node.value)}}`); return; }
      const visible = s => s && (isElement(s) || (isText(s) && s.value.trim()));
      const prev = kids.slice(0, index).reverse().find(visible);
      const next = kids.slice(index + 1).find(visible);
      const dropEdges = isFlexOrGridContainer(parent) || isBlockLevel(parent);
      const collapsed = node.value.replace(/[ \t\n\r\f]+/g, ' ');
      if (!collapsed.trim()) {
        if (isFlexOrGridContainer(parent)) return;
        if (!prev || !next) { if (dropEdges) return; }
        else if (isBlockLevel(prev) && isBlockLevel(next)) return;
        lines.push(`${pad}{' '}`);
        return;
      }
      const lead = collapsed.startsWith(' ') && !(dropEdges && !prev) && !(prev && isBlockLevel(prev));
      const trail = collapsed.endsWith(' ') && !(dropEdges && !next) && !(next && isBlockLevel(next));
      // Giữ một text node như HTML gốc: tách khoảng trắng thành node riêng làm trình duyệt dựng chữ thành nhiều đoạn,
      // lệch vị trí lẻ pixel của vài ký tự.
      if (lead || trail) lines.push(`${pad}{${JSON.stringify(`${lead ? ' ' : ''}${collapsed.trim()}${trail ? ' ' : ''}`)}}`);
      else lines.push(`${pad}${escapeText(collapsed.trim())}`);
      return;
    }
    if (!isElement(node)) return;
    const tag = node.tagName;
    const attrs = jsxAttrs(node);
    const children = tag === 'textarea' ? [] : renderChildren(node, depth + 1);
    if (VOID.has(tag) || children.length === 0) { lines.push(`${pad}<${tag}${attrs} />`); return; }
    lines.push(`${pad}<${tag}${attrs}>`, ...children, `${pad}</${tag}>`);
  });
  return lines;
}

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
fs.writeFileSync(path.join(outDir, 'page.css'), `/* <style> của ${file}, giữ nguyên thứ tự. */\n${styles.join('\n\n')}\n`);
console.log(`${file} → ${path.relative(process.cwd(), outDir)}`);
console.log(`  JSX ${jsx.length} dòng, CSS ${skipped.styles.length} khối, script inline ${skipped.scripts.length} khối (${skipped.scripts.join('\n').split('\n').length} dòng, cần chuyển tay)`);
console.log(`  handler: ${handlers.length} (${actionNames.length} hàm: ${actionNames.join(', ') || '—'}; ${todos.length} đoạn code cần chuyển tay)`);
