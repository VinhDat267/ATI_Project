import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { assertBrowserV3Environment } from './v3-local-env.mjs';

assertBrowserV3Environment(process.env);
if (!process.env.DATABASE_URL || !process.env.CHAT_ADMIN_EMAIL || !process.env.CHAT_ADMIN_PASSWORD) {
  throw new Error('Browser E2E requires DATABASE_URL and provisioned CHAT_ADMIN_* credentials');
}

const cli = resolve('node_modules/playwright/cli.js');
const scenarios = [
  { name: 'default', grep: 'login, chat, approval and execution|cancel a pending plan|edit a pending plan|AUTH-01:|AUTH-03:|FE-02:|FE-03:|FE-03b:|AUTH-05:' },
  { name: 'auth02', grep: 'AUTH-02:' },
  { name: 'auth04', grep: 'AUTH-04:' },
  { name: 'clarification', grep: 'clarification before plan' },
  { name: 'partial_failure', grep: 'partial failure and skip' },
  { name: 'three_service', grep: 'three-service workflow resolves prior outputs' },
  { name: 'sheets_slack', grep: 'approved Sheets workflow carries updatedRange to Slack' },
  { name: 'calendar_slack', grep: 'approved Calendar workflow carries event url and start to Slack' },
  { name: 'notion_slack', grep: 'approved Notion workflow carries page url to Slack' },
  { name: 'telegram_slack', grep: 'approved Telegram workflow carries messageId to Slack' },
  { name: 'jira_slack', grep: 'approved Jira workflow carries key and url to Slack' },
];

async function startGoogleFixture() {
  const child = spawn(process.execPath, [resolve('scripts/fake-oidc.mjs')], {
    env: { ...process.env, FAKE_OIDC_PORT: '55534' }, stdio: ['ignore', 'pipe', 'inherit'],
  });
  const stopped = new Promise(resolve => child.once('close', resolve));
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Local OIDC fixture readiness timeout')), 10_000);
      let output = '';
      const fail = () => { clearTimeout(timer); reject(new Error('Local OIDC fixture stopped before readiness')); };
      child.once('error', fail);
      child.once('exit', fail);
      child.stdout.on('data', chunk => {
        output += chunk.toString();
        if (output.length > 4096) { clearTimeout(timer); return reject(new Error('Invalid local OIDC readiness output')); }
        const newline = output.indexOf('\n');
        if (newline < 0) return;
        try {
          const ready = JSON.parse(output.slice(0, newline));
          if (ready.status !== 'ready' || ready.port !== 55534) throw new Error('Invalid local OIDC readiness');
          clearTimeout(timer);
          child.removeListener('error', fail);
          child.removeListener('exit', fail);
          resolve();
        } catch (error) { clearTimeout(timer); reject(error); }
      });
    });
  } catch (error) {
    child.kill();
    await stopped;
    throw error;
  }
  return async () => { child.kill(); await stopped; };
}

for (const scenario of scenarios) {
  process.stdout.write(`Running v3 browser scenario: ${scenario.name}\n`);
  const env = { ...process.env };
  if (['default', 'auth02', 'auth04'].includes(scenario.name)) delete env.SANDBOX_SCENARIO;
  else env.SANDBOX_SCENARIO = scenario.name;
  if (scenario.name === 'auth02') env.AUTH_SIGNUP_ENABLED = 'true';
  let stopFixture;
  try {
    if (scenario.name === 'auth04') {
      Object.assign(env, {
        AUTH_SIGNUP_ENABLED: 'true', GOOGLE_OAUTH_CLIENT_ID: 'auth04-test.apps.googleusercontent.com',
        GOOGLE_OAUTH_CLIENT_SECRET: 'fake-oidc-secret',
        GOOGLE_OAUTH_REDIRECT_URI: 'http://127.0.0.1:5174/auth/google/callback',
        GOOGLE_OAUTH_AUTH_URL: 'http://127.0.0.1:55534/authorize',
        GOOGLE_OAUTH_TOKEN_URL: 'http://127.0.0.1:55534/token',
        GOOGLE_OAUTH_JWKS_URL: 'http://127.0.0.1:55534/jwks',
      });
      stopFixture = await startGoogleFixture();
    }
    const result = spawnSync(process.execPath, [cli, 'test', '--config', 'apps/chat-web/playwright.config.ts', '--grep', scenario.grep], {
      env, stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1;
      break;
    }
  } finally {
    await stopFixture?.();
  }
}
