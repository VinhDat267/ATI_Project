import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { encryptCredentials } from '@wap/tool-adapters';
import { GMAIL_TOOLS } from '@wap/tool-schemas';
import { createApp } from '../../src/app.js';
import { generateAccessToken } from '../../src/auth/jwt.js';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { GmailConnectionRepo } from '../../src/db/repositories/gmail-connection-repo.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';

const secret = 'gmail_services_test_secret_at_least_32_characters';
const key = '0123456789abcdef0123456789abcdef';
const oauth = { clientId: 'c', clientSecret: 's', redirectUri: 'http://127.0.0.1:5174/connections/gmail/callback',
  authorizationUrl: 'http://127.0.0.1:1/auth', tokenUrl: 'http://127.0.0.1:1/token', revokeUrl: 'http://127.0.0.1:1/revoke', apiBaseUrl: 'http://127.0.0.1:1' };
type Person = Awaited<ReturnType<Awaited<ReturnType<typeof createMigratedSchema>>['person']>>;

describe('GET /api/services and the shared-key routes with personal Gmail', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>, credentials: CredentialRepo, alice: Person, bob: Person, admin: Person;
  const build = (enabled: boolean) => createApp({ jwtSecret: secret, userRepo: db.users, credentialRepo: credentials, encryptionKey: key,
    serviceAdminUserIds: [admin.id], gmail: { enabled, oauth, repo: new GmailConnectionRepo(db.pool) } } as any);
  const bearer = (who: Person) => `Bearer ${generateAccessToken(who, secret, who.sid).accessToken}`;
  const list = async (enabled: boolean, who: Person) => {
    const r = await request(build(enabled)).get('/api/services').set('Authorization', bearer(who));
    expect(r.status).toBe(200);
    return r.body.services as Array<Record<string, any>>;
  };
  const connectAs = (who: Person, email: string) => credentials.saveCredentials('gmail',
    encryptCredentials({ refreshToken: `1//fake-${who.id}`, email, scopes: ['https://www.googleapis.com/auth/gmail.modify'], connectedAt: '2026-10-14T03:00:00.000Z' }, key), who.id);

  beforeAll(async () => { db = await createMigratedSchema('gmail_services'); credentials = new CredentialRepo(db.pool); });
  beforeEach(async () => {
    await db.pool.query("DELETE FROM service_credentials WHERE service='gmail'");
    alice = await db.person('Alice'); bob = await db.person('Bob'); admin = await db.person('Admin');
  });
  afterAll(async () => { await db?.close(); });

  it('lists the 8 shared services, each marked shared, and no Gmail while the flag is off', async () => {
    await connectAs(alice, 'alice.mail@example.test');
    const services = await list(false, alice);
    expect(services.map((s) => s.id)).toEqual(['trello', 'slack', 'github', 'sheets', 'calendar', 'notion', 'telegram', 'jira']);
    for (const service of services) expect(service.connection, service.id).toBe('shared');
    for (const service of services) expect(service.personalStatus, service.id).toBeUndefined();
  });

  it("shows each caller only their own Gmail status, never anyone else's", async () => {
    const own = await connectAs(alice, 'alice.mail@example.test');
    const gmailOf = async (who: Person) => (await list(true, who)).find((s) => s.id === 'gmail')!;
    expect(await gmailOf(alice)).toMatchObject({
      id: 'gmail', name: 'Gmail', connection: 'personal', personalStatus: 'connected', email: 'alice.mail@example.test',
      connectedAt: '2026-10-14T03:00:00.000Z', credentialFields: [], tools: GMAIL_TOOLS.map((t) => t.name),
    });
    for (const other of [bob, admin]) {
      const row = await gmailOf(other);
      expect(row.personalStatus).toBe('not_connected');
      expect(row.email).toBeUndefined();
      expect(row.connectedAt).toBeUndefined();
      expect(JSON.stringify(row)).not.toContain('alice.mail');
    }
    await credentials.markReconnectRequired('gmail', alice.id, own.id);
    expect(await gmailOf(alice)).toMatchObject({ personalStatus: 'reconnect_required', email: 'alice.mail@example.test' });
    const shared = (await list(true, alice)).filter((s) => s.id !== 'gmail');
    expect(shared).toHaveLength(8);
    for (const service of shared) expect(service.connection).toBe('shared');
    const body = JSON.stringify(await list(true, alice));
    expect(body).not.toContain('1//fake-');
  });

  it('refuses Gmail on every shared-key administration route, even for an administrator', async () => {
    const app = build(true);
    for (const [method, path, body] of [
      ['post', '/api/services/gmail/credentials', { credentials: {}, allowedScope: ['x'] }],
      ['put', '/api/services/gmail/scope', { allowedScope: ['x'] }],
      ['post', '/api/services/gmail/test', {}],
    ] as const) {
      for (const who of [admin, alice]) {
        const r = await (request(app) as any)[method](path).set('Authorization', bearer(who)).send(body);
        expect(r.status, `${method} ${path}`).toBe(400);
        expect(r.body.error).toContain('Gmail do mỗi người tự kết nối');
      }
    }
    expect((await db.pool.query("SELECT count(*)::int AS n FROM service_credentials WHERE service='gmail'")).rows[0].n).toBe(0);
  });

  it('keeps the old answers for the unknown gmail service while the flag is off', async () => {
    const app = build(false);
    expect((await request(app).post('/api/services/gmail/credentials').set('Authorization', bearer(alice)).send({})).status).toBe(403);
    const asAdmin = await request(app).post('/api/services/gmail/credentials').set('Authorization', bearer(admin)).send({});
    expect(asAdmin.status).toBe(400);
    expect(asAdmin.body.error).not.toContain('Gmail do mỗi người');
  });
});
