import { expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { SERVICE_REGISTRY, ALL_TOOLS, type ServiceDefinition, type ToolDefinition } from '@wap/tool-schemas';
import { BaseAdapter, decryptCredentials, encryptCredentials } from '@wap/tool-adapters';
import { AIPlanner, WorkingMemory, classifyIntent, type LLMGeneratePlanInput } from '@wap/planner';
import { createApp } from '../../src/app.js';
import { generateTokens } from '../../src/auth/jwt.js';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { AdapterFactory } from '../../src/services/adapter-factory.js';
import * as registration from '../../src/services/registered-services.js';

const demo: ServiceDefinition = {
  id: 'demo', name: 'Demo', description: 'Extension contract only', scopes: ['things:write'], scopeKey: 'things', scopeLabel: 'Thing ID', scopePattern: /^T\d+$/,
  credentialFields: [{ key: 'secret', label: 'Secret', type: 'multiline' }], intentKeywords: ['demo'],
};
const tools: ToolDefinition[] = [
  { name: 'demo.list_things', service: 'demo', description: 'List things', sideEffect: 'read', discovers: 'thing', listable: true, riskLevel: 'low',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', maximum: 10 } } }, outputSchema: { type: 'array' } },
  { name: 'demo.create_thing', service: 'demo', description: 'Create thing', sideEffect: 'write', riskLevel: 'low',
    inputSchema: { type: 'object', required: ['thingId'], properties: { thingId: { type: 'string', 'x-resource': 'thing' } } },
    outputSchema: { type: 'object', properties: { id: { type: 'string' } } } },
];
class DemoAdapter extends BaseAdapter {
  readonly service = 'demo';
  async execute(tool: string, args: Record<string, any>) {
    if (tool === 'demo.list_things') {
      expect(args).toEqual({ query: '', limit: 10 });
      return [{ id: 'T1', name: 'Allowed thing' }];
    }
    this.assertAllowedScope('things', args.thingId);
    return { id: args.thingId };
  }
}
it('extends registry + transport data without core changes, through real SQL credentials, HTTP and grounded planning', async () => {
  const transports = (registration as any).SERVICE_TRANSPORTS;
  expect(transports, 'transports must be registerable data').toBeDefined();
  const schema = 'w300_' + randomUUID().replaceAll('-', '');
  const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: '-c search_path=' + schema });
  const key = 'test-only-encryption-key-with-32bytes';
  const secret = 'fixture-secret-at-least-32-characters';
  const token = generateTokens({ id: 'fixture-admin', email: 'fixture@example.test', name: 'Fixture' }, secret).accessToken;
  try {
    await admin.query('CREATE SCHEMA ' + schema);
    await admin.query('CREATE TABLE ' + schema + '.service_credentials (LIKE public.service_credentials INCLUDING ALL)');
    SERVICE_REGISTRY.push(demo); ALL_TOOLS.push(...tools);
    transports.demo = { createAdapter: (_config: unknown, allowedScope: any) => new DemoAdapter({ allowedScope }), checkConnection: async () => true };
    const repo = new CredentialRepo(pool);
    const app = createApp({ jwtSecret: secret, encryptionKey: key, credentialRepo: repo, serviceAdminUserIds: ['fixture-admin'] });
    const headers = { Authorization: 'Bearer ' + token };
    expect((await request(app).get('/api/services').set(headers)).body.services.find((item: any) => item.id === 'demo'))
      .toMatchObject({ scopeLabel: 'Thing ID', configured: false, tools: ['demo.list_things', 'demo.create_thing'] });
    expect((await request(app).post('/api/services/demo/credentials').set(headers).send({ credentials: { secret: 'synthetic-secret' }, allowedScope: ['invalid'] })).status).toBe(400);
    expect((await request(app).post('/api/services/demo/credentials').set(headers).send({ credentials: { secret: 'synthetic-secret' }, allowedScope: [' T1 ', 'T1'] })).status).toBe(200);
    expect(decryptCredentials((await repo.getCredentials('demo'))!.config, key)).toEqual({ secret: 'synthetic-secret', allowedScope: { things: ['T1'] } });
    expect((await request(app).get('/api/services').set(headers)).body.services.find((item: any) => item.id === 'demo').configured).toBe(true);
    const catalog = await registration.getConfiguredToolCatalog(repo, key);
    expect(catalog.map(tool => tool.name)).toEqual(['demo.list_things', 'demo.create_thing']);
    expect(classifyIntent('Create with Demo', catalog)).toEqual(['demo']);
    const factory = new AdapterFactory({ credentialRepo: repo, encryptionKey: key });
    const adapter = await factory.getAdapterForService('demo');
    await expect(adapter.execute('demo.create_thing', { thingId: 'T2' })).rejects.toMatchObject({ category: 'AUTH_ERROR' });
    const inputs: LLMGeneratePlanInput[] = [];
    const planner = new AIPlanner({
      toolCatalog: catalog, searchMode: 'llm',
      gatherSearch: async ({ tool, args, signal }) => (await factory.getAdapterForService(tool.split('.')[0]!)).execute(tool, args, { signal }),
      provider: { name: 'contract-scripted', async generatePlan(input) {
        inputs.push(input);
        return JSON.stringify({ kind: 'plan', thinking: 'Use observed thing', summary: 'Create', warnings: [],
          steps: [{ id: 'create', tool: 'demo.create_thing', description: 'Create', args: { thingId: 'T1' }, dependsOn: [] }] });
      } },
    });
    expect((await planner.processMessage({ userMessage: 'Create with Demo', memory: new WorkingMemory() })).kind).toBe('plan');
    expect(inputs[0]!.workingMemory.__observed.thing).toEqual([{ id: 'T1', name: 'Allowed thing' }]);
    expect(inputs[0]!.systemPrompt).toContain('demo.create_thing');
    await expect(adapter.execute('demo.create_thing', { thingId: 'T1' })).resolves.toEqual({ id: 'T1' });
    // Old JSON shapes inserted directly in SQL stay readable, with no rewrite/migration.
    const old = [
      { service: 'trello', config: { apiKey: 'old-key', token: 'old-token', allowedScope: { boards: ['B1'] } } },
      { service: 'slack', config: { botToken: 'old-token', allowedScope: { channels: ['C1'] } } },
      { service: 'github', config: { token: 'old-token', allowedScope: { repos: ['owner/repo'] } } },
    ];
    for (const fixture of old) {
      const encrypted = encryptCredentials(fixture.config, key);
      await pool.query('INSERT INTO service_credentials (service, config) VALUES ($1, $2)', [fixture.service, encrypted]);
      expect(decryptCredentials((await repo.getCredentials(fixture.service))!.config, key)).toEqual(fixture.config);
      expect((await factory.getAdapterForService(fixture.service)).service).toBe(fixture.service);
      expect((await repo.getCredentials(fixture.service))!.config).toBe(encrypted);
    }
    expect((await registration.getConfiguredToolCatalog(repo, key)).length).toBe(18);
  } finally {
    SERVICE_REGISTRY.splice(SERVICE_REGISTRY.indexOf(demo), 1);
    for (const tool of tools) ALL_TOOLS.splice(ALL_TOOLS.indexOf(tool), 1);
    delete transports.demo;
    await pool.end();
    if (!/^w300_[a-f0-9]{32}$/.test(schema)) throw new Error('Unexpected test schema');
    await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE'); await admin.end();
  }
});
