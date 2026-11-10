import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = resolve('node_modules/playwright/cli.js');

/**
 * Explicit routing classification for the four previously omitted Trello/Telegram
 * browser scenarios (TRELLO-AUDIT-13 / AUTO-09). Never claim native E2E for cases
 * that intercept API routes via Playwright page.route.
 */
export const OMITTED_SCENARIO_ROUTING = Object.freeze({
  'TRELLO:': {
    titlePrefix: 'TRELLO:',
    specFile: 'apps/chat-web/tests/browser/trello-oauth.spec.ts',
    executionMode: 'mocked_browser_routes',
    requiresSchedulesEnabled: true,
  },
  'TRELLO-E2E:': {
    titlePrefix: 'TRELLO-E2E:',
    specFile: 'apps/chat-web/tests/browser/trello-oauth.spec.ts',
    executionMode: 'real_backend_sandbox',
    requiresSchedulesEnabled: true,
  },
  'TELEGRAM-E2E-1:': {
    titlePrefix: 'TELEGRAM-E2E-1:',
    specFile: 'apps/chat-web/tests/browser/telegram-oauth-and-digest.spec.ts',
    executionMode: 'mocked_browser_routes',
    requiresSchedulesEnabled: true,
  },
  'TELEGRAM-E2E-2:': {
    titlePrefix: 'TELEGRAM-E2E-2:',
    specFile: 'apps/chat-web/tests/browser/telegram-oauth-and-digest.spec.ts',
    executionMode: 'real_backend_sandbox',
    requiresSchedulesEnabled: true,
  },
});

export const scenarios = [
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
  { name: 'four_service', grep: 'approved four-service workflow resolves prior outputs' },
  { name: 'nine_service', grep: 'approved nine-service workflow resolves prior outputs across all 9 services' },
  { name: 'sheets_slack', grep: 'approved Sheets workflow carries updatedRange to Slack' },
  { name: 'calendar_slack', grep: 'approved Calendar workflow carries event url and start to Slack' },
  { name: 'notion_slack', grep: 'approved Notion workflow carries page url to Slack' },
  { name: 'telegram_slack', grep: 'approved Telegram workflow carries messageId to Slack' },
  { name: 'jira_slack', grep: 'approved Jira workflow carries key and url to Slack' },
  { name: 'answer', grep: 'ANS-01:' },
  { name: 'gmail', grep: 'GMAIL-03:|OAUTH-01 from chat:' },
  { name: 'mycalendar', grep: 'MYCALENDAR:' },
  { name: 'mysheets', grep: 'MYSHEETS:' },
  { name: 'schedule', grep: 'SCHED-03:|GITHUB-DIGEST:' },
  {
    name: 'trello_telegram_mocked_ui',
    sandboxScenario: 'schedule',
    schedulesEnabled: true,
    grep: 'TRELLO:|TELEGRAM-E2E-1:',
    executionMode: 'mocked_browser_routes',
  },
  {
    name: 'trello_telegram_sandbox_e2e',
    sandboxScenario: 'schedule',
    schedulesEnabled: true,
    grep: 'TRELLO-E2E:|TELEGRAM-E2E-2:',
    executionMode: 'real_backend_sandbox',
  },
];

export function resolveActiveScenarios(passArgs = process.argv.slice(2), envVars = process.env) {
  if (passArgs.length > 0) {
    const needsSchedule = passArgs.some((arg) =>
      /sched-03|github-oauth-and-digest|telegram-oauth-and-digest|trello-oauth|TRELLO:|TRELLO-E2E:|TELEGRAM-E2E-1:|TELEGRAM-E2E-2:/.test(
        arg
      )
    );
    return [
      {
        name: needsSchedule ? 'schedule' : 'default',
        sandboxScenario: needsSchedule ? (envVars.SANDBOX_SCENARIO || 'schedule') : undefined,
        schedulesEnabled: needsSchedule ? true : envVars.SCHEDULES_ENABLED === 'on',
        passArgs,
      },
    ];
  }
  const selectedScenario = envVars.SCENARIO;
  return selectedScenario ? scenarios.filter((s) => s.name === selectedScenario) : scenarios;
}

