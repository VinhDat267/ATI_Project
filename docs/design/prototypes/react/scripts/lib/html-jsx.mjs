// Lõi chuyển HTML (cây parse5) sang JSX, dùng chung cho html-to-jsx.mjs (cả trang) và template-to-jsx.mjs
// (chuỗi template HTML trong JS của bản mẫu). Biểu thức `${...}` của template được thay bằng mốc __E<n>__ trước khi
// parse, rồi trả lại thành biểu thức JSX.

// Đường dẫn giữa các trang bản mẫu → route của bản React.
export const pageRoutes = {
  'index.html': '/', 'app-stage.html': '/app-stage', 'responses.html': '/responses', 'settings.html': '/settings',
  'account.html': '/account', 'users.html': '/users', 'history.html': '/history', 'auth-action.html': '/auth-action',
  'errors.html': '/errors', 'guide.html': '/guide', 'privacy.html': '/privacy', '404.html': '/404',
};
export function rewriteHref(value) {
  const match = /^([a-z0-9-]+\.html)(#.*|\?.*)?$/.exec(value);
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
const MARKER = /__E(\d+)__/g;
const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'return', 'typeof', 'void', 'new', 'delete', 'await']);
// Ngoặc tròn cân bằng và không đóng quá số đã mở, bỏ qua phần trong chuỗi.
function balanced(code) {
  let depth = 0;
  let quote = null;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '(') depth++;
    else if (c === ')' && --depth < 0) return false;
  }
  return depth === 0 && !quote;
}

const camel = name => name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
// Tailwind v4 đổi cách tính space-x/space-y/divide (margin/viền ở phần tử trước thay vì phần tử sau) và
// outline-none (v3: viền trong suốt 2px, vẫn hiện ở chế độ tương phản cao; v4: bỏ hẳn viền) và
// transform (v3: luôn đặt transform, ma trận đơn vị khi chưa có translate/scale; v4: không đặt gì).
// Đổi sang các utility v3-* khai trong src/styles/v3-compat.css để giữ đúng cách của v3.
export function v3Classes(value) {
  return value.trim().split(/\s+/).map(token => {
    const match = /^((?:[^:[\]]*:)*)(-?space-[xy]-.+|divide-.+|outline-none|transform)$/.exec(token);
    if (!match) return token;
    const [, variants, base] = match;
    // Khoảng cách âm (-space-x-1.5): v4 cần utility âm khai riêng, nên đổi thành -v3-space-*.
    if (base.startsWith('-')) return `${variants}-v3-${base.slice(1)}`;
    if (/^space-[xy]-/.test(base) || base === 'outline-none' || base === 'transform') return `${variants}v3-${base}`;
    if (/^divide-[xy](-\d+)?$/.test(base)) return `${variants}v3-${base}`;
    // Màu divide giữ tên gốc: theme.css ghi đè theo tên; v3-theme-targets.css khai lại theo cách tính v3.
    return token;
  }).join(' ');
}
const attr = (node, name) => node.attrs?.find(a => a.name === name)?.value;
export const classOf = node => attr(node, 'class') ?? '';
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

// exprs: mã JS của từng mốc __E<n>__ (rỗng khi chuyển cả trang).
export function createRenderer({ exprs = [] } = {}) {
  const handlers = [];
  const skipped = { scripts: [], styles: [] };
  const expr = i => exprs[Number(i)];
  // Giá trị thuộc tính: chuỗi thường hoặc template literal khi có biểu thức.
  const attrValue = value => {
    if (MARKER.test(value)) {
      MARKER.lastIndex = 0;
      const tpl = value.replace(/[`\\]/g, m => '\\' + m).replace(/\$\{/g, '\\${').replace(MARKER, (_, i) => '${' + expr(i) + '}');
      return `{\`${tpl}\`}`;
    }
    return /["&{}\\\n]/.test(value) ? `{${JSON.stringify(value)}}` : `"${value}"`;
  };
  // Mã handler: mốc trong chuỗi ('__E0__') và mốc trần đều thành biểu thức.
  const wrap = e => (/^[\w$.[\]'"]+$/.test(e) ? e : `(${e})`);
  const restoreCode = code => code.replace(/(['"])__E(\d+)__\1/g, (_, q, i) => wrap(expr(i))).replace(MARKER, (_, i) => wrap(expr(i)));
  function eventAttr(event, rawCode) {
    const prop = EVENTS[event];
    if (!prop) throw new Error(`Chưa hỗ trợ sự kiện on${event}`);
    const code = restoreCode(rawCode);
    const call = /^\s*([A-Za-z_$][\w$]*)\s*\(([\s\S]*)\)\s*;?\s*$/.exec(code);
    // Chỉ nhận lời gọi một hàm: không phải từ khoá (if(...) a()), tham số có ngoặc cân bằng (không phải a() + b()).
    if (call && !KEYWORDS.has(call[1]) && balanced(call[2]) && !/\)\s*;\s*[A-Za-z_$]/.test(code)) {
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
      if (/^__E\d+__$/.test(name)) { out.push(`{/* thuộc tính động: ${expr(name.slice(3, -2))} */}`); continue; }
      const event = /^on([a-z]+)$/.exec(name);
      if (event) { out.push(eventAttr(event[1], value)); continue; }
      if (name === 'style') { out.push(MARKER.test(value) ? `style={/* ${value.replace(MARKER, (_, i) => '${' + expr(i) + '}')} */ {}}` : `style=${styleObject(value)}`); MARKER.lastIndex = 0; continue; }
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
  // Văn bản có mốc. Chỉ một biểu thức (thường sinh phần tử: icon, .map) → {biểu thức}, giữ khoảng trắng hai bên
  // thành node riêng như HTML. Chữ trộn biểu thức → một template literal, để ra đúng một text node như HTML gốc
  // (tách nhiều text node làm trình duyệt dựng chữ thành nhiều đoạn, lệch lẻ pixel).
  function textWithExprs(text, pad) {
    const only = /^(\s?)__E(\d+)__(\s?)$/.exec(text);
    if (only) return [only[1] && `${pad}{' '}`, `${pad}{${expr(only[2])}}`, only[3] && `${pad}{' '}`].filter(Boolean);
    const tpl = text.replace(/[`\\]/g, m => '\\' + m).replace(/\$\{/g, '\\${').replace(MARKER, (_, i) => '${' + expr(i) + '}');
    return [`${pad}{\`${tpl}\`}`];
  }
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
        const text = `${lead ? ' ' : ''}${collapsed.trim()}${trail ? ' ' : ''}`;
        if (MARKER.test(text)) { MARKER.lastIndex = 0; lines.push(...textWithExprs(text, pad)); return; }
        // Giữ một text node như HTML gốc: tách khoảng trắng thành node riêng làm trình duyệt dựng chữ thành nhiều đoạn,
        // lệch vị trí lẻ pixel của vài ký tự.
        if (lead || trail) lines.push(`${pad}{${JSON.stringify(text)}}`);
        else lines.push(`${pad}${escapeText(collapsed.trim())}`);
        return;
      }
      if (!isElement(node)) return;
      const tag = node.tagName;
      const attrs = jsxAttrs(node);
      const children = tag === 'textarea' ? [] : renderChildren(node.content ?? node, depth + 1);
      if (VOID.has(tag) || children.length === 0) { lines.push(`${pad}<${tag}${attrs} />`); return; }
      lines.push(`${pad}<${tag}${attrs}>`, ...children, `${pad}</${tag}>`);
    });
    return lines;
  }
  return { renderChildren, handlers, skipped };
}
