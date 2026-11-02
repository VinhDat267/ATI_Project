import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createHash } from 'node:crypto';
import { decryptCredentials, encryptCredentials } from '@wap/tool-adapters';
import { createApp } from '../../src/app.js';
import { generateAccessToken } from '../../src/auth/jwt.js';
import { ConversationRepo } from '../../src/db/repositories/conversation-repo.js';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { TelegramTeamRepo } from '../../src/db/repositories/telegram-team-repo.js';
import { TelegramUpdateRepo } from '../../src/db/repositories/telegram-update-repo.js';
import { TelegramBotClient } from '../../src/services/telegram/bot-client.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';

const secret = 'telegram_connection_test_secret_at_least_32_characters';
const key = '0123456789abcdef0123456789abcdef';
type Person = Awaited<ReturnType<Awaited<ReturnType<typeof createMigratedSchema>>['person']>>;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

describe('Telegram 1-click pairing connection routes', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  let credentials: CredentialRepo;
  let convRepo: ConversationRepo;
  let teamRepo: TelegramTeamRepo;
  let changed: string[];
  let now: number;
  let alice: Person;
  let bob: Person;
  let telegramUpdates: any[];
  let fetchCalls: string[];

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
    fetchCalls.push(method);
    const body = JSON.parse(String(init?.body || '{}'));

    if (method === 'getUpdates') {
      return new Response(JSON.stringify({ ok: true, result: telegramUpdates }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (method === 'getChatMember') {
      if (String(body.user_id) === '778899' && String(body.chat_id) === '-1001234567890') {
        return new Response(JSON.stringify({ ok: true, result: { status: 'member' } }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, result: { status: 'left' } }), { status: 200 });
    }
    if (method === 'getChat') {
      return new Response(
        JSON.stringify({
          ok: true,
          result: { id: Number(body.chat_id), title: 'Đội Sản Phẩm', type: 'supergroup' },
        }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ ok: false, error_code: 404 }), { status: 404 });
  };

  const build = (telegramOpts: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
    createApp({
      jwtSecret: secret,
      userRepo: db.users,
      credentialRepo: credentials,
      convRepo,
      encryptionKey: key,
      authClock: () => now,
      appBaseUrl: 'http://127.0.0.1:5174',
      telegram: {
        bot: mockBotConfig,
        fetchFn: fakeFetch,
        teamRepo,
        onConnectionChanged: (id: string) => changed.push(id),
        ...telegramOpts,
      },
      ...extra,
    } as any);

  const bearer = (who: Person) => `Bearer ${generateAccessToken(who, secret, who.sid).accessToken}`;

  beforeAll(async () => {
    db = await createMigratedSchema('telegram_routes');
    credentials = new CredentialRepo(db.pool, key);
    convRepo = new ConversationRepo(db.pool);
    teamRepo = new TelegramTeamRepo(db.pool);
  });

  beforeEach(async () => {
    changed = [];
    fetchCalls = [];
    telegramUpdates = [];
    now = Date.now();
    alice = await db.person('Alice');
    bob = await db.person('Bob');
  });

  afterAll(async () => {
    await db?.close();
  });

  describe('configuration & start', () => {
    it('returns 503 without url property when TELEGRAM_BOT is missing', async () => {
      const app = build({ bot: undefined });
      const res = await request(app)
        .post('/api/connections/telegram/start')
        .set('Authorization', bearer(alice))
        .send({});

      expect(res.status).toBe(503);
      expect(res.body).toEqual({ error: 'Telegram chưa được cấu hình trên máy chủ.' });
      expect(res.body.url).toBeUndefined();
    });

    it('creates state mode connect_telegram and returns callback url + 1-click deepLinkUrl & groupDeepLinkUrl without leaking botToken', async () => {
      const app = build();
      const aliceConv = await convRepo.createConversation(alice.id);

      const res = await request(app)
        .post('/api/connections/telegram/start')
        .set('Authorization', bearer(alice))
        .send({ returnTo: `/c/${aliceConv.id}` });

      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toContain('no-store');
      expect(JSON.stringify(res.body)).not.toContain(mockBotConfig.botToken);

      const state = res.body.state as string;
      expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(res.body.botUsername).toBe('ati_workflow_bot');
      expect(res.body.url).toBe(`http://127.0.0.1:5174/connections/telegram/callback?state=${encodeURIComponent(state)}`);
      expect(res.body.deepLinkUrl).toBe(`https://t.me/ati_workflow_bot?start=ati_${encodeURIComponent(state)}`);
      expect(res.body.groupDeepLinkUrl).toBe(`https://t.me/ati_workflow_bot?startgroup=ati_${encodeURIComponent(state)}`);

      const rawCookie = (res.headers['set-cookie'] as unknown as string[])[0]!;
      expect(rawCookie).toMatch(/^ati_telegram_browser=/);
      expect(rawCookie).toMatch(/HttpOnly/i);
      expect(rawCookie).toMatch(/Path=\/api\/connections\/telegram/i);

      const cookieVal = rawCookie.split(';')[0]!.split('=')[1]!;
      const stateRow = (
        await db.pool.query('SELECT * FROM oauth_states WHERE state_hash = $1', [hash(state)])
      ).rows[0];
      expect(stateRow).toMatchObject({
        mode: 'connect_telegram',
        user_id: alice.id,
        session_id: alice.sid,
        browser_binding_hash: hash(cookieVal),
        return_to: `/c/${aliceConv.id}`,
      });
    });

    it('rejects returnTo belonging to another user or invalid path', async () => {
      const app = build();
      const bobConv = await convRepo.createConversation(bob.id);

      const bobRes = await request(app)
        .post('/api/connections/telegram/start')
        .set('Authorization', bearer(alice))
        .send({ returnTo: `/c/${bobConv.id}` });
      expect(bobRes.status).toBe(400);
      expect(bobRes.body).toMatchObject({
        error: 'Không mở được kết nối từ hội thoại này.',
        code: 'RETURN_TO_INVALID',
      });
    });
  });

  describe('callback', () => {
    it('uses the injected durable bot client through createApp and stores the pairing before completion', async () => {
      const app = build({ botClient: new TelegramBotClient(mockBotConfig, fakeFetch, new TelegramUpdateRepo(db.pool)) });
      const start = await request(app).post('/api/connections/telegram/start')
        .set('Authorization', bearer(alice)).send({});
      const cookie = (start.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
      telegramUpdates = [{
        update_id: 501,
        message: {
          from: { id: 778899, is_bot: false, first_name: 'Alice' },
          chat: { id: 778899, type: 'private' }, text: `/start ati_${start.body.state}`,
        },
      }];
      const response = await request(app).post('/api/connections/telegram/callback')
        .set('Authorization', bearer(alice)).set('Cookie', cookie).send({ state: start.body.state });
      expect(response.status).toBe(200);
      const saved = await db.pool.query("SELECT payload FROM telegram_update_inbox WHERE payload->>'pairingStateHash'=$1", [hash(start.body.state)]);
      expect(saved.rows).toHaveLength(1);
      expect(saved.rows[0].payload.message.from.id).toBe(778899);
    });

    it('rejects invalid state or another user before making any HTTP call to Telegram', async () => {
      const app = build();
      const startRes = await request(app)
        .post('/api/connections/telegram/start')
        .set('Authorization', bearer(alice))
        .send({});
      const cookie = (startRes.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
      const state = startRes.body.state;

      // Bob tries to consume Alice's state
      const bobRes = await request(app)
        .post('/api/connections/telegram/callback')
        .set('Authorization', bearer(bob))
        .set('Cookie', cookie)
        .send({ state });

      expect(bobRes.status).toBe(400);
      expect(bobRes.body.code).toBe('TELEGRAM_STATE_INVALID');
      expect(fetchCalls).toEqual([]);
    });

    it('returns 409 TELEGRAM_PAIRING_PENDING when user has not pressed Start in Telegram yet, preserving state for retry, then succeeds once Start is pressed', async () => {
      const app = build();
      const aliceConv = await convRepo.createConversation(alice.id);

      const startRes = await request(app)
        .post('/api/connections/telegram/start')
        .set('Authorization', bearer(alice))
        .send({ returnTo: `/c/${aliceConv.id}` });
      const cookie = (startRes.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
      const state = startRes.body.state as string;

      // 1st attempt: user has not pressed Start in Telegram yet
      const pendingRes = await request(app)
        .post('/api/connections/telegram/callback')
        .set('Authorization', bearer(alice))
        .set('Cookie', cookie)
        .send({ state });

      expect(pendingRes.status).toBe(409);
      expect(pendingRes.body).toMatchObject({
        code: 'TELEGRAM_PAIRING_PENDING',
      });

      // Now user presses Start in Telegram
      telegramUpdates = [
        {
          update_id: 101,
          message: {
            message_id: 500,
            from: { id: 778899, is_bot: false, first_name: 'Alice', last_name: 'Nguyễn', username: 'alice_tg' },
            chat: { id: 778899, type: 'private', first_name: 'Alice', last_name: 'Nguyễn', username: 'alice_tg' },
            text: `/start ati_${state}`,
          },
        },
        {
          update_id: 102,
          my_chat_member: {
            chat: { id: -1001234567890, type: 'supergroup', title: 'Đội Sản Phẩm' },
            new_chat_member: { status: 'member' },
          },
        },
      ];

      // 2nd attempt with the exact same state succeeds!
      const okRes = await request(app)
        .post('/api/connections/telegram/callback')
        .set('Authorization', bearer(alice))
        .set('Cookie', cookie)
        .send({ state });

      expect(okRes.status).toBe(200);
      expect(okRes.body).toMatchObject({
        username: 'alice_tg',
        telegramUserId: '778899',
        displayName: 'Alice Nguyễn',
        returnTo: `/c/${aliceConv.id}`,
      });
      expect(okRes.body.chats).toEqual([
        { chatId: '778899', title: 'Telegram của tôi (Alice Nguyễn)', type: 'private', selected: true, member: true },
        { chatId: '-1001234567890', title: 'Đội Sản Phẩm', type: 'supergroup', selected: true, member: true },
      ]);
      expect(changed).toContain(alice.id);

      // Verify stored personal credential is active and encrypted
      const stored = await credentials.getPersonalConnectionStatus('telegram', alice.id);
      expect(stored).not.toBeNull();
      expect(stored!.status).toBe('active');
      const decrypted = decryptCredentials<any>(stored!.config, key);
      expect(decrypted.telegramUserId).toBe('778899');
      expect(decrypted.username).toBe('alice_tg');
      expect(decrypted.selectedChats.map((c: any) => c.chatId)).toEqual(['778899', '-1001234567890']);

      // Replaying the consumed state now fails with 400 and makes 0 new HTTP calls
      const callsBeforeReplay = fetchCalls.length;
      const replayRes = await request(app)
        .post('/api/connections/telegram/callback')
        .set('Authorization', bearer(alice))
        .set('Cookie', cookie)
        .send({ state });
      expect(replayRes.status).toBe(400);
      expect(replayRes.body.code).toBe('TELEGRAM_STATE_INVALID');
      expect(fetchCalls).toHaveLength(callsBeforeReplay);
    });
  });

  describe('disconnect & status', () => {
    it('deletes only the caller credential and leaves another user intact', async () => {
      const app = build();
      await credentials.saveCredentials(
        'telegram',
        encryptCredentials(
          {
            telegramUserId: '778899',
            username: 'alice_tg',
            displayName: 'Alice',
            selectedChats: [{ chatId: '778899', title: 'Telegram của tôi (Alice)', type: 'private' }],
            knownChats: [{ chatId: '778899', title: 'Telegram của tôi (Alice)', type: 'private' }],
          },
          key,
        ),
        alice.id,
      );
      await credentials.saveCredentials(
        'telegram',
        encryptCredentials(
          {
            telegramUserId: '889900',
            username: 'bob_tg',
            displayName: 'Bob',
            selectedChats: [{ chatId: '889900', title: 'Telegram của tôi (Bob)', type: 'private' }],
            knownChats: [{ chatId: '889900', title: 'Telegram của tôi (Bob)', type: 'private' }],
          },
          key,
        ),
        bob.id,
      );

      const res = await request(app).delete('/api/connections/telegram').set('Authorization', bearer(alice));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });

      expect(await credentials.getPersonalConnectionStatus('telegram', alice.id)).toBeNull();
      expect(await credentials.getPersonalConnectionStatus('telegram', bob.id)).not.toBeNull();
    });
  });
});
