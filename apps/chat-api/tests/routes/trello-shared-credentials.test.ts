import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { encryptCredentials } from '@wap/tool-adapters';
import { createApp } from '../../src/app.js';
import { generateAccessToken } from '../../src/auth/jwt.js';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';

const secret = 'trello_shared_credentials_test_secret_32_chars';
const key = '0123456789abcdef0123456789abcdef';
type Person = Awaited<ReturnType<Awaited<ReturnType<typeof createMigratedSchema>>['person']>>;

describe('Task 9: Shared Trello credentials removal', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  let credentials: CredentialRepo;
  let admin: Person;
  let member: Person;

  const build = () =>
    createApp({
      jwtSecret: secret,
      userRepo: db.users,
      credentialRepo: credentials,
      encryptionKey: key,
      serviceAdminUserIds: [admin.id],
    } as any);

  const bearer = (who: Person) => `Bearer ${generateAccessToken(who, secret, who.sid).accessToken}`;

  beforeAll(async () => {
    db = await createMigratedSchema('trello_shared_credentials');
    credentials = new CredentialRepo(db.pool, key);
  });

  beforeEach(async () => {
    await db.pool.query("DELETE FROM service_credentials WHERE service = 'trello'");
    admin = await db.person('Admin');
    member = await db.person('Member');
  });

  afterAll(async () => {
    await db?.close();
  });

  it('returns 410 Gone with specific message on POST /api/services/trello/credentials and does not write a row', async () => {
    const app = build();
    const res = await request(app)
      .post('/api/services/trello/credentials')
      .set('Authorization', bearer(admin))
      .send({
        credentials: { apiKey: 'dummy-api-key', token: 'dummy-token' },
        allowedScope: ['board1'],
      });

    expect(res.status).toBe(410);
    expect(res.body).toEqual({ error: 'Trello dùng đăng nhập OAuth.' });

    const rows = await db.pool.query("SELECT * FROM service_credentials WHERE service = 'trello' AND user_id IS NULL");
    expect(rows.rows).toHaveLength(0);
  });

  it('returns 410 Gone on POST /api/services/trello/scope', async () => {
    const app = build();
    const res = await request(app)
      .post('/api/services/trello/scope')
      .set('Authorization', bearer(admin))
      .send({ allowedScope: ['board1'] });

    expect(res.status).toBe(410);
    expect(res.body).toEqual({ error: 'Trello dùng đăng nhập OAuth.' });
  });

  it('GET /api/services lists trello with empty credentialFields and does not consider Trello configured from shared credentials', async () => {
    const app = build();
    const res = await request(app).get('/api/services').set('Authorization', bearer(member));
    expect(res.status).toBe(200);

    const trello = (res.body.services as any[]).find((s) => s.id === 'trello');
    expect(trello).toBeDefined();
    expect(trello.credentialFields).toEqual([]);
    expect(trello.configured).toBe(false);
  });

  it('keeps shared credential saving for other services intact', async () => {
    const app = build();
    const res = await request(app)
      .post('/api/services/slack/credentials')
      .set('Authorization', bearer(admin))
      .send({
        credentials: { botToken: 'xoxb-dummy-token-for-test' },
        allowedScope: ['channel1'],
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true });
  });

  it('populates personal trello status and username in GET /api/services for caller with active personal credential', async () => {
    await credentials.saveCredentials(
      'trello',
      encryptCredentials(
        { refreshToken: 'rt-1', memberId: 'm1', username: 'alice_trello' },
        key
      ),
      member.id
    );

    const app = build();
    const res = await request(app).get('/api/services').set('Authorization', bearer(member));
    expect(res.status).toBe(200);

    const trello = (res.body.services as any[]).find((s) => s.id === 'trello');
    expect(trello).toBeDefined();
    expect(trello.configured).toBe(false);
    expect(trello.credentialFields).toEqual([]);
    expect(trello.personalStatus).toBe('connected');
    expect(trello.username).toBe('alice_trello');
    expect(typeof trello.connectedAt).toBe('string');
  });
});
