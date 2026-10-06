// Chép nguyên văn các hằng dữ liệu trong script của một bản mẫu sang src/pages/<Trang>/data.tsx.
// Tên có hậu tố :jsx (ví dụ SERVICE_SVGS:jsx) thì các giá trị là chuỗi HTML (icon SVG) được chuyển sang JSX.
//   node scripts/extract-data.mjs <trang.html> <TênComponent> <TÊN_HẰNG[:jsx]> ...
// Kiểu dữ liệu để TypeScript suy ra; khi các phần tử có trường tuỳ chọn thì khai thêm kiểu bằng tay.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFragment } from 'parse5';
import ts from 'typescript';
import { createRenderer } from './lib/html-jsx.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const prototypesDir = path.resolve(here, '../..');
const [file, component, ...wanted] = process.argv.slice(2);
if (!file || !component || !wanted.length) {
  console.error('Cách dùng: node scripts/extract-data.mjs <trang.html> <TênComponent> <TÊN_HẰNG[:jsx]> ...');
  process.exit(2);
}
const html = fs.readFileSync(path.join(prototypesDir, file), 'utf8');
const code = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(c => !c.includes('tailwind.config')).join('\n');
const source = ts.createSourceFile('inline.js', code, ts.ScriptTarget.Latest, true);
const specs = new Map(wanted.map(w => { const [name, mode] = w.split(':'); return [name, mode === 'jsx']; }));
const found = new Map();
source.forEachChild(node => {
  if (!ts.isVariableStatement(node)) return;
  for (const decl of node.declarationList.declarations) {
    const name = decl.name.getText();
    if (specs.has(name) && decl.initializer) found.set(name, decl.initializer);
  }
});
const toJsx = text => {
  const { renderChildren } = createRenderer();
  return renderChildren(parseFragment(text), 2).join('\n');
};
const out = [`// Dữ liệu chép nguyên văn từ docs/design/prototypes/${file} bằng scripts/extract-data.mjs.`];
for (const [name, jsx] of specs) {
  const init = found.get(name);
  if (!init) throw new Error(`Không tìm thấy hằng ${name}`);
  if (jsx && ts.isObjectLiteralExpression(init)) {
    const entries = init.properties.map(p => {
      const value = p.initializer;
      const text = value && (ts.isNoSubstitutionTemplateLiteral(value) || ts.isStringLiteral(value)) ? value.text : null;
      return text && /<[a-z]/i.test(text) ? `  ${p.name.getText()}: (\n${toJsx(text)}\n  ),` : `  ${p.getText()},`;
    });
    out.push(`export const ${name} = {\n${entries.join('\n')}\n};`);
  } else {
    out.push(`export const ${name} = ${init.getText()};`);
  }
}
const target = path.resolve(here, '..', `src/pages/${component}/data.tsx`);
fs.writeFileSync(target, out.join('\n\n') + '\n');
console.log(`${path.relative(process.cwd(), target)}: ${[...specs.keys()].join(', ')}`);
