import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encryptCredentials } from '@wap/tool-adapters';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { TelegramMessageRepo } from '../../src/db/repositories/telegram-message-repo.js';
import { TelegramUpdateRepo } from '../../src/db/repositories/telegram-update-repo.js';
import { loadActiveTelegramChatAllowlist } from '../../src/services/telegram/allowed-chats.js';
import { TelegramBotClient } from '../../src/services/telegram/bot-client.js';
import { AdapterFactory } from '../../src/services/adapter-factory.js';

const KEY = '0123456789abcdef0123456789abcdef';

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

  it('retains allowlisted chat messages across cursor-advancing polls and drops unapproved chats, /start, and token leaks', async () => {
    const member = await db.person('Member Retain');
    const outsider = await db.person('Outsider Reconnect');
    const credRepo = new CredentialRepo(db.pool, KEY);
    const msgRepo = new TelegramMessageRepo(db.pool);

    await credRepo.saveCredentials(
      'telegram',
      encryptCredentials(
        {
          telegramUserId: '777001',
          username: 'an',
          selectedChats: [{ chatId: '-100111', title: 'Nhóm Allowlist', type: 'supergroup' }],
        },
        KEY,
      ),
      member.id,
    );
    await credRepo.upsertPersonalCredentials({
      service: 'telegram',
      userId: outsider.id,
      status: 'reconnect_required',
      config: encryptCredentials(
        {
          telegramUserId: '888002',
          username: 'outsider',
          selectedChats: [{ chatId: '-100999', title: 'Nhóm Đã Thu Hồi', type: 'supergroup' }],
        },
        KEY,
      ),
    });

    const sentAt = Math.floor(Date.now() / 1000) - 60;
    let queue = [
      {
        update_id: 501,
        message: {
          message_id: 1,
          chat: { id: -100111, type: 'supergroup', title: 'Nhóm Allowlist' },
          from: { id: 777001, is_bot: false, first_name: 'An' },
          date: sentAt,
          text: 'Tin cần giữ lại',
        },
      },
      {
        update_id: 502,
        edited_message: {
          message_id: 1,
          chat: { id: -100111, type: 'supergroup', title: 'Nhóm Allowlist' },
          from: { id: 777001, is_bot: false, first_name: 'An' },
          date: sentAt,
          text: 'Tin cần giữ lại (đã sửa)',
        },
      },
      {
        update_id: 503,
        message: {
          message_id: 2,
          chat: { id: -100111, type: 'supergroup', title: 'Nhóm Allowlist' },
          from: { id: 777001, is_bot: false, first_name: 'An' },
          date: sentAt + 10,
          text: `/start ati_${'f'.repeat(43)}`,
        },
      },
      {
        update_id: 504,
        message: {
          message_id: 3,
          chat: { id: -100111, type: 'supergroup', title: 'Nhóm Allowlist' },
          from: { id: 777001, is_bot: false, first_name: 'An' },
          date: sentAt + 15,
          text: `leak ${config.botToken}`,
        },
      },
      {
        update_id: 505,
        message: {
          message_id: 4,
          chat: { id: -100999, type: 'supergroup', title: 'Nhóm Đã Thu Hồi' },
          from: { id: 888002, is_bot: false, first_name: 'Outsider' },
          date: sentAt + 20,
          text: 'Tin không được phép lưu',
        },
      },
    ];

    const fetchFn: typeof fetch = async (url, init) => {
      if (String(url).endsWith('/getChatMember')) {
        return Response.json({ ok: true, result: { status: 'member' } });
      }
      const body = JSON.parse(String(init?.body));
      if (body.offset !== undefined) {
        queue = queue.filter((u) => u.update_id >= body.offset);
      }
      return Response.json({ ok: true, result: queue.slice(0, body.limit) });
    };

    const client = new TelegramBotClient(
      config,
      fetchFn,
      new TelegramUpdateRepo(db.pool),
      {
        allowedChatIds: (txClient) => {
          if (!txClient) throw new Error('Allowlist must share the polling transaction');
          return loadActiveTelegramChatAllowlist(txClient, KEY);
        },
        messageStore: msgRepo,
      },
    );

    // Poll 1: simulates Settings / discovery poll consuming queue from Telegram
    await client.discoverGroups(AbortSignal.timeout(5000));
    // Poll 2: simulates another Settings/pairing poll with advancing offset (queue now empty)
    await client.pollUpdates(AbortSignal.timeout(5000));

    expect(await msgRepo.list(client.botKey, '-100111', 10)).toEqual([
      {
        chatId: '-100111',
        messageId: 1,
        senderName: 'An',
        text: 'Tin cần giữ lại (đã sửa)',
        date: sentAt,
      },
    ]);
    expect(await msgRepo.list(client.botKey, '-100999', 10)).toEqual([]);

    const inboxDump = JSON.stringify((await db.pool.query('SELECT payload FROM telegram_update_inbox')).rows);
    expect(inboxDump).not.toContain('Tin cần giữ lại');
    expect(inboxDump).not.toContain('Tin không được phép lưu');

    // End-to-end through AdapterFactory: even with Telegram getUpdates queue already acked, read_messages returns retained text
    const serviceFetchFn: typeof fetch = async (url) => {
      if (String(url).endsWith('/getUpdates')) {
        return fetchFn(url, { body: JSON.stringify({ limit: 100 }) } as any);
      }
      if (String(url).endsWith('/getChatMember')) {
        return Response.json({ ok: true, result: { status: 'member' } });
      }
      if (String(url).endsWith('/getChat')) {
        return Response.json({ ok: true, result: { id: -100111, title: 'Nhóm Allowlist', type: 'supergroup' } });
      }
      return Response.json({ ok: false, error_code: 404 }, { status: 404 });
    };
    const adapter = await new AdapterFactory({
      credentialRepo: credRepo,
      encryptionKey: KEY,
      telegramBot: config,
      telegramBotClient: client,
      telegramMessageStore: msgRepo,
      serviceFetchFn,
    }).getAdapterForService('telegram', { userId: member.id, phase: 'planning' });

    await msgRepo.upsertMany(client.botKey, Array.from({ length: 110 }, (_, i) => ({
      chatId: '-100111', messageId: i + 10, senderName: 'Other', text: 'Newer unrelated message', date: sentAt + 30,
    })));
    await msgRepo.upsertMany(client.botKey, [
      { chatId: '-100111', messageId: 130, senderName: 'Other', text: 'ΟΣ', date: sentAt + 30 },
    ]);
    const unicodeRead = await adapter.execute('telegram.read_messages', {
      chatId: '-100111', limit: 1, query: 'ος',
    });
    expect(unicodeRead.messages).toMatchObject([{ messageId: 130 }]);
    const readRes = await adapter.execute('telegram.read_messages', {
      chatId: '-100111', limit: 1, query: 'giu lai',
    });
    expect(readRes.messages).toEqual([
      {
        id: '1',
        messageId: 1,
        chatId: '-100111',
        senderName: 'An',
        text: 'Tin cần giữ lại (đã sửa)',
        date: sentAt,
      },
    ]);
  });
});
