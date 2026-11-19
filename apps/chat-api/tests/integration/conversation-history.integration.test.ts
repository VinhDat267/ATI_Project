import {applyV3Migrations} from '../helpers/gmail-test-db.js';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ConversationRepo } from '../../src/db/repositories/conversation-repo.js';
import { MessageRepo } from '../../src/db/repositories/message-repo.js';
import { PlanRepo } from '../../src/db/repositories/plan-repo.js';
import { StepRepo } from '../../src/db/repositories/step-repo.js';
import { createApp } from '../../src/app.js';
import { generateTokens } from '../../src/auth/jwt.js';
import { ExecutionService } from '../../src/services/execution-service.js';
import { ChatService } from '../../src/services/chat-service.js';
import { SSEManager } from '../../src/sse/sse-manager.js';
import { WorkspaceRepo } from '../../src/db/repositories/workspace-repo.js';
import { createIsolatedTestSchema, validateDatabaseUrl, type IsolatedTestContext } from '../helpers/jira-test-db.js';

let ctx: IsolatedTestContext;
let pool: pg.Pool;
let repo: ConversationRepo;
let messages: MessageRepo;
const migration = () => readFile(new URL('../../../../db/v3/0004_conversation_titles.sql', import.meta.url), 'utf8');
const secret = 'fe02_history_integration_jwt_secret';

async function user() {
  const id = randomUUID();
  await pool.query("INSERT INTO users(id,email,password,name,status) VALUES($1,$2,$3,$4,'active')", [id, `${id}@example.test`, 'test-only-hash', 'History test']);
  return id;
}
function bearer(id: string) { return `Bearer ${generateTokens({ id, email: `${id}@example.test`, name: 'History test' }, secret).accessToken}`; }

