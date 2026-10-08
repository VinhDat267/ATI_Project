import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { UserRepo, hashPassword } from '../../src/db/repositories/user-repo.js';
import { generateAccessToken } from '../../src/auth/jwt.js';
import { encryptCredentials } from '@wap/tool-adapters';

describe('service configuration capability with real PostgreSQL sessions and HTTP', () => {
  const connectionString = process.env.DATABASE_URL;
  const schema = `fe07_permissions_${randomUUID().replaceAll('-', '')}`;
  const root = new pg.Pool({ connectionString });
  const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema}` });
  const users = new UserRepo(pool), credentials = new CredentialRepo(pool);
  const secret = 'fe07-http-session-secret-at-least-32-characters';
  const key = 'fe07-fixture-encryption-key-at-least-32-characters';
  const fixtures = [
    { kind: 'admin', id: randomUUID(), role: 'admin', canConfigure: true },
    { kind: 'allowlisted member', id: randomUUID(), role: 'member', canConfigure: true },
    { kind: 'ordinary member', id: randomUUID(), role: 'member', canConfigure: false },
  ] as const;
  const tokens = new Map<string, string>();
  const app = createApp({ jwtSecret: secret, userRepo: users, credentialRepo: credentials,
    encryptionKey: key, serviceAdminUserIds: [fixtures[1].id] });

  beforeAll(async () => {
    if (!connectionString) throw new Error('This regression requires the dedicated PostgreSQL test database');
    await root.query(`CREATE SCHEMA ${schema}`);
    for (const table of ['users', 'auth_sessions', 'service_credentials']) {
      await root.query(`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING ALL)`);
    }
    const password = hashPassword('FE07-permission-fixture-only');
    for (const user of fixtures) {
      const email = `${user.id}@localhost.test`;
      await pool.query("INSERT INTO users(id,email,password,name,status,role,email_verified) VALUES($1,$2,$3,'FE07 Fixture','active',$4,true)", [user.id, email, password, user.role]);
      const session = await users.sessions.create(user.id, 'FE07 permissions');
      tokens.set(user.id, generateAccessToken({ id: user.id, email, name: 'FE07 Fixture' }, secret, session.sessionId).accessToken);
    }
    await credentials.saveCredentials('github', encryptCredentials({ token: 'synthetic-fe07-token', allowedScope: { repos: ['fixture/repo'] } }, key));
  });
  afterAll(async () => {
    await pool.end();
    if (!/^fe07_permissions_[a-f0-9]{32}$/.test(schema)) throw new Error('Unexpected test schema');
    await root.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await root.end();
  });

  it.each(fixtures)('advertises the same GET, credential and scope permission for $kind', async user => {
    const authorization = `Bearer ${tokens.get(user.id)}`;
    const listed = await request(app).get('/api/services').set('Authorization', authorization);
    expect(listed.status).toBe(200);
    expect(listed.body.canConfigure).toBe(user.canConfigure);
    expect(listed.body.services).toHaveLength(8);
    expect(listed.text).not.toContain('synthetic-fe07-token');
    const saved = await request(app).post('/api/services/github/credentials').set('Authorization', authorization)
      .send({ credentials: { token: 'synthetic-fe07-token' }, allowedScope: ['fixture/repo'] });
    expect(saved.status).toBe(user.canConfigure ? 200 : 403);
    const scope = await request(app).put('/api/services/github/scope').set('Authorization', authorization)
      .send({ allowedScope: ['fixture/second'] });
    expect(scope.status).toBe(user.canConfigure ? 200 : 403);
  });
  it('refreshes the capability from the current database role without issuing a new access token', async () => {
    const user = fixtures[0], authorization = `Bearer ${tokens.get(user.id)}`;
    await pool.query("UPDATE users SET role='member' WHERE id=$1", [user.id]);
    try {
      const listed = await request(app).get('/api/services').set('Authorization', authorization);
      expect(listed.status).toBe(200); expect(listed.body.canConfigure).toBe(false);
      const saved = await request(app).put('/api/services/github/scope').set('Authorization', authorization).send({ allowedScope: ['fixture/third'] });
      expect(saved.status).toBe(403);
    } finally { await pool.query("UPDATE users SET role='admin' WHERE id=$1", [user.id]); }
  });
});
