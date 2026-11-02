import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { encryptCredentials } from '@wap/tool-adapters';
import { createApp } from '../../src/app.js';
import { generateAccessToken } from '../../src/auth/jwt.js';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';

const secret = 'github_shared_credentials_test_secret_32_chars';
const key = '0123456789abcdef0123456789abcdef';
type Person = Awaited<ReturnType<Awaited<ReturnType<typeof createMigratedSchema>>['person']>>;

describe('Shared GitHub credentials removal', () => {
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
    db = await createMigratedSchema('github_shared_credentials');
    credentials = new CredentialRepo(db.pool, key);
  });

  beforeEach(async () => {
    await db.pool.query("DELETE FROM service_credentials WHERE service = 'github'");
    admin = await db.person('Admin');
    member = await db.person('Member');
  });

  afterAll(async () => {
    await db?.close();
  });

  it('returns 410 Gone on POST /api/services/github/credentials and PUT/POST /api/services/github/scope', async () => {
    const app = build();
    const credRes = await request(app)
      .post('/api/services/github/credentials')
      .set('Authorization', bearer(admin))
      .send({
        credentials: { token: 'dummy-token' },
        allowedScope: ['octo/repo'],
      });

    expect(credRes.status).toBe(410);
    expect(credRes.body).toEqual({ error: 'GitHub dùng đăng nhập OAuth.' });

    const scopePut = await request(app)
      .put('/api/services/github/scope')
      .set('Authorization', bearer(admin))
      .send({ allowedScope: ['octo/repo'] });
    expect(scopePut.status).toBe(410);
    expect(scopePut.body).toEqual({ error: 'GitHub dùng đăng nhập OAuth.' });

    const scopePost = await request(app)
      .post('/api/services/github/scope')
      .set('Authorization', bearer(admin))
      .send({ allowedScope: ['octo/repo'] });
    expect(scopePost.status).toBe(410);
    expect(scopePost.body).toEqual({ error: 'GitHub dùng đăng nhập OAuth.' });
  });

  it('GET /api/services lists github with empty credentialFields and populates personalStatus and username', async () => {
    await credentials.saveCredentials(
      'github',
      encryptCredentials(
        { accessToken: 'gho-1', githubUserId: '123', login: 'alice_github' },
        key
      ),
      member.id
    );

    const app = build();
    const res = await request(app).get('/api/services').set('Authorization', bearer(member));
    expect(res.status).toBe(200);

    const github = (res.body.services as any[]).find((s) => s.id === 'github');
    expect(github).toBeDefined();
    expect(github.configured).toBe(false);
    expect(github.credentialFields).toEqual([]);
    expect(github.personalStatus).toBe('connected');
    expect(github.username).toBe('alice_github');
    expect(typeof github.connectedAt).toBe('string');
  });
});
