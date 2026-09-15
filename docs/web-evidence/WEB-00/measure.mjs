// Isolated dependency/build probe. Does not install into the working repository.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
const root = process.cwd();
const npm = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
if (!fs.existsSync(npm)) throw new Error('Expected Windows Node installation containing npm CLI');
const original = fs.readFileSync(path.join(root, 'package-lock.json'));
const hash = data => createHash('sha256').update(data).digest('hex');
const base = JSON.parse(original);
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'ati-web00-'));
const candidates = {
  control: null,
  dom: {},
  preact: { dependencies: { preact: '10.29.8' } },
  react: { dependencies: { react: '19.3.0', 'react-dom': '19.3.0' }, devDependencies: { '@types/react': '19.3.0', '@types/react-dom': '19.3.0' } },
};
const manifests = ['package.json'];
for (const parent of ['apps', 'packages']) {
  for (const entry of fs.readdirSync(path.join(root, parent), { withFileTypes: true })) {
    const file = path.join(parent, entry.name, 'package.json');
    if (entry.isDirectory() && fs.existsSync(path.join(root, file))) manifests.push(file);
  }
}
const commands = [];
function run(cwd, args) {
  const started = Date.now();
  const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', timeout: 180000, windowsHide: true });
  commands.push({ variant: cwd === root ? 'workspace-readonly' : path.relative(sandbox, cwd).split(path.sep)[0], cwd: cwd === root ? '.' : path.relative(sandbox, cwd).split(path.sep).join('/'), command: args[0] === npm ? ['npm', ...args.slice(1)] : ['node', path.relative(cwd, args[0]).split(path.sep).join('/'), ...args.slice(1)], exit: result.status, ms: Date.now() - started });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || String(result.error)).slice(-2000));
  return result.stdout;
}
const packageEntries = lock => Object.entries(lock.packages).filter(([p]) => p.includes('node_modules/'));
const identities = lock => new Set(packageEntries(lock).map(([p,v]) => `${p.split('node_modules/').at(-1)}@${v.version}`));
const results = {};
for (const [name, additions] of Object.entries(candidates)) {
  const cwd = path.join(sandbox, name);
  for (const file of manifests) {
    fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
    fs.copyFileSync(path.join(root, file), path.join(cwd, file));
  }
  fs.writeFileSync(path.join(cwd, 'package-lock.json'), original);
  if (additions) {
    fs.mkdirSync(path.join(cwd, 'apps/web'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'apps/web/package.json'), JSON.stringify({ name: '@wap/web', private: true, type: 'module', dependencies: { '@wap/dsl': '0.1.0', zod: '4.6.2', ...additions.dependencies }, devDependencies: { typescript: '5.9.3', vitest: '2.1.9', vite: '8.3.0', '@playwright/test': '1.63.0', ...additions.devDependencies } }, null, 2));
  }
  run(cwd, [npm, 'install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund']);
  const lockBytes = fs.readFileSync(path.join(cwd, 'package-lock.json'));
  const lock = JSON.parse(lockBytes);
  const before = identities(base);
  const after = identities(lock);
  const added = [...after].filter(x => !before.has(x)).sort();
  const removed = [...before].filter(x => !after.has(x)).sort();
  results[name] = { entries: packageEntries(lock).length, uniqueNameVersions: after.size, deltaEntries: packageEntries(lock).length - packageEntries(base).length, added, removed, lockSha256: hash(lockBytes) };
  if (!additions) continue;
  // No lifecycle scripts. Optional platform binaries must work as published.
  run(cwd, [npm, 'ci', '--ignore-scripts', '--no-audit', '--no-fund']);
  const probe = path.join(cwd, 'apps/web');
  for (const file of ['contracts.ts', 'events.ts', 'schema.ts']) {
    fs.copyFileSync(path.join(root, 'packages/dsl/src', file), path.join(probe, file));
  }
  fs.writeFileSync(path.join(probe, 'index.html'), '<!doctype html><html><body><div id="app"></div><script type="module" src="/main.ts"></script></body></html>');
  const common = `import { RunDetailSchema } from './contracts';\nconst labels=['Đăng nhập','Tổng quan','Tạo yêu cầu','Lần chạy','Chi tiết lần chạy','Công cụ & kết nối'];\nconst sample={run_id:'demo',status:'planning',workflow_version_id:null,plan:null,planner_result:null,approval:null,time_zone:'Asia/Ho_Chi_Minh',runtime:{},last_seq:0};\nconst status=RunDetailSchema.parse(sample).status;\n`;
  const body = name === 'dom'
    ? `const app=document.getElementById('app');for(const label of labels){const el=document.createElement('p');el.textContent=label+' '+status;app.append(el);}`
    : name === 'react'
      ? `import {createElement as h} from 'react';import {createRoot} from 'react-dom/client';createRoot(document.getElementById('app')).render(h('main',null,labels.map(label=>h('p',{key:label},label+' '+status))));`
      : `import {h,render} from 'preact';render(h('main',null,labels.map(label=>h('p',{key:label},label+' '+status))),document.getElementById('app'));`;
  fs.writeFileSync(path.join(probe, 'main.ts'), common + body);
  const viteEntry = fs.existsSync(path.join(probe, 'node_modules/vite/bin/vite.js')) ? path.join(probe, 'node_modules/vite/bin/vite.js') : path.join(cwd, 'node_modules/vite/bin/vite.js');
  run(probe, [viteEntry, 'build']);
  const assets = fs.readdirSync(path.join(probe, 'dist/assets')).filter(x => x.endsWith('.js'));
  results[name].probeJavaScript = assets.map(file => {
    const bytes = fs.readFileSync(path.join(probe, 'dist/assets', file));
    return { file, bytes: bytes.length, gzipBytes: gzipSync(bytes).length, sha256: hash(bytes) };
  });
  console.log(`${name}: ${results[name].entries} lock entries; build passed`);
}
if (hash(fs.readFileSync(path.join(root, 'package-lock.json'))) !== hash(original)) throw new Error('Working lockfile changed');
const report = { capturedAt: new Date().toISOString(), node: process.version, npm: run(root, [npm, '--version']).trim(), probeScriptSha256: hash(fs.readFileSync(new URL(import.meta.url))), baselineLockSha256: hash(original), baselineEntries: packageEntries(base).length, baselineUniqueNameVersions: identities(base).size, sourceHashes: Object.fromEntries(['contracts.ts','events.ts','schema.ts'].map(f=>[f,hash(fs.readFileSync(path.join(root,'packages/dsl/src',f)))])), results, commands, limitations: ['Minimal renderer plus shared RunDetail parser only; not the completed six-view application.', 'No browser behavior, focus, polling, usability or runtime latency measurement.', 'Lock entries include optional platform variants; not the installed Windows package count.', 'No vulnerability audit or dependency fingerprint approval performed.', 'Temporary installations retained for inspection; no recursive deletion.'] };
fs.writeFileSync(path.join(root, 'docs/web-evidence/WEB-00/measurement.json'), JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({sandbox,summary:Object.fromEntries(Object.entries(results).map(([k,v])=>[k,{entries:v.entries,delta:v.deltaEntries,added:v.added.length,removed:v.removed.length,js:v.probeJavaScript}]))},null,2));
