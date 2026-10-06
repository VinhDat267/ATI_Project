// Chuyển các chuỗi template HTML trong JS của một bản mẫu (innerHTML = `...`) sang JSX để chép vào component.
// Biểu thức ${...} thành {biểu thức} (trong chữ) hoặc template literal (trong thuộc tính); onclick="fn('${id}')"
// thành onClick={() => actions.fn(id)}. Template lồng nhau (ví dụ trong .map) được in riêng, theo số dòng.
//   node scripts/template-to-jsx.mjs <trang.html> [tên-hàm ...]   (in ra màn hình)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFragment } from 'parse5';
import ts from 'typescript';
import { createRenderer } from './lib/html-jsx.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const prototypesDir = path.resolve(here, '../..');
const [file, ...onlyFunctions] = process.argv.slice(2);
if (!file) {
  console.error('Cách dùng: node scripts/template-to-jsx.mjs <trang.html> [tên-hàm ...]');
  process.exit(2);
}
const html = fs.readFileSync(path.join(prototypesDir, file), 'utf8');
// Script inline (bỏ cấu hình Tailwind), kèm dòng bắt đầu trong file HTML để in số dòng gốc.
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
  .filter(m => !m[1].includes('tailwind.config'))
  .map(m => ({ code: m[1], line: html.slice(0, m.index + m[0].indexOf(m[1])).split('\n').length }));

const enclosingFunction = node => {
  for (let n = node.parent; n; n = n.parent) {
    if (ts.isFunctionDeclaration(n) && n.name) return n.name.text;
    if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && ts.isVariableDeclaration(n.parent)) return n.parent.name.getText();
  }
  return '(ngoài hàm)';
};

for (const { code, line } of scripts) {
  const source = ts.createSourceFile('inline.js', code, ts.ScriptTarget.Latest, true);
  const visit = node => {
    if (ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const raw = node.getText().slice(1, -1);
      const fn = enclosingFunction(node);
      if (/<[a-z][\s\S]*>/i.test(raw) && (!onlyFunctions.length || onlyFunctions.includes(fn))) {
        const exprs = [];
        let text = ts.isTemplateExpression(node) ? node.head.text : node.text;
        if (ts.isTemplateExpression(node)) {
          for (const span of node.templateSpans) {
            text += `__E${exprs.length}__`;
            exprs.push(span.expression.getText());
            text += span.literal.text;
          }
        }
        const { renderChildren, handlers } = createRenderer({ exprs });
        const jsx = renderChildren(parseFragment(text), 1);
        const at = line + source.getLineAndCharacterOfPosition(node.getStart()).line;
        console.log(`\n// ── ${file}:${at} · ${fn} ${'─'.repeat(40)}`);
        console.log('<>');
        console.log(jsx.join('\n'));
        console.log('</>');
        const todo = handlers.filter(h => !h.fn);
        if (todo.length) console.log(`// handler cần chuyển tay: ${todo.map(h => h.code).join(' | ')}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}
