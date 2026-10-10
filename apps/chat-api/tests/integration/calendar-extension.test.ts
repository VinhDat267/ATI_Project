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

it('integrates Calendar HTTP metadata, encrypted real SQL, read connection check, factory and observed-id grounding', async () => {
  const schema = 'w302_' + randomUUID().replaceAll('-', '');
  const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: '-c search_path=' + schema });
  const key = 'test-only-encryption-key-with-32bytes'; const secret = 'fixture-jwt-secret-at-least-32-characters';
  const id = 'ati@group.calendar.google.com';
  const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const credentials = { clientEmail: 'api@unit.iam.gserviceaccount.com', privateKey };
  const apiCalls: Array<{ url: string; method: string }> = [];
  const fetchFn = vi.fn(async (url: any, init: any) => {
    if (new URL(String(url)).hostname === 'oauth2.googleapis.com') return new Response(JSON.stringify({ access_token: 'synthetic-access-token', token_type: 'Bearer', expires_in: 3600 }));
    apiCalls.push({ url: String(url), method: init.method });
    return new Response(JSON.stringify({ id, summary: 'ATI Review', timeZone: 'Asia/Ho_Chi_Minh' }));
  }) as unknown as typeof fetch;
  try {
    await admin.query('CREATE SCHEMA ' + schema);
    await admin.query('CREATE TABLE ' + schema + '.service_credentials (LIKE public.service_credentials INCLUDING ALL)');
    const repo = new CredentialRepo(pool);
    const headers = { Authorization: 'Bearer ' + generateTokens({ id: 'fixture-admin', email: 'fixture@example.test', name: 'Fixture' }, secret).accessToken };
    const app = createApp({ jwtSecret: secret, encryptionKey: key, credentialRepo: repo, serviceAdminUserIds: ['fixture-admin'], serviceFetchFn: fetchFn });
    expect(await getConfiguredToolCatalog(repo, key)).toEqual([]);
    const initial = (await request(app).get('/api/services').set(headers)).body.services.find((service: any) => service.id === 'calendar');
    expect(initial).toMatchObject({ configured: false, scopeLabel: 'Calendar ID', credentialFields: [{ key: 'clientEmail', type: 'text' }, { key: 'privateKey', type: 'multiline' }] });
    expect((await request(app).post('/api/services/calendar/credentials').set(headers).send({ credentials, allowedScope: ['bad/id'] })).status).toBe(400);
    expect((await request(app).post('/api/services/calendar/credentials').set(headers).send({ credentials, allowedScope: [id] })).status).toBe(200);
    const record = (await repo.getCredentials('calendar'))!;
    expect(record.config).not.toContain(privateKey);
    expect(decryptCredentials(record.config, key)).toEqual({ ...credentials, allowedScope: { calendars: [id] } });
    const services = (await request(app).get('/api/services').set(headers)).body;
    expect(JSON.stringify(services)).not.toContain(privateKey); expect(JSON.stringify(services)).not.toContain(credentials.clientEmail);
    expect((await request(app).post('/api/services/calendar/test').set(headers).send({})).body.healthy).toBe(true);
    expect(apiCalls).toHaveLength(1); expect(apiCalls[0]!.method).toBe('GET');
    expect(decodeURIComponent(new URL(apiCalls[0]!.url).pathname)).toBe('/calendar/v3/calendars/' + id);
    const registration = getRegisteredService('calendar')!;
    expect(normalizeAllowedScope(registration.definition, [])).toBeNull();
    expect(normalizeAllowedScope(registration.definition, ['primary'])).toBeNull();
    expect(normalizeAllowedScope(registration.definition, [' ' + id + ' ', id])).toEqual({ calendars: [id] });
    const catalog = await getConfiguredToolCatalog(repo, key);
    expect(catalog.map(tool => tool.name)).toEqual(['calendar.list_calendars', 'calendar.list_events', 'calendar.create_event']);
    vi.stubGlobal('fetch', fetchFn);
    const factory = new AdapterFactory({ credentialRepo: repo, encryptionKey: key });
    const adapter = await factory.getAdapterForService('calendar'); const seen: any[] = [];
    const args = { calendarId: id, summary: 'Review', start: '2026-10-09T15:00:00+07:00', end: '2026-10-09T16:00:00+07:00' };
    const plan = { kind: 'plan', thinking: 'Use the observed allowed calendar and explicit offset times', summary: 'Create review', warnings: [], steps: [{ id: 'event', tool: 'calendar.create_event', description: 'Create', args, dependsOn: [] }] };
    const planner = new AIPlanner({ toolCatalog: catalog, searchMode: 'llm',
      gatherSearch: ({ tool, args, signal }) => adapter.execute(tool, args, { signal }),
      provider: { name: 'contract-scripted', async generatePlan(input) { seen.push(input);
        if (seen.length === 1) return JSON.stringify({ kind: 'search', calls: [{ tool: catalog.find(t => t.listable && t.sideEffect === 'read')!.name, args: { query: '' } }] }); return JSON.stringify(plan); } },
    });
    expect((await planner.processMessage({ userMessage: 'Đặt lịch họp Google Calendar', memory: new WorkingMemory() })).kind).toBe('plan');
    expect(seen.at(-1).workingMemory.__observed.calendar).toEqual([{ id, title: 'ATI Review' }]);
    const fabricated = structuredClone(plan); fabricated.steps[0]!.args.calendarId = 'fabricated@group.calendar.google.com';
    expect(validatePlan(JSON.stringify(fabricated), catalog, { grounding: { memory: seen.at(-1).workingMemory, userTexts: [] } }).valid).toBe(false);
    const before = vi.mocked(fetchFn).mock.calls.length;
    await expect(adapter.execute('calendar.create_event', fabricated.steps[0]!.args)).rejects.toMatchObject({ category: 'AUTH_ERROR' });
    expect(vi.mocked(fetchFn).mock.calls).toHaveLength(before);
  } finally {
    vi.unstubAllGlobals(); await pool.end();
    if (!/^w302_[a-f0-9]{32}$/.test(schema)) throw new Error('Unexpected test schema');
    await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE'); await admin.end();
  }
});
