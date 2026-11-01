import { expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import request from 'supertest';
import { decryptCredentials, encryptCredentials } from '@wap/tool-adapters';
import { AIPlanner, WorkingMemory, validatePlan } from '@wap/planner';
import { createApp } from '../../src/app.js';
import { generateTokens } from '../../src/auth/jwt.js';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { AdapterFactory } from '../../src/services/adapter-factory.js';
import { getConfiguredToolCatalog, getToolCatalogFor } from '../../src/services/registered-services.js';

it('integrates Telegram personal encrypted SQL credentials, 1-click connection routes, factory and observed chat grounding', async () => {
  const schema = 'w304_' + randomUUID().replaceAll('-', '');
  const dbUrl = process.env.DATABASE_URL || 'postgresql://ati_v3:ati_v3_local_only@127.0.0.1:55533/ati_v3';
  const admin = new pg.Pool({ connectionString: dbUrl });
  const pool = new pg.Pool({ connectionString: dbUrl, options: '-c search_path=' + schema });
  const key = 'test-only-encryption-key-with-32bytes';
  const secret = 'fixture-jwt-secret-at-least-32-characters';
  const id = '-1001234567890';
  const botToken = '123456789:synthetic_private_token_abcdefghijkl';
  const calls: string[] = [];
  const fetchFn = vi.fn(async (url: any, init: any) => {
    const method = String(url).split('/').at(-1)!;
    calls.push(method);
    const body = JSON.parse(init.body);
    if (method !== 'getMe') expect(body.chat_id).toBe(id);
    const chat = { id: -1001234567890, title: 'ATI Test', type: 'supergroup' };
    const result =
      method === 'getMe'
        ? { id: 123456789, is_bot: true, first_name: 'Fixture' }
        : method === 'getChat'
          ? chat
          : { message_id: 42, chat, date: 1791014400 };
    return new Response(JSON.stringify({ ok: true, result }));
  }) as unknown as typeof fetch;
  try {
    await admin.query('CREATE SCHEMA ' + schema);
    await admin.query(`
      CREATE TABLE ${schema}.users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT
      );
      INSERT INTO ${schema}.users (id, email, password_hash, name)
      VALUES ('fixture-admin', 'fixture@example.test', 'hash', 'Fixture');
      CREATE TABLE ${schema}.service_credentials (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        service VARCHAR(50) NOT NULL,
        user_id TEXT REFERENCES ${schema}.users(id) ON DELETE CASCADE,
        workspace_id TEXT,
        config TEXT NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX idx_${schema}_service_cred_shared ON ${schema}.service_credentials (service) WHERE user_id IS NULL;
      CREATE UNIQUE INDEX idx_${schema}_service_cred_personal ON ${schema}.service_credentials (service, user_id) WHERE user_id IS NOT NULL;
    `);
    const repo = new CredentialRepo(pool);
    const headers = {
      Authorization: 'Bearer ' + generateTokens({ id: 'fixture-admin', email: 'fixture@example.test', name: 'Fixture' }, secret).accessToken,
    };
    const app = createApp({
      jwtSecret: secret,
      encryptionKey: key,
      credentialRepo: repo,
      serviceAdminUserIds: ['fixture-admin'],
      serviceFetchFn: fetchFn,
    });
    expect(await getConfiguredToolCatalog(repo, key)).toEqual([]);
    const initial = (await request(app).get('/api/services').set(headers)).body.services.find((s: any) => s.id === 'telegram');
    expect(initial).toMatchObject({ configured: false, scopeLabel: 'Chat ID', credentialFields: [] });
    expect((await request(app).post('/api/services/telegram/credentials').set(headers).send({ credentials: { botToken }, allowedScope: [id] })).status).toBe(410);
    expect(calls).toEqual([]);

    await repo.saveCredentials(
      'telegram',
      encryptCredentials(
        {
          telegramUserId: '777888999',
          username: 'fixture_user',
          displayName: 'Fixture',
          selectedChats: [{ chatId: id, title: 'ATI Test', type: 'supergroup' }],
        },
        key,
      ),
      'fixture-admin',
    );
    const stored = (await repo.getPersonalCredentials('telegram', 'fixture-admin'))!;
    expect(stored.config).not.toContain(botToken);
    expect(decryptCredentials(stored.config, key)).toMatchObject({
      telegramUserId: '777888999',
      username: 'fixture_user',
      selectedChats: [{ chatId: id, title: 'ATI Test', type: 'supergroup' }],
    });

    const metadata = (await request(app).get('/api/services').set(headers)).body;
    expect(JSON.stringify(metadata)).not.toContain(botToken);
    expect(JSON.stringify(metadata)).not.toContain('api.telegram.org/bot');

    const catalog = await getToolCatalogFor(repo, key, {
      userId: 'fixture-admin',
      gmailEnabled: false,
    });
    expect(catalog.map((t) => t.name)).toEqual(['telegram.list_chats', 'telegram.send_message']);

    const adapter = await new AdapterFactory({
      credentialRepo: repo,
      encryptionKey: key,
      telegramBot: { botToken, botUsername: 'ati_bot' },
      serviceFetchFn: fetchFn,
    }).getAdapterForService('telegram', { userId: 'fixture-admin', phase: 'planning' });

    const seen: any[] = [];
    const plan = {
      kind: 'plan',
      thinking: 'Use observed chat',
      summary: 'Send plain text',
      warnings: [],
      steps: [{ id: 'send', tool: 'telegram.send_message', description: 'Send', args: { chatId: id, text: 'Plain' }, dependsOn: [] }],
    };
    const planner = new AIPlanner({
      toolCatalog: catalog,
      searchMode: 'llm',
      gatherSearch: ({ tool, args, signal }) => adapter.execute(tool, args, { signal }),
      provider: {
        name: 'contract-scripted',
        async generatePlan(input) {
          seen.push(input);
          if (seen.length === 1) {
            return JSON.stringify({
              kind: 'search',
              calls: [{ tool: catalog.find((t) => t.listable && t.sideEffect === 'read')!.name, args: { query: '' } }],
            });
          }
          return JSON.stringify(plan);
        },
      },
    });
    const notification = 'Báo nhóm Telegram ATI Test là đã tạo issue';
    expect((await planner.processMessage({ userMessage: notification, memory: new WorkingMemory() })).kind).toBe('plan');
    expect(seen).toHaveLength(2);
    expect(seen[0].conversationHistory[0]).toEqual({ role: 'user', content: notification });
    expect(seen.at(-1).toolCatalog.map((t: any) => t.name)).toEqual(['telegram.list_chats', 'telegram.send_message']);
    expect(seen.at(-1).workingMemory.__observed.chat).toEqual([{ id, title: 'ATI Test' }]);
    const fabricated = structuredClone(plan);
    fabricated.steps[0]!.args.chatId = '-1009999999999';
    expect(validatePlan(JSON.stringify(fabricated), catalog, { grounding: { memory: seen.at(-1).workingMemory, userTexts: [] } }).valid).toBe(false);
    const before = calls.length;
    await expect(adapter.execute('telegram.send_message', fabricated.steps[0]!.args)).rejects.toMatchObject({ category: 'AUTH_ERROR' });
    expect(calls).toHaveLength(before);
    expect(await adapter.execute('telegram.send_message', plan.steps[0]!.args)).toEqual({ messageId: 42, chatId: id, date: 1791014400 });
  } finally {
    vi.unstubAllGlobals();
    await pool.end();
    if (!/^w304_[a-f0-9]{32}$/.test(schema)) throw new Error('Unexpected schema');
    await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE');
    await admin.end();
  }
});
