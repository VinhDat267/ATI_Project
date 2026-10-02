import { expect, it, vi } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { generateTokens } from '../../src/auth/jwt.js';
import { encryptCredentials } from '@wap/tool-adapters';

it.each(['healthy', 'failure'])('ignores obsolete %s connection checks after a real SQL credential replacement', async outcome => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('This regression requires the dedicated PostgreSQL test database');
  const schema = `fe01_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString });
  const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema}` });
  const repo = new CredentialRepo(pool);
  const key = 'test-only-encryption-key-with-32bytes';
  const secret = 'fixture-secret-at-least-32-characters';
  const token = generateTokens({ id: 'fixture-admin', email: 'fixture@example.test', name: 'Fixture' }, secret).accessToken;
  let started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  let release!: () => void;
  const heldResponse = new Promise<Response>((resolve, reject) => { release = () => outcome === 'healthy'
    ? resolve(new Response('{"ok":true}')) : reject(new TypeError('Fixture transport failure')); });
  const fetchFn = vi.fn().mockImplementationOnce(() => { started(); return heldResponse; })
    .mockResolvedValue(new Response('{"ok":true}'));
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.query(`CREATE TABLE ${schema}.service_credentials (LIKE public.service_credentials INCLUDING ALL)`);
    const original = await repo.saveCredentials('slack', encryptCredentials({ botToken: 'old-test-only', allowedScope: { channels: ['C1'] } }, key));
    const app = createApp({ jwtSecret: secret, encryptionKey: key, credentialRepo: repo, serviceFetchFn: fetchFn, serviceAdminUserIds: ['fixture-admin'] });
    const check = () => request(app).post('/api/services/slack/test').set('Authorization', `Bearer ${token}`);
    const obsolete = check().then(response => response);
    await entered;
    const saved = await request(app).post('/api/services/slack/credentials').set('Authorization', `Bearer ${token}`)
      .send({ credentials: { botToken: 'new-test-only' }, allowedScope: ['C1'] });
    expect(saved.status).toBe(200);
    expect((await repo.getCredentials('slack'))?.id).not.toBe(original.id);
    if (outcome === 'failure') expect((await check()).status).toBe(200);
    release(); await obsolete;
    const listed = await request(app).get('/api/services').set('Authorization', `Bearer ${token}`);
    expect(listed.body.services.find((service: any) => service.id === 'slack')).toMatchObject({
      configured: true, connected: outcome === 'failure', connectionStatus: outcome === 'failure' ? 'healthy' : 'unchecked',
    });
  } finally {
    release(); await pool.end();
    if (!/^fe01_[a-f0-9]{32}$/.test(schema)) throw new Error('Unexpected test schema');
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});
