import { expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import request from 'supertest';
import { decryptCredentials } from '@wap/tool-adapters';
import { AIPlanner, WorkingMemory, validatePlan } from '@wap/planner';
import { groundingMemory } from '../../../../packages/planner/src/search.js';
import { createApp } from '../../src/app.js';
import { generateTokens } from '../../src/auth/jwt.js';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { AdapterFactory } from '../../src/services/adapter-factory.js';
import { getConfiguredToolCatalog } from '../../src/services/registered-services.js';

it('integrates Notion encrypted SQL credentials, HTTP metadata, factory, search and observed database/page grounding', async () => {
  const schema = 'w303_' + randomUUID().replaceAll('-', '');
  const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: '-c search_path=' + schema });
  const key = 'test-only-encryption-key-with-32bytes'; const secret = 'fixture-jwt-secret-at-least-32-characters';
  const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'; const ds = '11111111-2222-3333-4444-555555555555'; const pageId = '22222222-3333-4444-5555-666666666666';
  const credentials = { token: 'synthetic-notion-private-token' }; const calls: Array<{ path: string; method: string }> = [];
  const fetchFn = vi.fn(async (url: any, init: any) => {
    expect(new Headers(init.headers).get('Notion-Version')).toBe('2026-03-11');
    const path = new URL(String(url)).pathname; calls.push({ path, method: init.method });
    const value = path === '/v1/databases/' + id ? { object: 'database', id, title: [{ plain_text: 'ATI Notes' }], url: 'https://www.notion.so/' + id.replaceAll('-', ''), data_sources: [{ id: ds }] }
      : path.endsWith('/query') ? { object: 'list', results: [{ object: 'page', id: pageId, parent: { type: 'data_source_id', data_source_id: ds }, url: 'https://www.notion.so/' + pageId.replaceAll('-', ''), properties: { Name: { type: 'title', title: [{ plain_text: 'ATI Review' }] } } }], has_more: false }
        : { object: 'data_source', id: ds, parent: { type: 'database_id', database_id: id }, properties: { Name: { type: 'title' } } };
    return new Response(JSON.stringify(value));
  }) as unknown as typeof fetch;
  try {
    await admin.query('CREATE SCHEMA ' + schema); await admin.query('CREATE TABLE ' + schema + '.service_credentials (LIKE public.service_credentials INCLUDING ALL)');
    const repo = new CredentialRepo(pool);
    const headers = { Authorization: 'Bearer ' + generateTokens({ id: 'fixture-admin', email: 'fixture@example.test', name: 'Fixture' }, secret).accessToken };
    const app = createApp({ jwtSecret: secret, encryptionKey: key, credentialRepo: repo, serviceAdminUserIds: ['fixture-admin'], serviceFetchFn: fetchFn });
    expect(await getConfiguredToolCatalog(repo, key)).toEqual([]);
    const initial = (await request(app).get('/api/services').set(headers)).body.services.find((service: any) => service.id === 'notion');
    expect(initial).toMatchObject({ configured: false, scopeLabel: 'Database ID', credentialFields: [{ key: 'token', type: 'password' }] });
    expect((await request(app).post('/api/services/notion/credentials').set(headers).send({ credentials, allowedScope: ['bad'] })).status).toBe(400);
    expect((await request(app).post('/api/services/notion/credentials').set(headers).send({ credentials, allowedScope: [id.replaceAll('-', '').toUpperCase(), id] })).status).toBe(200);
    const record = (await repo.getCredentials('notion'))!; expect(record.config).not.toContain(credentials.token);
    expect(decryptCredentials(record.config, key)).toEqual({ ...credentials, allowedScope: { databases: [id] } });
    expect(JSON.stringify((await request(app).get('/api/services').set(headers)).body)).not.toContain(credentials.token);
    expect((await request(app).post('/api/services/notion/test').set(headers).send({})).body.healthy).toBe(true);
    expect(calls).toEqual([{ path: '/v1/databases/' + id, method: 'GET' }]);
    const catalog = await getConfiguredToolCatalog(repo, key); expect(catalog.map(t => t.name)).toEqual(['notion.search_databases', 'notion.query_database', 'notion.create_page', 'notion.append_text']);
    vi.stubGlobal('fetch', fetchFn); const factory = new AdapterFactory({ credentialRepo: repo, encryptionKey: key }); const adapter = await factory.getAdapterForService('notion'); const seen: any[] = [];
    const plan = { kind: 'plan', thinking: 'Use the observed database', summary: 'Create note', warnings: [], steps: [{ id: 'note', tool: 'notion.create_page', description: 'Create', args: { databaseId: id, title: 'Review' }, dependsOn: [] }] };
    const planner = new AIPlanner({ toolCatalog: catalog, searchMode: 'llm', gatherSearch: ({ tool, args, signal }) => adapter.execute(tool, args, { signal }), provider: { name: 'contract-scripted', async generatePlan(input) { seen.push(input);
        if (seen.length === 1) return JSON.stringify({ kind: 'search', calls: [{ tool: catalog.find(t => t.listable && t.sideEffect === 'read')!.name, args: { query: '' } }] }); return JSON.stringify(plan); } } });
    expect((await planner.processMessage({ userMessage: 'Tạo page Notion', memory: new WorkingMemory() })).kind).toBe('plan');
    expect(seen.at(-1).workingMemory.__observed.database).toEqual([{ id, title: 'ATI Notes', url: 'https://www.notion.so/' + id.replaceAll('-', '') }]);
    const fabricated = structuredClone(plan); fabricated.steps[0]!.args.databaseId = '99999999-8888-7777-6666-555555555555';
    expect(validatePlan(JSON.stringify(fabricated), catalog, { grounding: { memory: seen.at(-1).workingMemory, userTexts: [] } }).valid).toBe(false);
    const queried = await adapter.execute('notion.query_database', { databaseId: id, query: '', limit: 10 });
    const append = { ...plan, steps: [{ id: 'append', tool: 'notion.append_text', description: 'Append', args: { pageId, text: 'Plain' }, dependsOn: [] }] };
    const memory = groundingMemory(seen.at(-1).workingMemory, { ...seen.at(-1).workingMemory.__observed, page: queried.pages });
    const grounded = validatePlan(JSON.stringify(append), catalog, { grounding: { memory, userTexts: [] } });
    expect(grounded, grounded.valid ? undefined : grounded.error).toMatchObject({ valid: true });
    expect(validatePlan(JSON.stringify({ ...append, steps: [{ ...append.steps[0], args: { pageId: fabricated.steps[0]!.args.databaseId, text: 'No' } }] }), catalog, { grounding: { memory, userTexts: [] } }).valid).toBe(false);
    const before = calls.length; await expect(adapter.execute('notion.create_page', fabricated.steps[0]!.args)).rejects.toMatchObject({ category: 'AUTH_ERROR' }); expect(calls).toHaveLength(before);
  } finally {
    vi.unstubAllGlobals(); await pool.end(); if (!/^w303_[a-f0-9]{32}$/.test(schema)) throw new Error('Unexpected schema');
    await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE'); await admin.end();
  }
});
