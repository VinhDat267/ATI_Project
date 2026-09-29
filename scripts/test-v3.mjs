import { spawnSync } from 'node:child_process';

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run v3 tests through npm so npm_execpath is available');

const workspaces = [
  '@wap/tool-schemas',
  '@wap/tool-adapters',
  '@wap/planner',
  '@wap/executor',
  '@wap/chat-api',
  '@wap/chat-web',
];
const result = spawnSync(
  process.execPath,
  [npmCli, 'test', ...workspaces.flatMap((name) => ['-w', name])],
  { stdio: 'inherit', env: process.env },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
