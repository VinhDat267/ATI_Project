import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { assertBrowserV3Environment } from './v3-local-env.mjs';
import { startGoogleFixture } from './google-oidc-fixture.mjs';
import { startGmailBrowserFixture } from './gmail-browser-fixture.mjs';
import { startSlackOAuthFixture } from './slack-oauth-fixture.mjs';

assertBrowserV3Environment(process.env);
if (!process.env.DATABASE_URL || !process.env.CHAT_ADMIN_EMAIL || !process.env.CHAT_ADMIN_PASSWORD) {
  throw new Error('Browser E2E requires DATABASE_URL and provisioned CHAT_ADMIN_* credentials');
}

const cli = resolve('node_modules/playwright/cli.js');
const scenarios = [
  {name:'slack_assistant',grep:'SLACK-M4:'},
  {name:'slack_write',grep:'SLACK-M3:'},
  { name: 'slack_read', grep: 'SLACK-M2:' },
  { name: 'slack_oauth', grep: 'SLACK-02:' },
  { name: 'default', grep: 'login, chat, approval and execution|cancel a pending plan|edit a pending plan|AUTH-01:|AUTH-03:|FE-02:|FE-03:|FE-03b:|FE-04:|FE-04b:|FE-05:|FE-06A:|FE-06B:|FE-07:|FE-08:|FE-09:|FE-10:|FE-11:|FE-12:|AUTH-05:|GMAIL-03 off:|MYCALENDAR off:|MYSHEETS off:|W4-04:|SCHED-03 off:' },
  { name: 'auth02', grep: 'AUTH-02:' },
  { name: 'auth04', grep: 'AUTH-04:|AUTH-05 Google:' },
  { name: 'clarification', grep: 'clarification before plan|W4-04 clarification' },
  { name: 'partial_failure', grep: 'partial failure and skip' },
  { name: 'three_service', grep: 'three-service workflow resolves prior outputs' },
  { name: 'sheets_slack', grep: 'approved Sheets workflow carries updatedRange to Slack' },
  { name: 'calendar_slack', grep: 'approved Calendar workflow carries event url and start to Slack' },
  { name: 'notion_slack', grep: 'approved Notion workflow carries page url to Slack' },
  { name: 'telegram_slack', grep: 'approved Telegram workflow carries messageId to Slack' },
  { name: 'jira_slack', grep: 'approved Jira workflow carries key and url to Slack' },
  { name: 'answer', grep: 'ANS-01:' },
  { name: 'gmail', grep: 'GMAIL-03:|OAUTH-01 from chat:' },
  { name: 'mycalendar', grep: 'MYCALENDAR:' },
  { name: 'mysheets', grep: 'MYSHEETS:' },
  { name: 'schedule', grep: 'SCHED-03:' },
];

const selectedScenario = process.env.SCENARIO;
const runScenarios = selectedScenario ? scenarios.filter(s => s.name === selectedScenario) : scenarios;

