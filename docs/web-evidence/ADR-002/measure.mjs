// Isolated dependency/build probe for ADR-002. Does not install into the working repository.
// Run from repository root: node docs/web-evidence/ADR-002/measure.mjs
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

const root = process.cwd();
const npm = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
if (!fs.existsSync(npm)) throw new Error('Expected Node installation containing npm CLI');
const hash = data => createHash('sha256').update(data).digest('hex');
const original = fs.readFileSync(path.join(root, 'package-lock.json'));
const base = JSON.parse(original);
const currentWeb = JSON.parse(fs.readFileSync(path.join(root, 'apps/web/package.json'), 'utf8'));
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'ati-adr002-'));

const proposedAdditions = {
  dependencies: {
    '@tanstack/react-query': '5.103.1',
    'radix-ui': '1.6.7',
    'lucide-react': '1.47.0',
    clsx: '2.1.1',
    'tailwind-merge': '3.7.0',
    'class-variance-authority': '0.7.1',
  },
  devDependencies: {
    tailwindcss: '4.3.3',
    '@tailwindcss/vite': '4.3.3',
    '@vitejs/plugin-react': '6.1.1',
    '@axe-core/playwright': '4.13.0',
  },
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
  const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', timeout: 300000, windowsHide: true });
  commands.push({ cwd: path.relative(sandbox, cwd).split(path.sep).join('/') || '.', command: args[0] === npm ? ['npm', ...args.slice(1)] : ['node', path.basename(args[0]), ...args.slice(1)], exit: result.status, ms: Date.now() - started });
  if (result.status !== 0 && !args.includes('audit')) throw new Error((result.stderr || result.stdout || String(result.error)).slice(-2000));
  return result.stdout;
}
const packageEntries = lock => Object.entries(lock.packages).filter(([p]) => p.includes('node_modules/'));
const identities = lock => new Set(packageEntries(lock).map(([p, v]) => `${p.split('node_modules/').at(-1)}@${v.version}`));

const sampleCommon = `import { RunDetailSchema } from './contracts';
export const labels = ['Đăng nhập','Tổng quan','Tạo yêu cầu','Lần chạy','Chi tiết lần chạy','Công cụ & kết nối'];
const sample = { run_id:'demo', status:'planning', workflow_version_id:null, plan:null, planner_result:null, approval:null, time_zone:'Asia/Ho_Chi_Minh', runtime:{}, last_seq:0 };
export const status = RunDetailSchema.parse(sample).status;
`;

const samples = {
  current: {
    'main.tsx': `import { createRoot } from 'react-dom/client';
import { labels, status } from './common';
import './styles.css';
function App() { return <main>{labels.map(l => <p key={l}>{l} {status}</p>)}<button type="button">Duyệt</button></main>; }
createRoot(document.getElementById('app')!).render(<App />);
`,
    'styles.css': 'main{font-family:system-ui;padding:16px}button{padding:8px 12px}\n',
    'vite.config.ts': `import { defineConfig } from 'vite';\nexport default defineConfig({});\n`,
  },
  proposed: {
    'main.tsx': `import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { Dialog, Tabs } from 'radix-ui';
import { CircleAlert, Check } from 'lucide-react';
import { cva } from 'class-variance-authority';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { labels, status } from './common';
import './styles.css';
const cn = (...v: Parameters<typeof clsx>) => twMerge(clsx(v));
const button = cva('inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium', { variants: { tone: { primary: 'bg-primary text-primary-fg', danger: 'bg-danger text-white' } }, defaultVariants: { tone: 'primary' } });
const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
function Poll() {
  const q = useQuery({ queryKey: ['run'], queryFn: async ({ signal }) => { signal.throwIfAborted(); return status; }, refetchInterval: 2000 });
  return <span className="text-muted">{q.data}</span>;
}
function App() {
  return <main className="p-4 font-sans">
    <Tabs.Root defaultValue="plan"><Tabs.List aria-label="Lần chạy">{labels.slice(0,3).map(l => <Tabs.Trigger key={l} value={l === labels[0] ? 'plan' : l}>{l}</Tabs.Trigger>)}</Tabs.List>
      <Tabs.Content value="plan"><Poll /></Tabs.Content></Tabs.Root>
    <Dialog.Root><Dialog.Trigger className={cn(button(), 'mt-4')}><Check aria-hidden />Duyệt</Dialog.Trigger>
      <Dialog.Portal><Dialog.Overlay className="fixed inset-0 bg-black/40" /><Dialog.Content className="fixed rounded-lg bg-surface p-6">
        <Dialog.Title>Xác nhận</Dialog.Title><Dialog.Description><CircleAlert aria-hidden />Ghi dữ liệu</Dialog.Description>
        <Dialog.Close className={button({ tone: 'danger' })}>Đóng</Dialog.Close></Dialog.Content></Dialog.Portal></Dialog.Root>
  </main>;
}
createRoot(document.getElementById('app')!).render(<QueryClientProvider client={client}><App /></QueryClientProvider>);
`,
    'styles.css': `@import "tailwindcss";
@theme { --color-primary: #1f4e8c; --color-primary-fg: #ffffff; --color-danger: #a32d2d; --color-surface: #ffffff; --color-muted: #5f5e5a; }
`,
    'vite.config.ts': `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({ plugins: [react(), tailwindcss()] });
`,
  },
};

