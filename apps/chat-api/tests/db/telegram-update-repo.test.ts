import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encryptCredentials } from '@wap/tool-adapters';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { TelegramUpdateRepo } from '../../src/db/repositories/telegram-update-repo.js';
import { AdapterFactory } from '../../src/services/adapter-factory.js';
import { TelegramBotClient } from '../../src/services/telegram/bot-client.js';

const config = {
  botToken: '123456789:fixture_only_telegram_token', botUsername: 'AtiFixtureBot',
  callbackUrl: 'http://127.0.0.1:5174/connections/telegram/callback',
  apiBaseUrl: 'http://127.0.0.1:45123', deepLinkBaseUrl: 'http://127.0.0.1:45124',
};

describe('Durable Telegram update inbox on PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  beforeAll(async () => { db = await createMigratedSchema('telegram_updates'); });
  afterAll(async () => { await db?.close(); });

  it('retains both users across pages, concurrent callbacks and a new client instance', async () => {
    const alice = 'a'.repeat(43), bob = 'b'.repeat(43);
    const updates = Array.from({ length: 101 }, (_, index) => ({
      update_id: index + 1,
      message: {
        from: { id: index === 100 ? 222 : 111, is_bot: false, first_name: index === 100 ? 'Bob' : 'Alice' },
        chat: { id: index === 100 ? 222 : 111, type: 'private' },
        text: index === 0 ? `/start ati_${alice}` : index === 100 ? `/start ati_${bob}` : 'DO_NOT_PERSIST_ORDINARY_MESSAGE',
      },
    }));
    const offsets: Array<number | undefined> = [];
    const fetchFn: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      offsets.push(body.offset);
      return Response.json({ ok: true, result: updates.filter(u => body.offset === undefined || u.update_id >= body.offset).slice(0, body.limit) });
    };
    const first = new TelegramBotClient(config, fetchFn, new TelegramUpdateRepo(db.pool));
    await first.verifyPairing(bob, AbortSignal.timeout(5000));
    const restarted = new TelegramBotClient(config, fetchFn, new TelegramUpdateRepo(db.pool));
    const [aliceResult, bobResult] = await Promise.all([
      restarted.verifyPairing(alice, AbortSignal.timeout(5000)),
      first.verifyPairing(bob, AbortSignal.timeout(5000)),
    ]);
    expect(aliceResult).toMatchObject({ matched: true, telegramUserId: '111' });
    expect(bobResult).toMatchObject({ matched: true, telegramUserId: '222' });
    expect(offsets).toEqual([undefined, 101, 102]);
    const persisted = JSON.stringify((await db.pool.query('SELECT payload FROM telegram_update_inbox')).rows);
    expect(persisted).not.toContain('DO_NOT_PERSIST_ORDINARY_MESSAGE');
    expect(persisted).not.toContain(alice);
    expect(persisted).not.toContain(bob);
    expect(persisted).toContain('Bob');
  });

  it('does not advance a committed cursor when the poll aborts after receiving its batch', async () => {
    const store = new TelegramUpdateRepo(db.pool);
    const controller = new AbortController();
    await expect(store.poll('abort-fixture', controller.signal, async () => {
      controller.abort();
      return [{ update_id: 900, pairingStateHash: 'a'.repeat(64), message: { from: { id: 1 }, chat: { id: 1, type: 'private' } } }];
    })).rejects.toThrow();
    const nextOffsets: Array<number | undefined> = [];
    await store.poll('abort-fixture', AbortSignal.timeout(2000), async offset => { nextOffsets.push(offset); return []; });
    expect(nextOffsets).toEqual([undefined]);
    expect((await db.pool.query("SELECT * FROM telegram_update_inbox WHERE bot_key='abort-fixture'")).rows).toEqual([]);
  });

  it('retries an unpersisted batch at the same offset and retains the already acknowledged pairing', async () => {
    const store = new TelegramUpdateRepo(db.pool);
    const projected = (id: number) => ({ update_id: id, pairingStateHash: 'c'.repeat(64), message: { from: { id: 333 }, chat: { id: 333, type: 'private' } } });
    await store.poll('storage-failure', AbortSignal.timeout(2000), async () => [projected(201)]);
    await db.pool.query(`CREATE FUNCTION reject_telegram_batch() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.bot_key='storage-failure' AND NEW.update_id=202 THEN RAISE EXCEPTION 'fixture persistence failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER telegram_batch_failure BEFORE INSERT ON telegram_update_inbox FOR EACH ROW EXECUTE FUNCTION reject_telegram_batch()`);
    await expect(store.poll('storage-failure', AbortSignal.timeout(2000), async offset => {
      expect(offset).toBe(202);
      return [projected(202)];
    })).rejects.toThrow('fixture persistence failure');
    expect((await db.pool.query("SELECT next_update_id FROM telegram_update_cursors WHERE bot_key='storage-failure'")).rows[0].next_update_id).toBe('202');
    expect((await db.pool.query("SELECT update_id FROM telegram_update_inbox WHERE bot_key='storage-failure'")).rows).toEqual([{ update_id: '201' }]);
    await db.pool.query('DROP TRIGGER telegram_batch_failure ON telegram_update_inbox; DROP FUNCTION reject_telegram_batch()');
    const saved = await store.poll('storage-failure', AbortSignal.timeout(2000), async offset => {
      expect(offset).toBe(202);
      return [projected(202)];
    });
    expect(saved.map(update => update.update_id)).toEqual([201, 202]);
  });

  it('does not return expired receipts and prunes their persisted payloads', async () => {
    const store = new TelegramUpdateRepo(db.pool);
    await store.poll('expired-fixture', AbortSignal.timeout(2000), async () => [{
      update_id: 1, pairingStateHash: 'd'.repeat(64), message: { from: { id: 444 }, chat: { id: 444, type: 'private' } },
    }]);
    await db.pool.query("UPDATE telegram_update_inbox SET expires_at=now()-interval '1 second' WHERE bot_key='expired-fixture'");
    expect(await store.poll('expired-fixture', AbortSignal.timeout(2000), async () => [])).toEqual([]);
    expect((await db.pool.query("SELECT * FROM telegram_update_inbox WHERE bot_key='expired-fixture'")).rows).toEqual([]);
  });

  it('recovers a lower update ID after a week of inactivity without acknowledging the new pairing', async () => {
    const stale = new Date(Date.now() - 8 * 24 * 60 * 60_000);
    await db.pool.query('INSERT INTO telegram_update_cursors(bot_key,next_update_id,updated_at) VALUES($1,$2,$3)', ['idle-bot', 1_000_000_001, stale]);
    await db.pool.query(
      'INSERT INTO telegram_update_inbox(bot_key,update_id,payload,expires_at) VALUES($1,101,$2,$3)',
      ['idle-bot', JSON.stringify({ update_id: 101, pairingStateHash: 'expired', message: {} }), stale],
    );
    let queue = [{ update_id: 101, pairingStateHash: 'new-pairing', message: { from: { id: 555 }, chat: { id: 555, type: 'private' } } }];
    const offsets: Array<number | undefined> = [];
    const saved = await new TelegramUpdateRepo(db.pool).poll('idle-bot', AbortSignal.timeout(2000), async offset => {
      offsets.push(offset);
      if (offset !== undefined) queue = queue.filter(update => update.update_id >= offset);
      return queue;
    });
    expect(offsets).toEqual([undefined]);
    expect(saved).toEqual([{ update_id: 101, pairingStateHash: 'new-pairing', message: { from: { id: 555 }, chat: { id: 555, type: 'private' } } }]);
    expect((await db.pool.query("SELECT next_update_id FROM telegram_update_cursors WHERE bot_key='idle-bot'")).rows[0].next_update_id).toBe('102');
  });

  it('keeps the last received update timestamp across empty polls', async () => {
    const lastUpdate = new Date(Date.now() - 2 * 24 * 60 * 60_000);
    await db.pool.query('INSERT INTO telegram_update_cursors(bot_key,next_update_id,updated_at) VALUES($1,201,$2)', ['empty-poll-bot', lastUpdate]);
    await new TelegramUpdateRepo(db.pool).poll('empty-poll-bot', AbortSignal.timeout(2000), async () => []);
    expect((await db.pool.query("SELECT updated_at FROM telegram_update_cursors WHERE bot_key='empty-poll-bot'")).rows[0].updated_at.getTime()).toBe(lastUpdate.getTime());
  });

  it('shares cursor cleanly between verifyPairing, discoverGroups, and AdapterFactory read_messages with encrypted 100-message cache', async () => {
    const encryptionKey = '0123456789abcdef0123456789abcdef';
    const state = 'z'.repeat(43);
    const groupId = '-100888777666';
    const telegramUpdates: any[] = [
      {
        update_id: 1,
        message: {
          message_id: 10,
          date: 1791000100,
          from: { id: 777888, is_bot: false, first_name: 'Minh' },
          chat: { id: 777888, type: 'private' },
          text: `/start ati_${state}`,
        },
      },
      {
        update_id: 2,
        message: {
          message_id: 11,
          date: 1791000200,
          from: { id: 777888, is_bot: false, first_name: 'Minh', last_name: 'Le' },
          chat: { id: Number(groupId), title: 'San pham ATI', type: 'supergroup' },
          text: 'ORDINARY_GROUP_MESSAGE_BEFORE_PAIRING',
        },
      },
      {
        update_id: 3,
        edited_message: {
          message_id: 11,
          date: 1791000250,
          from: { id: 777888, is_bot: false, first_name: 'Minh', last_name: 'Le' },
          chat: { id: Number(groupId), title: 'San pham ATI', type: 'supergroup' },
          text: 'EDITED_GROUP_MESSAGE_BEFORE_PAIRING',
        },
      },
    ];

    const getUpdatesRequests: Array<{ offset?: number; allowed_updates?: string[] }> = [];
    const fetchFn: typeof fetch = async (url, init) => {
      const method = String(url).split('/').at(-1);
      const body = JSON.parse(String(init?.body ?? '{}'));
      if (method === 'getUpdates') {
        getUpdatesRequests.push({ offset: body.offset, allowed_updates: body.allowed_updates });
        const batch = telegramUpdates
          .filter((u) => body.offset === undefined || u.update_id >= body.offset)
          .slice(0, body.limit ?? 100);
        return Response.json({ ok: true, result: batch });
      }
      if (method === 'getChatMember') {
        return Response.json({ ok: true, result: { status: 'member' } });
      }
      if (method === 'getChat') {
        return Response.json({ ok: true, result: { id: Number(groupId), title: 'San pham ATI', type: 'supergroup' } });
      }
      return Response.json({ ok: false, error_code: 404 }, { status: 404 });
    };

    const isolatedConfig = {
      ...config,
      apiBaseUrl: 'http://127.0.0.1:45999',
    };
    const updateRepo = new TelegramUpdateRepo(db.pool, encryptionKey);
    const botClient = new TelegramBotClient(isolatedConfig, fetchFn, updateRepo);

    const paired = await botClient.verifyPairing(state, AbortSignal.timeout(5000));
    expect(paired).toMatchObject({ matched: true, telegramUserId: '777888' });
    expect(getUpdatesRequests[0]?.allowed_updates).toEqual(['message', 'edited_message', 'channel_post', 'my_chat_member']);

    // Simulate >100 ordinary messages arriving later before read_messages runs.
    for (let i = 0; i < 110; i++) {
      telegramUpdates.push({
        update_id: 4 + i,
        message: {
          message_id: 20 + i,
          date: 1791001000 + i,
          from: { id: 999, is_bot: false, username: 'qa_bot_tester' },
          chat: { id: Number(groupId), title: 'San pham ATI', type: 'supergroup' },
          text: `MSG_${String(i).padStart(3, '0')}`,
        },
      });
    }

    const groups = await botClient.discoverGroups(AbortSignal.timeout(5000));
    expect(groups).toContainEqual({ chatId: groupId, title: 'San pham ATI', type: 'supergroup' });

    const credRepo = new CredentialRepo(db.pool, encryptionKey);
    const user = await db.person('TelegramCoordinated');
    const savedCred = await credRepo.saveCredentials(
      'telegram',
      encryptCredentials(
        {
          telegramUserId: '777888',
          username: 'minhle',
          displayName: 'Minh Le',
          selectedChats: [{ chatId: groupId, title: 'San pham ATI', type: 'supergroup' }],
        },
        encryptionKey,
      ),
      user.id,
    );

    const factory = new AdapterFactory({
      credentialRepo: credRepo,
      encryptionKey,
      telegramBot: isolatedConfig,
      telegramBotClient: botClient,
      serviceFetchFn: fetchFn,
    });
    const adapter = await factory.getAdapterForService('telegram', {
      userId: user.id,
      phase: 'execution',
      connections: {
        telegram: {
          credentialId: savedCred.id,
          telegramUserId: '777888',
          username: 'minhle',
          chatIds: [groupId],
        },
      },
    });

    // Query specifically for message 11? Since 110 newer messages arrived and cache cap is 100 per chat, verify newest messages AND cap of 100!
    const newest = await adapter.execute('telegram.read_messages', { chatId: groupId, query: 'MSG_109', limit: 5 });
    expect(newest.messages).toHaveLength(1);
    expect(newest.messages[0]).toMatchObject({ messageId: 129, text: 'MSG_109' });

    // Verify telegram_chat_message_cache holds encrypted payloads ('v1:...') and is bounded at 100 rows per chat.
    const cacheRows = (
      await db.pool.query<{ payload: string }>(
        'SELECT payload FROM telegram_chat_message_cache WHERE chat_id = $1',
        [groupId],
      )
    ).rows;
    expect(cacheRows).toHaveLength(100);
    expect(cacheRows.every((r) => r.payload.startsWith('v1:'))).toBe(true);
    expect(JSON.stringify(cacheRows)).not.toContain('MSG_109');

    // Verify telegram_update_inbox NEVER persists ordinary message text or raw pairing state.
    const inboxRows = JSON.stringify((await db.pool.query('SELECT payload FROM telegram_update_inbox')).rows);
    expect(inboxRows).not.toContain('ORDINARY_GROUP_MESSAGE_BEFORE_PAIRING');
    expect(inboxRows).not.toContain('EDITED_GROUP_MESSAGE_BEFORE_PAIRING');
    expect(inboxRows).not.toContain('MSG_109');
    expect(inboxRows).not.toContain(state);

    // Offsets progressed monotonically without clobbering across verifyPairing -> discoverGroups -> readUpdatesForChat.
    expect(getUpdatesRequests.map((r) => r.offset)).toEqual([undefined, 4, 104]);

    // Edit earlier cached message (message_id 129) via edited_message in a subsequent update and verify overwrite + cursor 114.
    telegramUpdates.push({
      update_id: 114,
      edited_message: {
        message_id: 129,
        date: 1791002000,
        from: { id: 999, is_bot: false, username: 'qa_bot_tester' },
        chat: { id: Number(groupId), title: 'San pham ATI', type: 'supergroup' },
        text: 'MSG_109_EDITED',
      },
    });
    const edited = await adapter.execute('telegram.read_messages', { chatId: groupId, query: 'MSG_109_EDITED', limit: 5 });
    expect(edited.messages).toHaveLength(1);
    expect(edited.messages[0]).toMatchObject({ messageId: 129, text: 'MSG_109_EDITED' });
    expect(getUpdatesRequests.map((r) => r.offset)).toEqual([undefined, 4, 104, 114]);
  });
});
