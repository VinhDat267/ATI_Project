import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { generateTokens } from '../../src/auth/jwt.js';
import { decryptCredentials, encryptCredentials } from '@wap/tool-adapters';

describe('scope-only service configuration on PostgreSQL', () => {
  const connectionString = process.env.DATABASE_URL;
  const schema = `uiapi01_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString });
  const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema}`, application_name: schema });
  const repo = new CredentialRepo(pool);
  const key = 'test-only-encryption-key-with-32bytes';
  const secret = 'fixture-secret-at-least-32-characters';
  const adminToken = generateTokens({ id: 'fixture-admin', email: 'admin@example.test', name: 'Admin' }, secret).accessToken;
  const memberToken = generateTokens({ id: 'fixture-member', email: 'member@example.test', name: 'Member' }, secret).accessToken;
  const oldConfig = { token: 'ui-api-01-private-token', extra: { preserved: 'ui-api-01-extra-secret' }, allowedScope: { repos: ['old/repo'] } };
  const changed: string[] = [];
  const fetchFn = async () => new Response('{"id":1,"login":"fixture"}');
  const app = createApp({ jwtSecret: secret, encryptionKey: key, credentialRepo: repo,
    serviceFetchFn: fetchFn, serviceAdminUserIds: ['fixture-admin'], onCredentialsChanged: service => { changed.push(service); } });
  const saveScope = (allowedScope: unknown, token = adminToken, service = 'github') => request(app)
    .put(`/api/services/${service}/scope`).set('Authorization', `Bearer ${token}`).send({ allowedScope });
  let logSpies: ReturnType<typeof vi.spyOn>[];

  beforeAll(async () => {
    if (!connectionString) throw new Error('This regression requires the dedicated PostgreSQL test database');
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.query(`CREATE TABLE ${schema}.service_credentials (LIKE public.service_credentials INCLUDING ALL)`);
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE service_credentials');
    changed.length = 0;
    logSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(method => vi.spyOn(console, method));
  });
  afterEach(() => {
    try {
      const output = JSON.stringify(logSpies.flatMap(spy => spy.mock.calls));
      expect(output).not.toContain('ui-api-01-private-token');
      expect(output).not.toContain('ui-api-01-extra-secret');
      expect(output).not.toContain('ui-api-01-new-token');
    } finally { logSpies.forEach(spy => spy.mockRestore()); }
  });
  afterAll(async () => {
    await pool.end();
    if (!/^uiapi01_[a-f0-9]{32}$/.test(schema)) throw new Error('Unexpected test schema');
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });

  it('normalizes scope, preserves every saved key, invalidates health and refreshes configured services', async () => {
    const original = await repo.saveCredentials('github', encryptCredentials(oldConfig, key));
    expect((await request(app).post('/api/services/github/test').set('Authorization', `Bearer ${adminToken}`)).status).toBe(200);
    const response = await saveScope([' new/repo ', 'new/repo', 'other/repo']);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, message: 'Allowed scope saved for github' });
    expect(response.text).not.toContain(oldConfig.token);
    const saved = (await repo.getCredentials('github'))!;
    expect(saved.config).not.toBe(original.config);
    expect(decryptCredentials(saved.config, key)).toEqual({ token: 'ui-api-01-private-token', extra: { preserved: 'ui-api-01-extra-secret' }, allowedScope: { repos: ['new/repo', 'other/repo'] } });
    const listed = await request(app).get('/api/services').set('Authorization', `Bearer ${adminToken}`);
    expect(listed.body.services.find((service: any) => service.id === 'github')).toMatchObject({ configured: true, connected: false, connectionStatus: 'unchecked', lastCheckedAt: null, allowedScope: ['new/repo', 'other/repo'] });
    expect(changed).toEqual(['github']);
  });

  it('accepts the existing keyed scope shape', async () => {
    await repo.saveCredentials('github', encryptCredentials(oldConfig, key));
    expect((await saveScope({ repos: [' new/repo ', 'new/repo'] })).status).toBe(200);
    expect(decryptCredentials((await repo.getCredentials('github'))!.config, key).allowedScope).toEqual({ repos: ['new/repo'] });
  });

  it('denies a member before reading or modifying secrets', async () => {
    const original = await repo.saveCredentials('github', encryptCredentials(oldConfig, key));
    expect((await saveScope(['new/repo'], memberToken)).status).toBe(403);
    expect((await repo.getCredentials('github'))!.config).toBe(original.config);
    expect(changed).toEqual([]);
  });

  it('requires authentication', async () => {
    expect((await request(app).put('/api/services/github/scope').send({ allowedScope: ['new/repo'] })).status).toBe(401);
  });

  it('reports missing credentials without creating them', async () => {
    expect((await saveScope(['new/repo'])).status).toBe(409);
    expect(await repo.getCredentials('github')).toBeNull();
    expect(changed).toEqual([]);
  });

  it.each([[], [''], ['not-a-repo'], { channels: ['C1'] }, 'new/repo', [123], null].map(allowedScope => ({ allowedScope })))('rejects invalid scope $allowedScope without changing the encrypted config', async ({ allowedScope }) => {
    const original = await repo.saveCredentials('github', encryptCredentials(oldConfig, key));
    expect((await saveScope(allowedScope)).status).toBe(400);
    expect((await repo.getCredentials('github'))!.config).toBe(original.config);
    expect(changed).toEqual([]);
  });

  it('rejects unsupported services', async () => {
    expect((await saveScope(['new/repo'], adminToken, 'unsupported')).status).toBe(400);
  });

  it('sanitizes a failure thrown while decrypting saved credentials', async () => {
    await repo.saveCredentials('github', 'ui-api-01-private-token');
    const response = await saveScope(['new/repo']);
    expect(response.status).toBe(500);
    expect(response.text).not.toContain('ui-api-01-private-token');
    expect(changed).toEqual([]);
  });

  it('ignores a connection check that finishes after scope was saved', async () => {
    await repo.saveCredentials('github', encryptCredentials(oldConfig, key));
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<Response>(resolve => { release = () => resolve(new Response('{"id":1,"login":"fixture"}')); });
    const delayedApp = createApp({ jwtSecret: secret, encryptionKey: key, credentialRepo: repo,
      serviceAdminUserIds: ['fixture-admin'], serviceFetchFn: async () => { entered(); return held; } });
    const check = request(delayedApp).post('/api/services/github/test').set('Authorization', `Bearer ${adminToken}`).then(response => response);
    try {
      await started;
      const saved = await request(delayedApp).put('/api/services/github/scope').set('Authorization', `Bearer ${adminToken}`).send({ allowedScope: ['new/repo'] });
      expect(saved.status).toBe(200);
    } finally { release(); await check; }
    const listed = await request(delayedApp).get('/api/services').set('Authorization', `Bearer ${adminToken}`);
    expect(listed.body.services.find((service: any) => service.id === 'github')).toMatchObject({ configured: true, connected: false, connectionStatus: 'unchecked', lastCheckedAt: null });
  });

  it('waits for a concurrent SQL credential replacement and preserves its new keys', async () => {
    await repo.saveCredentials('github', encryptCredentials(oldConfig, key));
    const holder = await pool.connect();
    let pending: Promise<request.Response> | undefined;
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', ['github', 'team-shared']);
      // Same DELETE/INSERT replacement performed by saveCredentials, still uncommitted.
      await holder.query('DELETE FROM service_credentials WHERE service=$1 AND user_id IS NULL', ['github']);
      await holder.query('INSERT INTO service_credentials(service,user_id,config) VALUES($1,NULL,$2)', ['github', encryptCredentials({ token: 'ui-api-01-new-token', extra: { preserved: 'new-extra' }, allowedScope: { repos: ['replacement/repo'] } }, key)]);
      pending = saveScope(['new/repo']).then(response => response);
      const blocked = vi.waitFor(async () => {
        const result = await admin.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name=$1 AND wait_event='advisory'", [schema]);
        expect(result.rows[0].count).toBe(1);
        return 'blocked';
      }, { timeout: 2000, interval: 20 });
      const first = await Promise.race([blocked, pending.then(response => `response:${response.status}`)]);
      expect(first).toBe('blocked');
      await holder.query('COMMIT');
      expect((await pending).status).toBe(200);
      expect(decryptCredentials((await repo.getCredentials('github'))!.config, key)).toEqual({ token: 'ui-api-01-new-token', extra: { preserved: 'new-extra' }, allowedScope: { repos: ['new/repo'] } });
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
      await pending;
    }
  });
});
