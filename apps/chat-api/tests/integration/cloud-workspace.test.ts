import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createCloudWorkspaceApp } from '../../src/cloud-workspace-app.js';
import { UserRepo } from '../../src/db/repositories/user-repo.js';

// Explicit opt-in only. Never run migrations against a production database by default.
const connectionString = process.env.CLOUD_TEST_DATABASE_URL;
describe.skipIf(!connectionString)('cloud workspace with isolated real PostgreSQL', () => {
  const schema = `deploy02_${randomUUID().replaceAll('-', '')}`;
  let pool: pg.Pool;
  let management: pg.Pool;
  let app: ReturnType<typeof createCloudWorkspaceApp>;
  let ownerId: string;
  let otherId: string;
  const password = 'Synthetic-test-password-only-2026';
  const ownerEmail = `${randomUUID()}@example.test`;
  const config = { databaseUrl: connectionString!, jwtSecret: 'synthetic-test-only-jwt-secret-0123456789', encryptionKey: 'a'.repeat(64), appBaseUrl: 'https://planora.example.test/', port: 10000 };

  beforeAll(async () => {
    management = new pg.Pool({ connectionString, max: 1 });
    await management.query(`CREATE SCHEMA ${schema}`);
    const isolatedUrl = new URL(connectionString!);
    // URL options override PoolConfig.options; replace an existing preview search_path.
    isolatedUrl.searchParams.set('options', `-c search_path=${schema}`);
    pool = new pg.Pool({ connectionString: isolatedUrl.href, max: 3 });
    expect((await pool.query('SELECT current_schema() AS name')).rows[0].name).toBe(schema);
    const directory = new URL('../../../../db/v3/', import.meta.url);
    for (const file of (await readdir(directory)).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort()) {
      await pool.query(await readFile(new URL(file, directory), 'utf8'));
    }
    const users = new UserRepo(pool);
    ownerId = (await users.createUser({ email: ownerEmail, name: 'Test owner', password })).id;
    otherId = (await users.createUser({ email: `${randomUUID()}@example.test`, name: 'Other owner', password })).id;
    await pool.query("UPDATE users SET status='active',email_verified=TRUE WHERE id=ANY($1::uuid[])", [[ownerId, otherId]]);
    app = createCloudWorkspaceApp(pool, config);
  }, 20000);

  afterAll(async () => {
    await pool?.end();
    if (management) {
      await management.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await management.end();
    }
  });

  const login = () => request(app).post('/api/auth/login').send({ email: ownerEmail, password });

  it('reports true capabilities; requires persistent session authentication', async () => {
    const health = await request(app).get('/api/health').expect(200);
    expect(health.body.capabilities).toMatchObject({ accounts: true, conversations: true, planning: false, execution: false, signup: false });
    await request(app).get('/api/ready').expect(200);
    await request(app).get('/api/conversations').expect(401);
    await request(app).get('/api/auth/config').expect(200, { signupEnabled: false, googleEnabled: false });
    const result = await login().expect(200);
    expect(result.body.user.id).toBe(ownerId);
    expect(result.headers['cache-control']).toBe('no-store');
    await request(app).get('/api/auth/me').auth(result.body.accessToken, { type: 'bearer' }).expect(200);
  });

  it('keeps conversations after app recreation and enforces ownership', async () => {
    const { body: auth } = await login().expect(200);
    const { body } = await request(app).post('/api/conversations').auth(auth.accessToken, { type: 'bearer' }).expect(201);
    const id = body.conversation.id;
    const recreated = createCloudWorkspaceApp(pool, config);
    const list = await request(recreated).get('/api/conversations').auth(auth.accessToken, { type: 'bearer' }).expect(200);
    expect(list.body.conversations.some((row: any) => row.id === id)).toBe(true);
    const otherEmail = (await new UserRepo(pool).findById(otherId))!.email;
    const other = await request(recreated).post('/api/auth/login').send({ email: otherEmail, password }).expect(200);
    await request(recreated).get(`/api/conversations/${id}`).auth(other.body.accessToken, { type: 'bearer' }).expect(403);
    await request(recreated).post(`/api/conversations/${id}/archive`).auth(auth.accessToken, { type: 'bearer' }).expect(200);
    await request(recreated).delete(`/api/conversations/${id}`).auth(auth.accessToken, { type: 'bearer' }).expect(204);
    const deleted = await request(recreated).get('/api/conversations?filter=deleted').auth(auth.accessToken, { type: 'bearer' }).expect(200);
    expect(deleted.body.conversations.some((row: any) => row.id === id)).toBe(true);
    await request(recreated).post(`/api/conversations/${id}/restore`).auth(auth.accessToken, { type: 'bearer' }).expect(200);
  });

  it('rejects unconfigured planning before persisting messages or pretending to execute', async () => {
    const { body: auth } = await login().expect(200);
    const { body } = await request(app).post('/api/conversations').auth(auth.accessToken, { type: 'bearer' }).expect(201);
    const id = body.conversation.id;
    const response = await request(app).post(`/api/conversations/${id}/messages`).auth(auth.accessToken, { type: 'bearer' }).send({ content: 'Do not execute provider writes' }).expect(503);
    expect(response.body.code).toBe('PLANNING_NOT_CONFIGURED');
    const rows = await pool.query('SELECT * FROM messages WHERE conv_id=$1', [id]);
    expect(rows.rowCount).toBe(0);
    await request(app).post('/api/auth/signup').send({ email: 'unused@example.test', password }).expect(503);
    await request(app).post('/api/auth/resend-verification').send({ email: ownerEmail }).expect(503);
    expect((await pool.query('SELECT * FROM email_outbox')).rowCount).toBe(0);
  });

  it('rotates refresh tokens and invalidates access immediately on logout', async () => {
    const { body: auth } = await login().expect(200);
    const refreshed = await request(app).post('/api/auth/refresh').send({ refreshToken: auth.refreshToken }).expect(200);
    expect(refreshed.body.refreshToken).not.toBe(auth.refreshToken);
    await request(app).post('/api/auth/logout').auth(refreshed.body.accessToken, { type: 'bearer' }).expect(204);
    await request(app).get('/api/auth/me').auth(refreshed.body.accessToken, { type: 'bearer' }).expect(401);
    await request(app).post('/api/auth/refresh').send({ refreshToken: refreshed.body.refreshToken }).expect(401);
  });
});
