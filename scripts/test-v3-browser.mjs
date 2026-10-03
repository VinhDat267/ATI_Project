import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { assertBrowserV3Environment } from './v3-local-env.mjs';

assertBrowserV3Environment(process.env);
if (!process.env.DATABASE_URL || !process.env.CHAT_ADMIN_EMAIL || !process.env.CHAT_ADMIN_PASSWORD) {
  throw new Error('Browser E2E requires DATABASE_URL and provisioned CHAT_ADMIN_* credentials');
}

const cli = resolve('node_modules/playwright/cli.js');
const scenarios = [
  { name: 'default', grep: 'login, chat, approval and execution|cancel a pending plan|edit a pending plan' },
  { name: 'clarification', grep: 'clarification before plan' },
  { name: 'partial_failure', grep: 'partial failure and skip' },
  { name: 'three_service', grep: 'three-service workflow resolves prior outputs' },
  { name: 'sheets_slack', grep: 'approved Sheets workflow carries updatedRange to Slack' },
  { name: 'calendar_slack', grep: 'approved Calendar workflow carries event url and start to Slack' },
];

for (const scenario of scenarios) {
  process.stdout.write(`Running v3 browser scenario: ${scenario.name}\n`);
  const env = { ...process.env };
  if (scenario.name === 'default') delete env.SANDBOX_SCENARIO;
  else env.SANDBOX_SCENARIO = scenario.name;
  const result = spawnSync(process.execPath, [cli, 'test', '--config', 'apps/chat-web/playwright.config.ts', '--grep', scenario.grep], {
    env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}