for (const scenario of runScenarios) {
  process.stdout.write(`Running v3 browser scenario: ${scenario.name}\n`);
  // The API child and native HTTP fixtures must verify the same browser bearer.
  // Generate a shared private key before spawning when no key was supplied.
  const env = { ...process.env, JWT_SECRET: process.env.JWT_SECRET || randomBytes(32).toString('hex') };
  if (['default', 'auth02', 'auth04'].includes(scenario.name)) delete env.SANDBOX_SCENARIO;
  else env.SANDBOX_SCENARIO = scenario.name;
  // Keep every existing group on the old read-only policy regardless of the invoking shell.
  env.PLANNER_READ_ANSWERS = scenario.name === 'answer' ? 'on' : 'off';
  env.GMAIL_ENABLED = scenario.name === 'gmail' ? 'on' : 'off';
  env.MYCALENDAR_ENABLED = scenario.name === 'mycalendar' ? 'on' : 'off';
  env.MYSHEETS_ENABLED = scenario.name === 'mysheets' ? 'on' : 'off';
  env.SCHEDULES_ENABLED = scenario.name === 'schedule' ? 'on' : 'off';
  env.MYSLACK_ENABLED = ['slack_oauth','slack_read','slack_write','slack_assistant'].includes(scenario.name) ? 'on' : 'off';
  env.MYSLACK_AUTOMATION_ENABLED='off';
  env.MYSLACK_WRITES_ENABLED=scenario.name==='slack_write'?'on':'off';
  if (scenario.name === 'answer') env.PLANNER_SEARCH_MODE = 'llm';
  if (scenario.name === 'auth02') env.AUTH_SIGNUP_ENABLED = 'true';
  let stopFixture;
  try {
    if (['slack_oauth','slack_read','slack_write','slack_assistant'].includes(scenario.name)) {
      if(['slack_oauth','slack_assistant'].includes(scenario.name))delete env.SANDBOX_SCENARIO;
      const redirectUri = `http://127.0.0.1:${env.V3_WEB_PORT || 5174}/connections/myslack/callback`;
      const fixture = await startSlackOAuthFixture({ redirectUri,readFixtures:scenario.name==='slack_read',writeFixtures:scenario.name==='slack_write' }); stopFixture = fixture.stop;
      Object.assign(env, { MYSLACK_APP_ID: 'A_FIXTURE', MYSLACK_OAUTH_CLIENT_ID: 'slack-fixture-client', MYSLACK_OAUTH_CLIENT_SECRET: 'slack-fixture-secret', MYSLACK_OAUTH_REDIRECT_URI: redirectUri,
        MYSLACK_OAUTH_AUTH_URL: fixture.origin + '/authorize', MYSLACK_API_BASE_URL: fixture.origin + '/api' });
      if(['slack_read','slack_write'].includes(scenario.name))Object.assign(env,{LLM_PROVIDER:'gemini',GEMINI_MODEL:'gemini-2.5-flash',RUNTIME_ACCOUNT_ID:'SLACK_M2_BROWSER',SLACK_SIGNING_SECRET:'fixture-slack-signing-secret-m2'});
    }
    if (scenario.name === 'gmail') {
      const redirectUri = `http://127.0.0.1:${env.V3_WEB_PORT || 5174}/connections/gmail/callback`;
      const fixture = await startGmailBrowserFixture({ redirectUri }); stopFixture = fixture.stop;
      Object.assign(env, {
        GMAIL_OAUTH_CLIENT_ID: 'gmail-test.apps.googleusercontent.com', GMAIL_OAUTH_CLIENT_SECRET: 'fake-gmail-secret', GMAIL_OAUTH_REDIRECT_URI: redirectUri,
        GMAIL_OAUTH_AUTH_URL: `${fixture.origin}/o/oauth2/v2/auth`, GMAIL_OAUTH_TOKEN_URL: `${fixture.origin}/token`, GMAIL_OAUTH_REVOKE_URL: `${fixture.origin}/revoke`, GMAIL_API_BASE_URL: fixture.origin,
      });
    }
    if (scenario.name === 'mycalendar') {
      const redirectUri = `http://127.0.0.1:${env.V3_WEB_PORT || 5174}/connections/mycalendar/callback`;
      const fixture = await startGmailBrowserFixture({ redirectUri }); stopFixture = fixture.stop;
      Object.assign(env, {
        MYCALENDAR_OAUTH_CLIENT_ID: 'mycalendar-test.apps.googleusercontent.com', MYCALENDAR_OAUTH_CLIENT_SECRET: 'fake-mycalendar-secret', MYCALENDAR_OAUTH_REDIRECT_URI: redirectUri,
        MYCALENDAR_OAUTH_AUTH_URL: `${fixture.origin}/o/oauth2/v2/auth`, MYCALENDAR_OAUTH_TOKEN_URL: `${fixture.origin}/token`, MYCALENDAR_OAUTH_REVOKE_URL: `${fixture.origin}/revoke`, MYCALENDAR_API_BASE_URL: fixture.origin,
      });
    }
    if (scenario.name === 'mysheets') {
      const redirectUri = `http://127.0.0.1:${env.V3_WEB_PORT || 5174}/connections/mysheets/callback`;
      const fixture = await startGmailBrowserFixture({ redirectUri }); stopFixture = fixture.stop;
      Object.assign(env, {
        MYSHEETS_OAUTH_CLIENT_ID: 'mysheets-test.apps.googleusercontent.com', MYSHEETS_OAUTH_CLIENT_SECRET: 'fake-mysheets-secret', MYSHEETS_OAUTH_REDIRECT_URI: redirectUri,
        MYSHEETS_OAUTH_AUTH_URL: `${fixture.origin}/o/oauth2/v2/auth`, MYSHEETS_OAUTH_TOKEN_URL: `${fixture.origin}/token`, MYSHEETS_OAUTH_REVOKE_URL: `${fixture.origin}/revoke`, MYSHEETS_API_BASE_URL: fixture.origin,
      });
    }
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
    const grepPattern = process.env.GREP ?? scenario.grep;
    const result = spawnSync(process.execPath, [cli, 'test', '--config', 'apps/chat-web/playwright.config.ts', '--grep', grepPattern], {
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
