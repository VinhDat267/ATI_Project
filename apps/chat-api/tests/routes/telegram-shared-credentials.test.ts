import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { encryptCredentials } from '@wap/tool-adapters';
import { createApp } from '../../src/app.js';
import { generateAccessToken } from '../../src/auth/jwt.js';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';

const secret = 'telegram_shared_credentials_test_secret_32_chars';
const key = '0123456789abcdef0123456789abcdef';
type Person = Awaited<ReturnType<Awaited<ReturnType<typeof createMigratedSchema>>['person']>>;

describe('Shared Telegram credentials removal & personal status in GET /api/services', () => {
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
    db = await createMigratedSchema('telegram_shared_credentials');
    credentials = new CredentialRepo(db.pool, key);
  });

  beforeEach(async () => {
    await db.pool.query("DELETE FROM service_credentials WHERE service = 'telegram'");
    admin = await db.person('Admin');
    member = await db.person('Member');
  });

  afterAll(async () => {
    await db?.close();
  });

  it('returns 410 Gone on POST /api/services/telegram/credentials and POST/PUT /api/services/telegram/scope', async () => {
    const app = build();
    const credRes = await request(app)
      .post('/api/services/telegram/credentials')
      .set('Authorization', bearer(admin))
      .send({
        credentials: { botToken: '123456:AAH_dummy' },
        allowedScope: ['-1001234567890'],
      });
    expect(credRes.status).toBe(410);
    expect(credRes.body).toEqual({ error: 'Telegram dùng kết nối 1 chạm.' });

    const scopeRes = await request(app)
      .put('/api/services/telegram/scope')
      .set('Authorization', bearer(admin))
      .send({ allowedScope: ['-1001234567890'] });
    expect(scopeRes.status).toBe(410);
    expect(scopeRes.body).toEqual({ error: 'Telegram dùng kết nối 1 chạm.' });
  });

  it('populates personal telegram status and username in GET /api/services for caller with active personal credential', async () => {
    await credentials.saveCredentials(
      'telegram',
      encryptCredentials(
        {
          telegramUserId: '778899',
          username: 'alice_tg',
          displayName: 'Alice Nguyễn',
          selectedChats: [{ chatId: '778899', title: 'Telegram của tôi (Alice Nguyễn)', type: 'private' }],
        },
        key,
      ),
      member.id,
    );

    const app = build();
    const res = await request(app).get('/api/services').set('Authorization', bearer(member));
    expect(res.status).toBe(200);

    const telegram = (res.body.services as any[]).find((s) => s.id === 'telegram');
    expect(telegram).toBeDefined();
    expect(telegram.credentialFields).toEqual([]);
    expect(telegram.personalStatus).toBe('connected');
    expect(telegram.username).toBe('alice_tg');
    expect(typeof telegram.connectedAt).toBe('string');
  });
});
