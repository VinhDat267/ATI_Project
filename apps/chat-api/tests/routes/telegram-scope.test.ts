import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { encryptCredentials } from '@wap/tool-adapters';
import { createApp } from '../../src/app.js';
import { generateAccessToken } from '../../src/auth/jwt.js';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { TelegramTeamRepo } from '../../src/db/repositories/telegram-team-repo.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';

const secret = 'telegram_scope_test_secret_at_least_32_characters';
const key = '0123456789abcdef0123456789abcdef';
type Person = Awaited<ReturnType<Awaited<ReturnType<typeof createMigratedSchema>>['person']>>;

describe('Telegram chat & group scope routes', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  let credentials: CredentialRepo;
  let teamRepo: TelegramTeamRepo;
  let admin: Person;
  let alice: Person;
  let bob: Person;

  const mockBotConfig = {
    botToken: '123456789:AAH_fake_bot_token_for_testing_1234',
    botUsername: 'ati_workflow_bot',
    callbackUrl: 'http://127.0.0.1:5174/connections/telegram/callback',
    apiBaseUrl: 'http://127.0.0.1:4100',
    deepLinkBaseUrl: 'https://t.me',
  };

  const fakeFetch: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = url.split('/').at(-1)!;
    const body = JSON.parse(String(init?.body || '{}'));

    if (method === 'getUpdates') {
      return new Response(
        JSON.stringify({
          ok: true,
          result: [
            {
              update_id: 1,
              my_chat_member: {
                chat: { id: -100111, type: 'supergroup', title: 'Đội Sản Phẩm' },
                new_chat_member: { status: 'member' },
              },
            },
            {
              update_id: 2,
              my_chat_member: {
                chat: { id: -100222, type: 'group', title: 'Kỹ thuật ATI' },
                new_chat_member: { status: 'member' },
              },
            },
            {
              update_id: 3,
              my_chat_member: {
                chat: { id: -100999, type: 'supergroup', title: 'Nhóm Nội Bộ Khác' },
                new_chat_member: { status: 'member' },
              },
            },
          ],
        }),
        { status: 200 },
      );
    }

    if (method === 'getChatMember') {
      const uid = String(body.user_id);
      const cid = String(body.chat_id);
      // Admin (1000) is in -100111 and -100222
      if (uid === '1000' && (cid === '-100111' || cid === '-100222')) {
        return new Response(JSON.stringify({ ok: true, result: { status: 'administrator' } }), { status: 200 });
      }
      // Alice (2000) is only in -100111
      if (uid === '2000' && cid === '-100111') {
        return new Response(JSON.stringify({ ok: true, result: { status: 'member' } }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, result: { status: 'left' } }), { status: 200 });
    }

    return new Response(JSON.stringify({ ok: false, error_code: 404 }), { status: 404 });
  };

  const bearer = (who: Person) => `Bearer ${generateAccessToken(who, secret, who.sid).accessToken}`;

  const build = () =>
    createApp({
      jwtSecret: secret,
      userRepo: db.users,
      credentialRepo: credentials,
      encryptionKey: key,
      serviceAdminUserIds: [admin.id],
      telegram: {
        bot: mockBotConfig,
        fetchFn: fakeFetch,
        teamRepo,
      },
    } as any);

  beforeAll(async () => {
    db = await createMigratedSchema('telegram_scope_routes');
    credentials = new CredentialRepo(db.pool, key);
    teamRepo = new TelegramTeamRepo(db.pool);
  });

  beforeEach(async () => {
    admin = await db.person('Admin');
    (admin as any).role = 'admin';
    alice = await db.person('Alice');
    bob = await db.person('Bob');

    await credentials.saveCredentials(
      'telegram',
      encryptCredentials(
        {
          telegramUserId: '1000',
          username: 'admin_tg',
          displayName: 'Admin',
          selectedChats: [{ chatId: '1000', title: 'Telegram của tôi (Admin)', type: 'private' }],
          knownChats: [{ chatId: '1000', title: 'Telegram của tôi (Admin)', type: 'private' }],
        },
        key,
      ),
      admin.id,
    );
    await credentials.saveCredentials(
      'telegram',
      encryptCredentials(
        {
          telegramUserId: '2000',
          username: 'alice_tg',
          displayName: 'Alice',
          selectedChats: [{ chatId: '2000', title: 'Telegram của tôi (Alice)', type: 'private' }],
          knownChats: [{ chatId: '2000', title: 'Telegram của tôi (Alice)', type: 'private' }],
        },
        key,
      ),
      alice.id,
    );
    await credentials.saveCredentials(
      'telegram',
      encryptCredentials(
        {
          telegramUserId: '3000',
          username: 'bob_tg',
          displayName: 'Bob',
          selectedChats: [],
          knownChats: [{ chatId: '3000', title: 'Telegram của tôi (Bob)', type: 'private' }],
        },
        key,
      ),
      bob.id,
    );
  });

  afterAll(async () => {
    await db?.close();
  });

  it('lists only candidate chats where the caller is an active member, isolating other groups and private chats', async () => {
    const app = build();

    // Admin sees private chat 1000 + groups -100111 and -100222, NOT -100999
    const adminCandidates = await request(app)
      .get('/api/connections/telegram/candidate-chats')
      .set('Authorization', bearer(admin));
    expect(adminCandidates.status).toBe(200);
    expect(adminCandidates.body.chats).toEqual([
      { chatId: '1000', title: 'Telegram của tôi (Admin)', type: 'private', selected: true, member: true },
      { chatId: '-100111', title: 'Đội Sản Phẩm', type: 'supergroup', selected: false, member: true },
      { chatId: '-100222', title: 'Kỹ thuật ATI', type: 'group', selected: false, member: true },
    ]);

    // Alice sees only her private chat 2000 + group -100111 (where she is a member), NOT -100222 or 1000
    const aliceCandidates = await request(app)
      .get('/api/connections/telegram/candidate-chats')
      .set('Authorization', bearer(alice));
    expect(aliceCandidates.status).toBe(200);
    expect(aliceCandidates.body.chats).toEqual([
      { chatId: '2000', title: 'Telegram của tôi (Alice)', type: 'private', selected: true, member: true },
      { chatId: '-100111', title: 'Đội Sản Phẩm', type: 'supergroup', selected: false, member: true },
    ]);
  });

  it('saves 1-10 valid chats in PUT /api/connections/telegram/scope and rejects 0 chats, >10 chats, or non-member chats', async () => {
    const app = build();

    // Rejects empty chatIds
    const emptyRes = await request(app)
      .put('/api/connections/telegram/scope')
      .set('Authorization', bearer(alice))
      .send({ chatIds: [] });
    expect(emptyRes.status).toBe(400);

    // Rejects group where Alice is not a member (-100222) or another user's private chat (1000)
    const forbiddenRes = await request(app)
      .put('/api/connections/telegram/scope')
      .set('Authorization', bearer(alice))
      .send({ chatIds: ['2000', '-100222'] });
    expect(forbiddenRes.status).toBe(400);

    const otherPrivateRes = await request(app)
      .put('/api/connections/telegram/scope')
      .set('Authorization', bearer(alice))
      .send({ chatIds: ['1000'] });
    expect(otherPrivateRes.status).toBe(400);

    // Valid selection for Alice (private chat + group -100111)
    const okRes = await request(app)
      .put('/api/connections/telegram/scope')
      .set('Authorization', bearer(alice))
      .send({ chatIds: ['2000', '-100111', '2000'] });
    expect(okRes.status).toBe(200);
    expect(okRes.body.chats).toEqual([
      { chatId: '2000', title: 'Telegram của tôi (Alice)', type: 'private', selected: true, member: true },
      { chatId: '-100111', title: 'Đội Sản Phẩm', type: 'supergroup', selected: true, member: true },
    ]);

    // Bob has 0 selectedChats -> status is needs_scope
    const bobStatus = await request(app).get('/api/connections/telegram').set('Authorization', bearer(bob));
    expect(bobStatus.status).toBe(200);
    expect(bobStatus.body.status).toBe('needs_scope');
  });
});
