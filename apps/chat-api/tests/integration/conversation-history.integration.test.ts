import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConversationRepo } from '../../src/db/repositories/conversation-repo.js';
import { MessageRepo } from '../../src/db/repositories/message-repo.js';
import { PlanRepo } from '../../src/db/repositories/plan-repo.js';
import { StepRepo } from '../../src/db/repositories/step-repo.js';
import { createApp } from '../../src/app.js';
import { generateTokens } from '../../src/auth/jwt.js';
import { ExecutionService } from '../../src/services/execution-service.js';
import { SSEManager } from '../../src/sse/sse-manager.js';

const connectionString = process.env.DATABASE_URL;
const schema = `fe02_history_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Pool({ connectionString });
const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema},public` });
const repo = new ConversationRepo(pool);
const messages = new MessageRepo(pool);
const migration = () => readFile(new URL('../../../../db/v3/0004_conversation_titles.sql', import.meta.url), 'utf8');
const secret = 'fe02_history_integration_jwt_secret';

async function user() {
  const id = randomUUID();
  await pool.query('INSERT INTO users(id,email,password,name) VALUES($1,$2,$3,$4)', [id, `${id}@example.test`, 'test-only-hash', 'History test']);
  return id;
}
function bearer(id: string) { return `Bearer ${generateTokens({ id, email: `${id}@example.test`, name: 'History test' }, secret).accessToken}`; }

describe('FE-02 conversation history: real PostgreSQL and HTTP', () => {
  beforeAll(async () => {
    if (!connectionString) throw new Error('DATABASE_URL is required for FE-02 PostgreSQL evidence');
    await admin.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await admin.query(`CREATE SCHEMA ${schema}`);
    await pool.query(await readFile(new URL('../../../../db/v3/0001_v3_core.sql', import.meta.url), 'utf8'));
  });
  afterAll(async () => { await pool.end(); await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end(); });

  it('backfills existing first-user titles once and preserves data on a second migration', async () => {
    const owner = await user();
    const conversation = await repo.createConversation(owner);
    await pool.query("INSERT INTO messages(conv_id,role,content) VALUES($1,'assistant','not a user title'),($1,'user',$2)", [conversation.id, 'Lịch sử trước migration']);
    const sql = await migration();
    await pool.query(sql);
    expect((await repo.getConversation(conversation.id) as any).title).toBe('Lịch sử trước migration');
    await pool.query('UPDATE conversations SET title=$2 WHERE id=$1', [conversation.id, 'Tên đã đổi']);
    const before = (await pool.query('SELECT * FROM conversations WHERE id=$1', [conversation.id])).rows[0];
    await pool.query(sql);
    expect((await pool.query('SELECT * FROM conversations WHERE id=$1', [conversation.id])).rows[0]).toEqual(before);
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
    await pool.query("UPDATE conversations SET updated_at='2026-10-03T12:00:00.123456Z', title='Frontend 100%_ literal' WHERE user_id=$1", [owner]);
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

  it('preserves PostgreSQL cursor precision for rows inside the same millisecond', async () => {
    const owner = await user();
    const ids = [];
    for (let index = 0; index < 3; index++) {
      const row = await repo.createConversation(owner); ids.push(row.id);
      await pool.query('UPDATE conversations SET updated_at=$2 WHERE id=$1', [row.id, `2026-10-03T12:00:00.12345${index}Z`]);
    }
    const first = await (repo as any).listConversationPage(owner, { limit: 1 });
    const second = await (repo as any).listConversationPage(owner, { limit: 1, cursor: first.nextCursor });
    const third = await (repo as any).listConversationPage(owner, { limit: 1, cursor: second.nextCursor });
    expect([first.conversations[0].id, second.conversations[0].id, third.conversations[0].id]).toEqual(ids.reverse());
    expect(third.nextCursor).toBeNull();
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