describe('FE-02 conversation history: real PostgreSQL and HTTP', () => {
  beforeAll(async () => {
    ctx = await createIsolatedTestSchema();
    await ctx.runAllMigrations();
    pool = ctx.pool;
    repo = new ConversationRepo(pool);
    messages = new MessageRepo(pool);
  });
  afterAll(async () => {
    await ctx?.cleanup();
  });

  it('backfills existing first-user titles once and preserves data on a second migration', async () => {
    const rawUrl = validateDatabaseUrl();
    const uniqueSuffix = randomUUID().replaceAll('-', '');
    const histSchema = `fe02_hist_${uniqueSuffix}`;
    const histAdmin = new pg.Pool({ connectionString: rawUrl, max: 2, connectionTimeoutMillis: 5000 });
    const isolatedUrl = new URL(rawUrl);
    isolatedUrl.searchParams.set('options', `-c search_path=${histSchema}`);
    const histPool = new pg.Pool({ connectionString: isolatedUrl.href, max: 2, connectionTimeoutMillis: 5000 });

    try {
      await histAdmin.query(`CREATE SCHEMA "${histSchema}"`);
      await histPool.query(await readFile(new URL('../../../../db/v3/0001_v3_core.sql', import.meta.url), 'utf8'));

      const owner = randomUUID();
      await histPool.query('INSERT INTO users(id,email,password,name) VALUES($1,$2,$3,$4)', [owner, `${owner}@example.test`, 'test-only-hash', 'History test']);
      const convId = randomUUID();
      await histPool.query("INSERT INTO conversations(id, user_id, status) VALUES($1, $2, 'chatting')", [convId, owner]);
      await histPool.query("INSERT INTO messages(conv_id,role,content) VALUES($1,'assistant','not a user title'),($1,'user',$2)", [convId, 'Lịch sử trước migration']);
      const sql = await migration();
      await histPool.query(sql);
      const convRow = (await histPool.query('SELECT * FROM conversations WHERE id=$1', [convId])).rows[0];
      expect(convRow.title).toBe('Lịch sử trước migration');
      await histPool.query('UPDATE conversations SET title=$2 WHERE id=$1', [convId, 'Tên đã đổi']);
      const before = (await histPool.query('SELECT * FROM conversations WHERE id=$1', [convId])).rows[0];
      await histPool.query(sql);
      expect((await histPool.query('SELECT * FROM conversations WHERE id=$1', [convId])).rows[0]).toEqual(before);
    } finally {
      await histPool.end().catch(() => undefined);
      await histAdmin.query(`DROP SCHEMA IF EXISTS "${histSchema}" CASCADE`).catch(() => undefined);
      await histAdmin.end().catch(() => undefined);
    }
  });

  it('sets first user title to 60 Unicode characters and preserves it on later messages/rename', async () => {
    const owner = await user();
    const conversation = await repo.createConversation(owner);
    await messages.createMessage(conversation.id, 'assistant', 'Assistant opening');
    expect((await repo.getConversation(conversation.id) as any).title).toBeNull();
    await messages.createMessage(conversation.id, 'user', '😀'.repeat(61));
    expect((await repo.getConversation(conversation.id) as any).title).toBe('😀'.repeat(60));
    const renamed = await (repo as any).renameConversation(conversation.id, owner, 'Tên riêng');
    expect(renamed.title).toBe('Tên riêng');
    await messages.createMessage(conversation.id, 'user', 'Later request');
    expect((await repo.getConversation(conversation.id) as any).title).toBe('Tên riêng');
  });

  it('does not overwrite a first title when user messages arrive concurrently', async () => {
    const conversation = await repo.createConversation(await user());
    await Promise.all([messages.createMessage(conversation.id, 'user', 'First candidate'), messages.createMessage(conversation.id, 'user', 'Second candidate')]);
    const title = (await repo.getConversation(conversation.id) as any).title;
    expect(['First candidate', 'Second candidate']).toContain(title);
    expect((await messages.listMessages(conversation.id)).filter(row => row.role === 'user')).toHaveLength(2);
    await messages.createMessage(conversation.id, 'user', 'Third candidate');
    expect((await repo.getConversation(conversation.id) as any).title).toBe(title);
  });

  it('HTTP paginates all 57 owned rows at tied microsecond timestamps without overlap or foreign rows', async () => {
    const owner = await user(), other = await user();
    const ids: string[] = [];
    for (let index = 0; index < 57; index++) ids.push((await repo.createConversation(owner)).id);
    await repo.createConversation(other);
    for(const id of ids)await repo.renameConversation(id,owner,'Frontend 100%_ literal');
    await pool.query("UPDATE conversations SET updated_at='2026-10-03T12:00:00.123456Z' WHERE user_id=$1", [owner]);
    const app = createApp({ jwtSecret: secret, convRepo: repo, msgRepo: messages, chatService: {} as any });
    const collected: string[] = [];
    let cursor: string | null = null;
    do {
      const res: Response = await request(app).get('/api/conversations').query({ limit: 13, ...(cursor ? { cursor } : {}) }).set('Authorization', bearer(owner));
      expect(res.status).toBe(200);
      expect(res.body.conversations.length).toBeLessThanOrEqual(13);
      collected.push(...res.body.conversations.map((row: any) => row.id));
      cursor = res.body.nextCursor;
      expect(cursor === null || typeof cursor === 'string').toBe(true);
      if (collected.length > 57) throw new Error('Pagination repeated rows');
    } while (cursor);
    expect(new Set(collected).size).toBe(57);
    expect(collected.sort()).toEqual(ids.sort());
    const literal = await request(app).get('/api/conversations').query({ search: '%_', limit: 100 }).set('Authorization', bearer(owner));
    expect(literal.body.conversations).toHaveLength(57);
    const absent = await request(app).get('/api/conversations').query({ search: 'missing' }).set('Authorization', bearer(owner));
    expect(absent.body.conversations).toEqual([]);
  });

  it('excludes old blank drafts before pagination and includes them after the first message', async () => {
    const owner = await user();
    const named = await repo.createConversation(owner, 'Named conversation');
    const untitled = await repo.createConversation(owner);
    await messages.createMessage(untitled.id, 'assistant', 'Saved reply without a title');
    const draft = await repo.createConversation(owner);
    await pool.query("UPDATE conversations SET updated_at = '2099-01-01T00:00:00Z' WHERE id = $1", [draft.id]);
    const app = createApp({ jwtSecret: secret, convRepo: repo, msgRepo: messages, chatService: {} as any });
    const history = (query = {}) => request(app).get('/api/conversations').query(query).set('Authorization', bearer(owner));

    const first = await history({ limit: 1 });
    expect(first.status).toBe(200);
    expect(first.body.conversations.map((row: { id: string }) => row.id)).toEqual([untitled.id]);
    const second = await history({ limit: 1, cursor: first.body.nextCursor });
    expect(second.status).toBe(200);
    expect(second.body.conversations.map((row: { id: string }) => row.id)).toEqual([named.id]);
    expect(second.body.nextCursor).toBeNull();

    expect(await repo.getConversation(draft.id)).not.toBeNull();
    await messages.createMessage(draft.id, 'user', 'Sent first request');
    const sent = await history({ search: 'Sent first request' });
    expect(sent.status).toBe(200);
    expect(sent.body.conversations.map((row: { id: string }) => row.id)).toEqual([draft.id]);
  });

  it('preserves PostgreSQL cursor precision for rows inside the same millisecond', async () => {
    const owner = await user();
    const ids = [];
    for (let index = 0; index < 3; index++) {
      const row = await repo.createConversation(owner, `Conversation ${index}`); ids.push(row.id);
      await pool.query('UPDATE conversations SET updated_at=$2 WHERE id=$1', [row.id, `2026-10-03T12:00:00.12345${index}Z`]);
    }
    const first = await (repo as any).listConversationPage(owner, { limit: 1 });
    const second = await (repo as any).listConversationPage(owner, { limit: 1, cursor: first.nextCursor });
    const third = await (repo as any).listConversationPage(owner, { limit: 1, cursor: second.nextCursor });
    expect([first.conversations[0].id, second.conversations[0].id, third.conversations[0].id]).toEqual(ids.reverse());
    expect(third.nextCursor).toBeNull();
  });

  it('deletes saved conversation data once and only for the owner in its workspace', async () => {
    const owner = await user(), other = await user();
    const workspaceRepo = new WorkspaceRepo(pool);
    const workspace = await workspaceRepo.create(owner, 'Conversation workspace', false);
    const target = await repo.createConversation(owner, 'Delete me', { workspaceMode: 'organization', workspaceId: workspace.id });
    const keep = await repo.createConversation(owner, 'Keep me');
    await messages.createMessage(target.id, 'user', 'Conversation content');
    const planId = randomUUID();
    await pool.query(
      "INSERT INTO plans (id, conv_id, plan_json, plan_hash, status, expires_at) VALUES ($1,$2,'{}','test','completed',now())",
      [planId, target.id],
    );
    await pool.query(
      "INSERT INTO execution_steps (plan_id, step_id, tool, args_json, status, requested_by) VALUES ($1,'s1','test.read','{}','succeeded',$2)",
      [planId, owner],
    );
    const sseManager = new SSEManager();
    sseManager.emitEvent(target.id, 'text_delta', { delta: 'Buffered old message' });
    const app = createApp({ jwtSecret: secret, convRepo: repo, msgRepo: messages, chatService: {} as any, workspaceRepo, sseManager });
    const path = `/api/conversations/${target.id.toUpperCase()}`;
    expect((await request(app).delete(path)).status).toBe(401);
    expect((await request(app).delete(path).set('Authorization', bearer(other))).status).toBe(404);
    expect((await request(app).delete(path).set('Authorization', bearer(owner)).set('X-Workspace-Id', 'personal')).status).toBe(404);
    expect(await repo.getConversation(target.id)).not.toBeNull();

    const authorized = () => request(app).delete(path).set('Authorization', bearer(owner)).set('X-Workspace-Id', workspace.id);
    const results = await Promise.all([authorized(), authorized()]);
    expect(results.map(result => result.status).sort()).toEqual([204, 404]);
    const detail = await request(app).get(path).set('Authorization', bearer(owner)).set('X-Workspace-Id', workspace.id);
    const list = await request(app).get('/api/conversations').set('Authorization', bearer(owner)).set('X-Workspace-Id', workspace.id);
    expect(detail.status).toBe(404);
    expect(list.body.conversations).toEqual([]);
    expect(await repo.getConversation(keep.id)).not.toBeNull();
    expect((await pool.query('SELECT 1 FROM messages WHERE conv_id = $1', [target.id])).rowCount).toBe(0);
    expect((await pool.query('SELECT 1 FROM plans WHERE id = $1', [planId])).rowCount).toBe(0);
    expect((await pool.query('SELECT 1 FROM execution_steps WHERE plan_id = $1', [planId])).rowCount).toBe(0);
    sseManager.emitEvent(target.id.toUpperCase(), 'text_delta', { delta: 'Late planner event' });
    expect(sseManager.getMissedEvents(target.id, 0)).toEqual([]);
    expect(sseManager.getMissedEvents(target.id.toUpperCase(), 0)).toEqual([]);
    await pool.query("UPDATE users SET status = 'disabled' WHERE id = $1", [owner]);
    const disabled = await request(app).delete(`/api/conversations/${keep.id}`)
      .set('Authorization', bearer(owner)).set('X-Workspace-Id', 'personal');
    expect(disabled.status).toBe(404);
    expect(await repo.getConversation(keep.id)).not.toBeNull();
  });

  it.each(['unresolved execution', 'schedule', 'Slack lineage'])('keeps a conversation linked to %s', async link => {
    const owner = await user();
    const target = await repo.createConversation(owner, 'Keep linked conversation');
    await messages.createMessage(target.id, 'user', 'Keep its message');
    if (link === 'unresolved execution') {
      await pool.query(
        "INSERT INTO plans (conv_id, plan_json, plan_hash, status, expires_at) VALUES ($1,'{}','test','unknown',now())",
        [target.id],
      );
    } else if (link === 'schedule') {
      await pool.query(
        "INSERT INTO schedules (user_id, conv_id, name, request, recurrence, services, status) VALUES ($1,$2,'test','test','{}','{}','paused')",
        [owner, target.id],
      );
    } else {
      await pool.query(
        "INSERT INTO slack_derived_copies (ati_user_id, target_kind, target_id, target_sub_id, target_fingerprint) VALUES ($1,'scheduled_workflow_arg',$2,'title',$3)",
        [owner, target.id, 'a'.repeat(64)],
      );
    }
    const app = createApp({ jwtSecret: secret, convRepo: repo, msgRepo: messages, chatService: {} as any });
    const response = await request(app).delete(`/api/conversations/${target.id}`).set('Authorization', bearer(owner));
    expect(response.status).toBe(409);
    expect(await repo.getConversation(target.id)).not.toBeNull();
    expect(await messages.listMessages(target.id)).toHaveLength(1);
  });

  it('blocks planner dispatch when a workspace conversation is deleted after loading its history', async () => {
    const owner = await user();
    const workspaceRepo = new WorkspaceRepo(pool);
    const workspace = await workspaceRepo.create(owner, 'Planner workspace', false);
    const target = await repo.createConversation(owner, 'Delete during planning', { workspaceMode: 'organization', workspaceId: workspace.id });
    const messageRepo = new MessageRepo(pool);
    const listMessages = messageRepo.listMessages.bind(messageRepo);
    let onHistoryLoaded!: () => void, resume!: () => void, onFinished!: () => void;
    const historyLoaded = new Promise<void>(resolve => { onHistoryLoaded = resolve; });
    const resumePlanning = new Promise<void>(resolve => { resume = resolve; });
    const finished = new Promise<void>(resolve => { onFinished = resolve; });
    vi.spyOn(messageRepo, 'listMessages').mockImplementationOnce(async (...args) => {
      const loaded = await listMessages(...args);
      onHistoryLoaded();
      await resumePlanning;
      return loaded;
    });
    const processMessage = vi.fn(async () => ({ kind: 'refusal' as const, reason: 'Fixture', suggestion: 'Fixture' }));
    const chatService = new ChatService({
      msgRepo: messageRepo, convRepo: repo, workspaceRepo,
      planner: { processMessage } as any,
      eventEmitter: { emit: event => { if (event === 'error') onFinished(); } },
    });
    const app = createApp({ jwtSecret: secret, convRepo: repo, msgRepo: messageRepo, chatService, workspaceRepo });
    const path = `/api/conversations/${target.id}`;
    const authorized = { Authorization: bearer(owner), 'X-Workspace-Id': workspace.id };
    try {
      expect((await request(app).post(`${path}/messages`).set(authorized).send({ content: 'Summarize private workspace data' })).status).toBe(202);
      await historyLoaded;
      expect((await request(app).delete(path).set(authorized)).status).toBe(204);
    } finally {
      resume();
    }
    await finished;
    expect(processMessage).not.toHaveBeenCalled();
  });

  it('treats percent, underscore and backslash literally and excludes wildcard decoys', async () => {
    await pool.query(await migration());
    const owner = await user();
    const titles = ['Percent % literal', 'Underscore _ literal', 'Backslash \\ literal', 'Percent X literal', 'Underscore X literal', 'Backslash X literal'];
    for (const title of titles) await repo.renameConversation((await repo.createConversation(owner)).id, owner, title);
    for (const [search, expected] of [['%', titles[0]], ['_', titles[1]], ['\\', titles[2]]]) {
      expect((await repo.listConversationPage(owner, { search })).conversations.map(row => row.title)).toEqual([expected]);
    }
  });

  it('HTTP rename and detail hide foreign conversations; invalid cursor/title are rejected', async () => {
    const owner = await user(), other = await user();
    const conversation = await repo.createConversation(owner);
    const app = createApp({ jwtSecret: secret, convRepo: repo, msgRepo: messages, chatService: {} as any });
    const renamed = await request(app).patch(`/api/conversations/${conversation.id}`).set('Authorization', bearer(owner)).send({ title: '  Dự án ATI  ' });
    expect(renamed.status).toBe(200); expect(renamed.body.conversation.title).toBe('Dự án ATI');
    for (const method of ['get', 'patch'] as const) {
      const foreign = request(app)[method](`/api/conversations/${conversation.id}`).set('Authorization', bearer(other));
      const res = await (method === 'patch' ? foreign.send({ title: 'Stolen' }) : foreign);
      expect(res.status).toBe(404); expect(res.body.conversation).toBeUndefined();
    }
    expect((await repo.getConversation(conversation.id) as any).title).toBe('Dự án ATI');
    for (const title of ['', ' '.repeat(2), 'x'.repeat(61), 123]) {
      expect((await request(app).patch(`/api/conversations/${conversation.id}`).set('Authorization', bearer(owner)).send({ title })).status).toBe(400);
    }
    const impossibleDate = Buffer.from(JSON.stringify({ updatedAt: '2026-02-31T00:00:00.123456Z', id: conversation.id })).toString('base64url');
    for (const query of [{ cursor: 'bad cursor' }, { cursor: impossibleDate }, { limit: '500' }, { limit: '-1' }]) {
      expect((await request(app).get('/api/conversations').query(query).set('Authorization', bearer(owner))).status).toBe(400);
    }
  });

  it('returns not-found instead of PostgreSQL UUID errors for every ID-bearing HTTP route', async () => {
    const owner = await user();
    const planRepo = new PlanRepo(pool), stepRepo = new StepRepo(pool), sseManager = new SSEManager();
    const executionService = new ExecutionService({ planRepo, stepRepo, convRepo: repo,
      adapterFactory: { getAdapterForService: () => { throw new Error('must not resolve adapters for malformed ids'); } }, sseManager });
    const app = createApp({ jwtSecret: secret, convRepo: repo, msgRepo: messages, planRepo, sseManager, executionService,
      chatService: { handleUserMessage: () => { throw new Error('must not ingest malformed conversation ids'); } } as any });
    const authorization = bearer(owner);
    const malformed = 'khong-ton-tai';
    const calls = [
      request(app).get(`/api/conversations/${malformed}`),
      request(app).get(`/api/conversations/${malformed}/plans/active`),
      request(app).get(`/api/conversations/${malformed}/messages/latest`),
      request(app).post(`/api/conversations/${malformed}/messages`).send({ content: 'Không được ghi' }),
      request(app).patch(`/api/conversations/${malformed}`).send({ title: 'Tên hợp lệ' }),
      request(app).get(`/api/conversations/${malformed}/stream`),
      request(app).get(`/api/conversations/${malformed}/executions/latest`),
      request(app).post(`/api/plans/${malformed}/approve`),
      request(app).post(`/api/plans/${malformed}/reject`),
      request(app).post(`/api/executions/${malformed}/continue`),
      request(app).post(`/api/executions/${malformed}/steps/step_1/retry`),
      request(app).post(`/api/executions/${malformed}/steps/step_1/skip`),
      request(app).post(`/api/executions/${malformed}/stop`),
      request(app).get(`/api/executions/${malformed}/status`),
    ];
    const responses = await Promise.all(calls.map(call => call.set('Authorization', authorization)));
    expect(responses.map(response => response.status)).toEqual(Array(responses.length).fill(404));
    expect(responses.every(response => !/uuid|syntax|database/i.test(String(response.body.error)))).toBe(true);
  });
});
