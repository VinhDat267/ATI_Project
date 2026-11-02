import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';
import { TelegramUpdateRepo } from '../../src/db/repositories/telegram-update-repo.js';
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
});
