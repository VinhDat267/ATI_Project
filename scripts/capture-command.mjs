import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const [task, label, executable, ...args] = process.argv.slice(2);
if (!/^FS-0[1-6]$/.test(task ?? '') || !/^[a-z0-9-]+$/.test(label ?? '') || !executable)
  throw Error('Usage: capture-command.mjs FS-01 label executable args...');

const dir = path.resolve(
  'docs/task-hub-evidence/batch-02',
  task,
  `${Date.now()}-${label}`
);
mkdirSync(path.dirname(dir), { recursive: true });
mkdirSync(dir, { recursive: false }); // never reuse an existing run directory

const started_at = new Date().toISOString();
const result = spawnSync(executable, args, {
  cwd: process.cwd(),
  encoding: 'utf8',
  windowsHide: true,
  env: { ...process.env, ATI_EVIDENCE_DIR: dir },
  maxBuffer: 32 * 1024 * 1024,
});
const finished_at = new Date().toISOString();

writeFileSync(
  path.join(dir, 'output.log'),
  (result.stdout ?? '') + (result.stderr ?? ''),
  { flag: 'wx' }
);
writeFileSync(
  path.join(dir, 'command.json'),
  JSON.stringify(
    {
      executable,
      args,
      started_at,
      finished_at,
      exit_code: result.status,
      signal: result.signal,
      spawn_error: result.error?.message ?? null,
      evidence_dir: dir,
      scope: label,
    },
    null,
    2
  ) + '\n',
  { flag: 'wx' }
);

console.log(
  JSON.stringify({ dir, exit_code: result.status, signal: result.signal })
);
process.exitCode = result.error ? 1 : result.status ?? 1;
