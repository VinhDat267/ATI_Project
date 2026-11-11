import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createIsolatedTestSchema, createSyntheticUser, type IsolatedTestContext } from '../helpers/jira-test-db.js';
import { ConversationRepo } from '../../src/db/repositories/conversation-repo.js';
import { SessionRepo } from '../../src/db/repositories/session-repo.js';
import { generateAccessToken } from '../../src/auth/jwt.js';

// Real server wiring, real PostgreSQL and HTTP model endpoint. No provider credentials.
let ctx: IsolatedTestContext;
let child: ChildProcess | undefined;
let llm: Server | undefined;
let baseUrl = '', token = '', workspaceId = '', convId = '';
let serverOutput = '';
const modelRequests: any[] = [];
const root = fileURLToPath(new URL('../../../../', import.meta.url));

async function listen(server: Server): Promise<number> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as { port: number }).port;
}

beforeAll(async () => {
  ctx = await createIsolatedTestSchema();
  await ctx.runAllMigrations();
  const userId = await createSyntheticUser(ctx.pool, 'G2A runtime', 'g2a_runtime');
  workspaceId = randomUUID();
  await ctx.pool.query(`INSERT INTO workspaces(id,name,invite_code,require_approval,created_by) VALUES ($1,'G2A runtime',$2,true,$3)`, [workspaceId, randomUUID(), userId]);
  await ctx.pool.query(`INSERT INTO workspace_members(workspace_id,user_id,role,status) VALUES ($1,$2,'admin','active')`, [workspaceId, userId]);
  await ctx.pool.query(`INSERT INTO ati_workspaces(id,slug,status,version,created_by) VALUES ($1,$2,'active',1,$3)`, [workspaceId, randomUUID(), userId]);
  await ctx.pool.query(`INSERT INTO ati_workspace_memberships(workspace_id,user_id,role,status,version) VALUES ($1,$2,'admin','active',1)`, [workspaceId, userId]);
  convId = (await new ConversationRepo(ctx.pool).createConversation(userId, 'G2A ordinary org', { workspaceMode: 'organization', workspaceId, jiraContext: false })).id;
  const session = await new SessionRepo(ctx.pool).create(userId, 'g2a-runtime-test');
  const jwtSecret = 'g2a-runtime-fixture-jwt-secret-at-least-32-bytes';
  token = generateAccessToken({ id: userId, name: 'G2A', email: 'g2a@example.test' }, jwtSecret, session.sessionId).accessToken;

  llm = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    modelRequests.push(JSON.parse(body));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ kind: 'refusal', reason: 'Fixture response', suggestion: 'Fixture' }) } }] }));
  });
  const llmPort = await listen(llm);
  const reservation = createServer();
  const apiPort = await listen(reservation);
  await new Promise<void>((resolve, reject) => reservation.close(err => err ? reject(err) : resolve()));
  const dbUrl = new URL(process.env.DATABASE_URL!);
  dbUrl.searchParams.set('options', `-c search_path=${ctx.schema}`);
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^(SMTP_|MAIL_FROM|APP_BASE_URL|AUTH_|TRELLO_|MYTRELLO_|SLACK_|MYSLACK_|GITHUB_|GOOGLE_|NOTION_|MYNOTION_|TELEGRAM_|JIRA_|MYJIRA_|GMAIL_|MYCALENDAR_|MYSHEETS_|LIVE_|LLM_|GEMINI_|DEEPSEEK_|SANDBOX_|CHAT_ADMIN_|SERVICE_ADMIN|SCHEDULES_)/.test(key)));
  child = spawn(process.execPath, ['--import', 'tsx', 'apps/chat-api/src/server.ts'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...inherited,
      RUNTIME_MODE: 'live', NODE_ENV: 'development', PORT: String(apiPort), DATABASE_URL: dbUrl.href,
      JWT_SECRET: jwtSecret, ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef',
      MYJIRA_ENABLED: 'on', JIRA_LLM_EGRESS_ENABLED: 'off', SANDBOX_SCENARIO: 'nine_service',
      JIRA_OAUTH_CLIENT_ID: 'fixture-client', JIRA_OAUTH_CLIENT_SECRET: 'fixture-secret',
      JIRA_OAUTH_REDIRECT_URI: 'http://localhost:5174/connections/myjira/callback',
      LLM_PROVIDER: 'openai-compatible', LLM_BASE_URL: `http://127.0.0.1:${llmPort}/v1`, LLM_MODEL: 'loopback-fixture',
      SCHEDULES_ENABLED: 'off',
    },
  });
  child.stdout!.on('data', chunk => { serverOutput += chunk; });
  child.stderr!.on('data', chunk => { serverOutput += chunk; });
  baseUrl = `http://127.0.0.1:${apiPort}`;
  await vi.waitFor(async () => {
    if (child?.exitCode !== null) throw new Error(`API exited: ${serverOutput}`);
    expect((await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(300) })).ok).toBe(true);
  }, { timeout: 20000 });
}, 30000);

afterAll(async () => {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
  }
  if (llm) { llm.closeAllConnections(); await new Promise<void>(resolve => llm!.close(() => resolve())); }
  await ctx?.cleanup();
});

it('P0-01 real server: implicit ticket is refused without LLM despite live sandbox variable; connection status remains usable', async () => {
  const send = async (content: string) => {
    const response = await fetch(`${baseUrl}/api/conversations/${convId}/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-workspace-id': workspaceId },
      body: JSON.stringify({ content }),
    });
    expect(response.status).toBe(202);
  };
  await send('Kiểm tra danh sách ticket đang mở trong ATI');
  await expect.poll(async () => {
    const rows = await ctx.pool.query('SELECT content FROM messages WHERE conv_id=$1 AND role=$2', [convId, 'assistant']);
    return rows.rows.some(row => row.content.includes('JIRA_LLM_EGRESS_DISABLED_IN_G2A'));
  }, { timeout: 5000 }).toBe(true);
  expect(modelRequests).toHaveLength(0);

  const connection = await fetch(`${baseUrl}/api/connections/myjira`, {
    headers: { authorization: `Bearer ${token}`, 'x-workspace-id': workspaceId },
  });
  expect(connection.status).toBe(200);
  expect(modelRequests).toHaveLength(0);
});
