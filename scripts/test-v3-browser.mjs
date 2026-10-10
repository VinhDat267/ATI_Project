import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { assertBrowserV3Environment } from './v3-local-env.mjs';
import { startGoogleFixture } from './google-oidc-fixture.mjs';

assertBrowserV3Environment(process.env);
if (!process.env.DATABASE_URL || !process.env.CHAT_ADMIN_EMAIL || !process.env.CHAT_ADMIN_PASSWORD) {
  throw new Error('Browser E2E requires DATABASE_URL and provisioned CHAT_ADMIN_* credentials');
}

const cli = resolve('node_modules/playwright/cli.js');
const scenarios = [
  { name: 'default', grep: 'login, chat, approval and execution|cancel a pending plan|edit a pending plan|AUTH-01:|AUTH-03:|FE-02:|FE-03:|FE-03b:|FE-04:|FE-04b:|FE-05:|FE-06A:|FE-06B:|FE-07:|FE-08:|FE-09:|FE-10:|AUTH-05:' },
  { name: 'auth02', grep: 'AUTH-02:' },
  { name: 'auth04', grep: 'AUTH-04:|AUTH-05 Google:' },
  { name: 'clarification', grep: 'clarification before plan' },
  { name: 'partial_failure', grep: 'partial failure and skip' },
  { name: 'three_service', grep: 'three-service workflow resolves prior outputs' },
  { name: 'sheets_slack', grep: 'approved Sheets workflow carries updatedRange to Slack' },
  { name: 'calendar_slack', grep: 'approved Calendar workflow carries event url and start to Slack' },
  { name: 'notion_slack', grep: 'approved Notion workflow carries page url to Slack' },
  { name: 'telegram_slack', grep: 'approved Telegram workflow carries messageId to Slack' },
  { name: 'jira_slack', grep: 'approved Jira workflow carries key and url to Slack' },
];

for (const scenario of scenarios) {
  process.stdout.write(`Running v3 browser scenario: ${scenario.name}\n`);
  // The API child and native HTTP fixtures must verify the same browser bearer.
  // Generate a shared private key before spawning when no key was supplied.
  const env = { ...process.env, JWT_SECRET: process.env.JWT_SECRET || randomBytes(32).toString('hex') };
  if (['default', 'auth02', 'auth04'].includes(scenario.name)) delete env.SANDBOX_SCENARIO;
  else env.SANDBOX_SCENARIO = scenario.name;
  if (scenario.name === 'auth02') env.AUTH_SIGNUP_ENABLED = 'true';
  let stopFixture;
  try {
    if (scenario.name === 'auth04') {
      const redirectUri = `http://127.0.0.1:${env.V3_WEB_PORT || 5174}/auth/google/callback`;
      const fixture = await startGoogleFixture({ redirectUri });
      stopFixture = fixture.stop;
      Object.assign(env, {
        AUTH_SIGNUP_ENABLED: 'true', GOOGLE_OAUTH_CLIENT_ID: 'auth04-test.apps.googleusercontent.com',
        GOOGLE_OAUTH_CLIENT_SECRET: 'fake-oidc-secret',
        GOOGLE_OAUTH_REDIRECT_URI: redirectUri,
        GOOGLE_OAUTH_AUTH_URL: `${fixture.origin}/authorize`,
        GOOGLE_OAUTH_TOKEN_URL: `${fixture.origin}/token`,
        GOOGLE_OAUTH_JWKS_URL: `${fixture.origin}/jwks`,
      });
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
