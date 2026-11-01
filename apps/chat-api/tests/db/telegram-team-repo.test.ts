import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { TelegramTeamRepo } from '../../src/db/repositories/telegram-team-repo.js';
import { GoogleAuthRepo } from '../../src/db/repositories/google-auth-repo.js';

const directory = fileURLToPath(new URL('../../../../db/v3/', import.meta.url));
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

async function connectAdmin(): Promise<{ admin: pg.Pool; databaseUrl: string }> {
  const candidates = [
    process.env.DATABASE_URL,
    'postgresql://ati_v3:ati_v3_local_only@127.0.0.1:55533/ati_v3',
    'postgresql://ati_v3:ati_v3_local_only@127.0.0.1:56533/ati_v3',
  ].filter(Boolean) as string[];

  for (const url of candidates) {
    try {
      const p = new pg.Pool({ connectionString: url });
      await p.query('SELECT 1');
      return { admin: p, databaseUrl: url };
    } catch {
      // try next candidate
    }
  }
  throw new Error('Cannot connect to PostgreSQL on any candidate port (55533, 56533)');
}

describe('TelegramTeamRepo and GoogleAuthRepo.verifyState on PostgreSQL', () => {
  const schema = `telegram_team_repo_${randomUUID().replaceAll('-', '')}`;
  let admin: pg.Pool, pool: pg.Pool;
  let userId: string, sessionId: string;
  let teamRepo: TelegramTeamRepo;
  let googleAuthRepo: GoogleAuthRepo;

  beforeAll(async () => {
    const conn = await connectAdmin();
    admin = conn.admin;
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const url = new URL(conn.databaseUrl);
    url.searchParams.set('options', `-c search_path=${schema}`);
    pool = new pg.Pool({ connectionString: url.href });

    const files = (await readdir(directory)).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
    for (const f of files) {
      await pool.query(await readFile(`${directory}/${f}`, 'utf8'));
    }

    userId = (await pool.query("INSERT INTO users(email,password,name,status) VALUES('admin@example.test','hash','Admin','active') RETURNING id")).rows[0].id;
    sessionId = (
      await pool.query(
        "INSERT INTO auth_sessions(user_id,refresh_token_hash,expires_at) VALUES($1,'hash_session',now()+interval '1 day') RETURNING id",
        [userId],
      )
    ).rows[0].id;
    teamRepo = new TelegramTeamRepo(pool);
    googleAuthRepo = new GoogleAuthRepo(pool);
  });

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });

  it('returns null when no team scope is configured, and saves/replaces up to 10 team chats', async () => {
    expect(await teamRepo.get()).toBeNull();

    const saved = await teamRepo.replace({
      chosenBy: userId,
      chats: [
        { chatId: '-100111222333', title: 'Đội Sản Phẩm', type: 'supergroup' },
        { chatId: '-100444555666', title: 'Kỹ thuật ATI', type: 'group' },
      ],
    });
    expect(saved).toEqual({
      chosenBy: userId,
      chats: [
        { chatId: '-100111222333', title: 'Đội Sản Phẩm', type: 'supergroup' },
        { chatId: '-100444555666', title: 'Kỹ thuật ATI', type: 'group' },
      ],
    });
    expect(await teamRepo.get()).toEqual(saved);

    // Rejects > 10 chats without mutating existing chats
    const eleven = Array.from({ length: 11 }, (_, idx) => ({
      chatId: `-100999000${idx + 1}`,
      title: `Nhóm ${idx + 1}`,
      type: 'supergroup' as const,
    }));
    await expect(teamRepo.replace({ chosenBy: userId, chats: eleven })).rejects.toThrow();
    expect(await teamRepo.get()).toEqual(saved);
  });

  it('verifyState validates state, browser binding, user, and session without consuming used_at until consumeState', async () => {
    const now = Date.now();
    const rawState = 'state_token_for_telegram_pairing_test_12345';
    const rawBinding = 'browser_binding_for_telegram_pairing_123456';

    await googleAuthRepo.createState(
      {
        state_hash: sha256(rawState),
        browser_binding_hash: sha256(rawBinding),
        code_verifier: 'unused',
        nonce: 'unused',
        mode: 'connect_telegram',
        user_id: userId,
        session_id: sessionId,
        return_to: `/c/${randomUUID()}`,
      },
      now,
    );

    // Wrong binding or wrong user returns null
    expect(await googleAuthRepo.verifyState(rawState, 'wrong-binding', now + 1000, ['connect_telegram'], userId, sessionId)).toBeNull();
    expect(await googleAuthRepo.verifyState(rawState, rawBinding, now + 1000, ['connect_telegram'], randomUUID(), sessionId)).toBeNull();

    // Valid verifyState returns state without setting used_at
    const verified1 = await googleAuthRepo.verifyState(rawState, rawBinding, now + 1000, ['connect_telegram'], userId, sessionId);
    expect(verified1).toMatchObject({ mode: 'connect_telegram', user_id: userId, session_id: sessionId });

    // Second verifyState still succeeds (state was not consumed when pairing was pending)
    const verified2 = await googleAuthRepo.verifyState(rawState, rawBinding, now + 2000, ['connect_telegram'], userId, sessionId);
    expect(verified2).toMatchObject({ mode: 'connect_telegram', user_id: userId, session_id: sessionId });

    // consumeState consumes atomically once
    const consumed = await googleAuthRepo.consumeState(rawState, rawBinding, now + 3000, ['connect_telegram'], userId, sessionId);
    expect(consumed).toMatchObject({ mode: 'connect_telegram', user_id: userId });

    // Subsequent verifyState or consumeState returns null
    expect(await googleAuthRepo.verifyState(rawState, rawBinding, now + 4000, ['connect_telegram'], userId, sessionId)).toBeNull();
    expect(await googleAuthRepo.consumeState(rawState, rawBinding, now + 4000, ['connect_telegram'], userId, sessionId)).toBeNull();
  });
});