const results = {};
const before = identities(base);
for (const name of ['current', 'proposed']) {
  const cwd = path.join(sandbox, name);
  for (const file of manifests) {
    fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
    fs.copyFileSync(path.join(root, file), path.join(cwd, file));
  }
  fs.writeFileSync(path.join(cwd, 'package-lock.json'), original);
  if (name === 'proposed') {
    const web = structuredClone(currentWeb);
    web.dependencies = { ...web.dependencies, ...proposedAdditions.dependencies };
    web.devDependencies = { ...web.devDependencies, ...proposedAdditions.devDependencies };
    fs.writeFileSync(path.join(cwd, 'apps/web/package.json'), JSON.stringify(web, null, 2));
  }
  run(cwd, [npm, 'install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund']);
  const lock = JSON.parse(fs.readFileSync(path.join(cwd, 'package-lock.json')));
  const after = identities(lock);
  results[name] = {
    entries: packageEntries(lock).length,
    deltaEntries: packageEntries(lock).length - packageEntries(base).length,
    added: [...after].filter(x => !before.has(x)).sort(),
    removed: [...before].filter(x => !after.has(x)).sort(),
  };
  run(cwd, [npm, 'ci', '--ignore-scripts', '--no-audit', '--no-fund']);
  const auditOut = run(cwd, [npm, 'audit', '--json']);
  try { results[name].audit = JSON.parse(auditOut).metadata?.vulnerabilities; } catch { results[name].audit = 'UNPARSEABLE'; }

  const probe = path.join(cwd, 'probe');
  fs.mkdirSync(probe, { recursive: true });
  for (const file of ['contracts.ts', 'events.ts', 'schema.ts']) {
    fs.copyFileSync(path.join(root, 'packages/dsl/src', file), path.join(probe, file));
  }
  fs.writeFileSync(path.join(probe, 'index.html'), '<!doctype html><html><body><div id="app"></div><script type="module" src="/main.tsx"></script></body></html>');
  fs.writeFileSync(path.join(probe, 'common.ts'), sampleCommon);
  for (const [file, text] of Object.entries(samples[name])) fs.writeFileSync(path.join(probe, file), text);
  const viteEntry = [path.join(cwd, 'apps/web/node_modules/vite/bin/vite.js'), path.join(cwd, 'node_modules/vite/bin/vite.js')].find(p => fs.existsSync(p));
  // Resolve bare imports from the web workspace install.
  fs.cpSync(probe, path.join(cwd, 'apps/web/probe'), { recursive: true });
  const webProbe = path.join(cwd, 'apps/web/probe');
  run(webProbe, [viteEntry, 'build']);
  const assetsDir = path.join(webProbe, 'dist/assets');
  results[name].assets = fs.readdirSync(assetsDir).filter(x => /\.(js|css)$/.test(x)).map(file => {
    const bytes = fs.readFileSync(path.join(assetsDir, file));
    return { file, bytes: bytes.length, gzipBytes: gzipSync(bytes).length, sha256: hash(bytes) };
  });
  console.log(`${name}: ${results[name].entries} lock entries; build passed`);
}

if (hash(fs.readFileSync(path.join(root, 'package-lock.json'))) !== hash(original)) throw new Error('Working lockfile changed');
const report = {
  capturedAt: new Date().toISOString(),
  node: process.version,
  probeScriptSha256: hash(fs.readFileSync(new URL(import.meta.url))),
  baselineLockSha256: hash(original),
  baselineEntries: packageEntries(base).length,
  proposedAdditions,
  results,
  commands,
  sandbox,
  limitations: [
    'Samples are not the six-view application; current renders labels only, proposed exercises Dialog, Tabs, a polling query, icons, cva and Tailwind theme tokens.',
    'No browser behaviour, accessibility, focus, polling correctness or developer-time measurement.',
    'Lock entries include optional platform variants; not the installed Windows package count.',
    'npm audit reflects the advisory database at capture time only.',
    'Temporary installations retained for inspection; no recursive deletion.',
  ],
};
fs.writeFileSync(path.join(root, 'docs/web-evidence/ADR-002/measurement.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(results).map(([k, v]) => [k, { entries: v.entries, delta: v.deltaEntries, added: v.added.length, removed: v.removed.length, audit: v.audit, assets: v.assets.map(a => [a.file, a.bytes, a.gzipBytes]) }])), null, 2));
