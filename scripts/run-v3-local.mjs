import { spawnSync } from 'node:child_process';
import { assertLocalV3Environment } from './v3-local-env.mjs';

assertLocalV3Environment(process.env);

const command = process.argv[2];
switch (command) {
  case 'migrate':
    await import('../db/v3/migrate.mjs');
    break;
  case 'provision':
    await import('../apps/chat-api/src/cli/provision-user.ts');
    break;
  case 'check': {
    const npmCli = process.env.npm_execpath;
    if (!npmCli) throw new Error('Run local v3 commands through npm');
    const result = spawnSync(process.execPath, [npmCli, 'run', 'check'], { stdio: 'inherit', env: process.env });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
    break;
  }
  case 'up':
    await import('./start-v3.mjs');
    break;
  default:
    throw new Error('Expected one of: migrate, provision, check, up');
}