const isMainModule =
  Boolean(process.argv[1]) &&
  typeof import.meta.url === 'string' &&
  import.meta.url.startsWith('file:') &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  const { assertBrowserV3Environment } = await import('./v3-local-env.mjs');
  const { startGoogleFixture } = await import('./google-oidc-fixture.mjs');
  const { startGmailBrowserFixture } = await import('./gmail-browser-fixture.mjs');
  const { startSlackOAuthFixture } = await import('./slack-oauth-fixture.mjs');
  const { startGitHubOAuthFixture } = await import('./github-oauth-fixture.mjs');

  assertBrowserV3Environment(process.env);
  if (!process.env.DATABASE_URL || !process.env.CHAT_ADMIN_EMAIL || !process.env.CHAT_ADMIN_PASSWORD) {
    throw new Error('Browser E2E requires DATABASE_URL and provisioned CHAT_ADMIN_* credentials');
  }

  const passArgs = process.argv.slice(2);
  if (passArgs.length > 0) {
    process.stdout.write(`Running v3 browser targeting: ${passArgs.join(' ')}\n`);
    const env = { ...process.env, JWT_SECRET: process.env.JWT_SECRET || randomBytes(32).toString('hex') };
    if (passArgs.some(arg => /sched-03|github-oauth-and-digest|telegram-oauth-and-digest|trello-oauth|TRELLO:|TRELLO-E2E:|TELEGRAM-E2E-1:|TELEGRAM-E2E-2:/.test(arg))) {
      env.SANDBOX_SCENARIO = env.SANDBOX_SCENARIO || 'schedule';
      env.SCHEDULES_ENABLED = env.SCHEDULES_ENABLED || 'on';
    }
    let stopPassFixture;
    try {
      if (passArgs.some(arg => /github-oauth-and-digest/.test(arg))) {
        const redirectUri = `http://127.0.0.1:${env.V3_WEB_PORT || 5174}/connections/github/callback`;
        const fixture = await startGitHubOAuthFixture({ redirectUri });
        stopPassFixture = fixture.stop;
        Object.assign(env, {
          GITHUB_OAUTH_CLIENT_ID: 'github-fixture-client',
          GITHUB_OAUTH_CLIENT_SECRET: 'github-fixture-secret',
          GITHUB_OAUTH_REDIRECT_URI: redirectUri,
          GITHUB_OAUTH_AUTH_URL: `${fixture.origin}/authorize`,
          GITHUB_OAUTH_TOKEN_URL: `${fixture.origin}/token`,
          GITHUB_API_BASE_URL: fixture.origin,
        });
      }
      const result = spawnSync(process.execPath, [cli, 'test', '--config', 'apps/chat-web/playwright.config.ts', ...passArgs], {
        env, stdio: 'inherit',
      });
      if (result.error) throw result.error;
      process.exitCode = result.status ?? 0;
    } finally {
      await stopPassFixture?.();
    }
    process.exit(process.exitCode ?? 0);
  }

  const runScenarios = resolveActiveScenarios([], process.env);

  for (const scenario of runScenarios) {
    process.stdout.write(`Running v3 browser scenario: ${scenario.name}\n`);
    // The API child and native HTTP fixtures must verify the same browser bearer.
    // Generate a shared private key before spawning when no key was supplied.
    const env = { ...process.env, JWT_SECRET: process.env.JWT_SECRET || randomBytes(32).toString('hex') };
    if (['default', 'auth02', 'auth04'].includes(scenario.name)) delete env.SANDBOX_SCENARIO;
    else env.SANDBOX_SCENARIO = scenario.sandboxScenario ?? scenario.name;
    // Keep every existing group on the old read-only policy regardless of the invoking shell.
    env.PLANNER_READ_ANSWERS = scenario.name === 'answer' ? 'on' : 'off';
    env.GMAIL_ENABLED = scenario.name === 'gmail' ? 'on' : 'off';
    env.MYCALENDAR_ENABLED = scenario.name === 'mycalendar' ? 'on' : 'off';
    env.MYSHEETS_ENABLED = scenario.name === 'mysheets' ? 'on' : 'off';
    env.SCHEDULES_ENABLED = (scenario.name === 'schedule' || scenario.schedulesEnabled) ? 'on' : 'off';
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
        const fixture = await startSlackOAuthFixture({ redirectUri,readFixtures:['slack_read','slack_assistant'].includes(scenario.name),writeFixtures:scenario.name==='slack_write' }); stopFixture = fixture.stop;
        Object.assign(env, { MYSLACK_APP_ID: 'A_FIXTURE', MYSLACK_OAUTH_CLIENT_ID: 'slack-fixture-client', MYSLACK_OAUTH_CLIENT_SECRET: 'slack-fixture-secret', MYSLACK_OAUTH_REDIRECT_URI: redirectUri,
          MYSLACK_OAUTH_AUTH_URL: fixture.origin + '/authorize', MYSLACK_API_BASE_URL: fixture.origin + '/api' });
        if(['slack_read','slack_write','slack_assistant'].includes(scenario.name))Object.assign(env,{LLM_PROVIDER:'gemini',GEMINI_MODEL:'gemini-2.5-flash',RUNTIME_ACCOUNT_ID:'SLACK_M2_BROWSER',SLACK_SIGNING_SECRET:'fixture-slack-signing-secret-m2'});
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
      if (scenario.name === 'schedule') {
        const redirectUri = `http://127.0.0.1:${env.V3_WEB_PORT || 5174}/connections/github/callback`;
        const fixture = await startGitHubOAuthFixture({ redirectUri });
        stopFixture = fixture.stop;
        Object.assign(env, {
          GITHUB_OAUTH_CLIENT_ID: 'github-fixture-client',
          GITHUB_OAUTH_CLIENT_SECRET: 'github-fixture-secret',
          GITHUB_OAUTH_REDIRECT_URI: redirectUri,
          GITHUB_OAUTH_AUTH_URL: `${fixture.origin}/authorize`,
          GITHUB_OAUTH_TOKEN_URL: `${fixture.origin}/token`,
          GITHUB_API_BASE_URL: fixture.origin,
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
}
