import { expect, it, vi } from 'vitest';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import pg from 'pg';
import request from 'supertest';
import { decryptCredentials } from '@wap/tool-adapters';
import { AIPlanner, WorkingMemory, validatePlan } from '@wap/planner';
import { createApp } from '../../src/app.js';
import { generateTokens } from '../../src/auth/jwt.js';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { AdapterFactory } from '../../src/services/adapter-factory.js';
import { getConfiguredToolCatalog, getRegisteredService, normalizeAllowedScope } from '../../src/services/registered-services.js';

it('integrates Sheets through HTTP, encrypted real SQL, connection check, factory and observed parent/child planning', async () => {
  const schema = 'w301_' + randomUUID().replaceAll('-', '');
  const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: '-c search_path=' + schema });
  const key = 'test-only-encryption-key-with-32bytes'; const secret = 'fixture-jwt-secret-at-least-32-characters';
  const id = 'spreadsheet_fixture_123456';
  const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const credentials = { clientEmail: 'api@unit.iam.gserviceaccount.com', privateKey };
  const fetchFn = vi.fn(async (url: any, init: any) => {
    const parsed = new URL(String(url));
    if (parsed.hostname === 'oauth2.googleapis.com') return new Response(JSON.stringify({ access_token: 'synthetic-access-token', token_type: 'Bearer', expires_in: 3600 }));
    if (parsed.searchParams.get('fields') === 'properties.title') return new Response(JSON.stringify({ properties: { title: 'ATI Test Tracker' } }));
    return new Response(JSON.stringify({ sheets: [{ properties: { sheetId: 0, title: 'Tasks' } }] }));
  }) as unknown as typeof fetch;
  try {
    await admin.query('CREATE SCHEMA ' + schema);
    await admin.query('CREATE TABLE ' + schema + '.service_credentials (LIKE public.service_credentials INCLUDING ALL)');
    const repo = new CredentialRepo(pool);
    const headers = { Authorization: 'Bearer ' + generateTokens({ id: 'fixture-admin', email: 'fixture@example.test', name: 'Fixture' }, secret).accessToken };
    const app = createApp({ jwtSecret: secret, encryptionKey: key, credentialRepo: repo, serviceAdminUserIds: ['fixture-admin'], serviceFetchFn: fetchFn });
    expect(await getConfiguredToolCatalog(repo, key)).toEqual([]);
    const initial = (await request(app).get('/api/services').set(headers)).body.services.find((service: any) => service.id === 'sheets');
    expect(initial).toMatchObject({ configured: false, scopeLabel: 'Spreadsheet ID', credentialFields: [{ key: 'clientEmail', type: 'text' }, { key: 'privateKey', type: 'multiline' }] });
    expect((await request(app).post('/api/services/sheets/credentials').set(headers).send({ credentials, allowedScope: ['bad/id'] })).status).toBe(400);
    expect((await request(app).post('/api/services/sheets/credentials').set(headers).send({ credentials, allowedScope: [id] })).status).toBe(200);
    const record = (await repo.getCredentials('sheets'))!;
    expect(record.config).not.toContain(privateKey);
    expect(decryptCredentials(record.config, key)).toEqual({ ...credentials, allowedScope: { spreadsheets: [id] } });
    const services = (await request(app).get('/api/services').set(headers)).body;
    expect(JSON.stringify(services)).not.toContain(privateKey);
    expect(JSON.stringify(services)).not.toContain(credentials.clientEmail);
    expect((await request(app).post('/api/services/sheets/test').set(headers).send({})).body.healthy).toBe(true);
    const registration = getRegisteredService('sheets')!;
    expect(normalizeAllowedScope(registration.definition, [])).toBeNull();
    expect(normalizeAllowedScope(registration.definition, [' ' + id + ' ', id])).toEqual({ spreadsheets: [id] });
    const catalog = await getConfiguredToolCatalog(repo, key);
    expect(catalog.map(tool => tool.name)).toEqual(['sheets.list_spreadsheets', 'sheets.list_sheets', 'sheets.read_range', 'sheets.append_rows']);
    vi.stubGlobal('fetch', fetchFn);
    const factory = new AdapterFactory({ credentialRepo: repo, encryptionKey: key });
    const adapter = await factory.getAdapterForService('sheets');
    const seen: any[] = [];
    const planner = new AIPlanner({ toolCatalog: catalog, searchMode: 'llm',
      gatherSearch: ({ tool, args, signal }) => adapter.execute(tool, args, { signal }),
      provider: { name: 'contract-scripted', async generatePlan(input) { seen.push(input); return JSON.stringify({ kind: 'plan', thinking: 'Use observed tab', summary: 'Append', warnings: [], steps: [
        { id: 'append', tool: 'sheets.append_rows', description: 'Append row', args: { spreadsheetId: id, sheet: 'Tasks', rows: [['Task']] }, dependsOn: [] },
      ] }); } },
    });
    const memory = new WorkingMemory();
    expect((await planner.processMessage({ userMessage: 'Append a row in Google Sheets', memory })).kind).toBe('plan');
    expect(seen[0].workingMemory.__observed.spreadsheet).toEqual([{ id, title: 'ATI Test Tracker', url: 'https://docs.google.com/spreadsheets/d/' + id + '/edit' }]);
    expect(seen[0].workingMemory.__observed.sheet).toEqual([{ id: 0, title: 'Tasks' }]);
    // A fabricated spreadsheet/tab cannot pass the real grounding validator.
    const plan = { kind: 'plan', thinking: '', summary: '', warnings: [], steps: [{ id: 'x', tool: 'sheets.append_rows', description: '', args: { spreadsheetId: 'fabricated_spreadsheet_id', sheet: 'Missing', rows: [['x']] }, dependsOn: [] }] };
    expect(validatePlan(JSON.stringify(plan), catalog, { grounding: { memory: seen[0].workingMemory, userTexts: [] } }).valid).toBe(false);
    await expect(adapter.execute('sheets.append_rows', { spreadsheetId: 'outside_spreadsheet_123456', sheet: 'Tasks', rows: [['x']] })).rejects.toMatchObject({ category: 'AUTH_ERROR' });
  } finally {
    vi.unstubAllGlobals(); await pool.end();
    if (!/^w301_[a-f0-9]{32}$/.test(schema)) throw new Error('Unexpected test schema');
    await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE'); await admin.end();
  }
});
