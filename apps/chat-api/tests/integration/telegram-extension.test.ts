import { expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import request from 'supertest';
import { decryptCredentials } from '@wap/tool-adapters';
import { AIPlanner, WorkingMemory, validatePlan } from '@wap/planner';
import { createApp } from '../../src/app.js';
import { generateTokens } from '../../src/auth/jwt.js';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { AdapterFactory } from '../../src/services/adapter-factory.js';
import { getConfiguredToolCatalog } from '../../src/services/registered-services.js';

it('integrates Telegram encrypted SQL credentials, HTTP health, factory and observed chat grounding', async () => {
  const schema = 'w304_' + randomUUID().replaceAll('-', '');
  const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: '-c search_path=' + schema });
  const key = 'test-only-encryption-key-with-32bytes'; const secret = 'fixture-jwt-secret-at-least-32-characters';
  const id = '-1001234567890'; const credentials = { botToken: '123456789:synthetic_private_token_abcdefghijkl' };
  const calls: string[] = [];
  const fetchFn = vi.fn(async (url: any, init: any) => {
    const method = String(url).split('/').at(-1)!; calls.push(method);
    const body = JSON.parse(init.body);
    if (method !== 'getMe') expect(body.chat_id).toBe(id);
    const chat = { id: -1001234567890, title: 'ATI Test', type: 'supergroup' };
    const result = method === 'getMe' ? { id: 123456789, is_bot: true, first_name: 'Fixture' }
      : method === 'getChat' ? chat : { message_id: 42, chat, date: 1791014400 };
    return new Response(JSON.stringify({ ok: true, result }));
  }) as unknown as typeof fetch;
  try {
    await admin.query('CREATE SCHEMA ' + schema); await admin.query('CREATE TABLE ' + schema + '.service_credentials (LIKE public.service_credentials INCLUDING ALL)');
    const repo = new CredentialRepo(pool);
    const headers = { Authorization: 'Bearer ' + generateTokens({ id: 'fixture-admin', email: 'fixture@example.test', name: 'Fixture' }, secret).accessToken };
    const app = createApp({ jwtSecret: secret, encryptionKey: key, credentialRepo: repo, serviceAdminUserIds: ['fixture-admin'], serviceFetchFn: fetchFn });
    expect(await getConfiguredToolCatalog(repo, key)).toEqual([]);
    const initial = (await request(app).get('/api/services').set(headers)).body.services.find((s: any) => s.id === 'telegram');
    expect(initial).toMatchObject({ configured: false, scopeLabel: 'Chat ID', credentialFields: [{ key: 'botToken', type: 'password' }] });
    for (const allowedScope of [[], ['bad'], ['42', '@outside']]) expect((await request(app).post('/api/services/telegram/credentials').set(headers).send({ credentials, allowedScope })).status).toBe(400);
    expect(calls).toEqual([]);
    expect((await request(app).post('/api/services/telegram/credentials').set(headers).send({ credentials, allowedScope: [' -001001234567890 ', id] })).status).toBe(200);
    const stored = (await repo.getCredentials('telegram'))!; expect(stored.config).not.toContain(credentials.botToken);
    expect(decryptCredentials(stored.config, key)).toEqual({ ...credentials, allowedScope: { chats: [id] } });
    const metadata = (await request(app).get('/api/services').set(headers)).body;
    expect(JSON.stringify(metadata)).not.toContain(credentials.botToken); expect(JSON.stringify(metadata)).not.toContain('api.telegram.org/bot');
    expect((await request(app).post('/api/services/telegram/test').set(headers).send({})).body.healthy).toBe(true);
    expect(calls).toEqual(['getMe']);
    const catalog = await getConfiguredToolCatalog(repo, key); expect(catalog.map(t => t.name)).toEqual(['telegram.list_chats', 'telegram.send_message']);
    vi.stubGlobal('fetch', fetchFn); const adapter = await new AdapterFactory({ credentialRepo: repo, encryptionKey: key }).getAdapterForService('telegram');
    const seen: any[] = [];
    const plan = { kind: 'plan', thinking: 'Use observed chat', summary: 'Send plain text', warnings: [], steps: [{ id: 'send', tool: 'telegram.send_message', description: 'Send', args: { chatId: id, text: 'Plain' }, dependsOn: [] }] };
    const planner = new AIPlanner({ toolCatalog: catalog, searchMode: 'llm', gatherSearch: ({ tool, args, signal }) => adapter.execute(tool, args, { signal }), provider: { name: 'contract-scripted', async generatePlan(input) { seen.push(input); return JSON.stringify(plan); } } });
    expect((await planner.processMessage({ userMessage: 'Gửi Telegram', memory: new WorkingMemory() })).kind).toBe('plan');
    expect(seen[0].workingMemory.__observed.chat).toEqual([{ id, title: 'ATI Test' }]);
    const fabricated = structuredClone(plan); fabricated.steps[0]!.args.chatId = '-1009999999999';
    expect(validatePlan(JSON.stringify(fabricated), catalog, { grounding: { memory: seen[0].workingMemory, userTexts: [] } }).valid).toBe(false);
    const before = calls.length; await expect(adapter.execute('telegram.send_message', fabricated.steps[0]!.args)).rejects.toMatchObject({ category: 'AUTH_ERROR' }); expect(calls).toHaveLength(before);
    expect(await adapter.execute('telegram.send_message', plan.steps[0]!.args)).toEqual({ messageId: 42, chatId: id, date: 1791014400 });
  } finally {
    vi.unstubAllGlobals(); await pool.end(); if (!/^w304_[a-f0-9]{32}$/.test(schema)) throw new Error('Unexpected schema');
    await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE'); await admin.end();
  }
});
