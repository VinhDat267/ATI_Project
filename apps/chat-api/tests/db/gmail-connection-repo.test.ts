import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { GoogleAuthRepo } from '../../src/db/repositories/google-auth-repo.js';
import { GmailConnectionRepo } from '../../src/db/repositories/gmail-connection-repo.js';
import { UserRepo } from '../../src/db/repositories/user-repo.js';

const directory = fileURLToPath(new URL('../../../../db/v3/', import.meta.url));
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const token = () => randomUUID().replaceAll('-', '').padEnd(43, 'x');

describe('personal Gmail credentials and connect_gmail states on PostgreSQL', () => {
  const schema = `gmail_repo_${randomUUID().replaceAll('-', '')}`;
  let admin: pg.Pool, pool: pg.Pool, users: UserRepo, credentials: CredentialRepo, states: GoogleAuthRepo, gmail: GmailConnectionRepo;
  let alice: { id: string; sid: string }, bob: { id: string; sid: string };
  const person = async () => {
    const user = await users.createUser({ email: `${randomUUID()}@example.test`, name: 'Người dùng', password: 'Passw0rd!long-enough' });
    await pool.query("UPDATE users SET status='active', email_verified=true WHERE id=$1", [user.id]);
    return { id: user.id, sid: (await users.sessions.create(user.id, 'test')).sessionId };
  };
  const connectState = async (who: { id: string; sid: string }) => {
    const state = token(), browser = token();
    await states.createState({ state_hash: hash(state), browser_binding_hash: hash(browser), code_verifier: 'verifier', nonce: 'nonce',
      mode: 'connect_gmail', user_id: who.id, session_id: who.sid }, Date.now());
    return { state, browser };
  };

  beforeAll(async () => {
    const db = process.env.DATABASE_URL || 'postgresql://ati_v3:ati_v3_local_only@127.0.0.1:55533/ati_v3';
    admin = new pg.Pool({ connectionString: db }); await admin.query(`CREATE SCHEMA "${schema}"`);
    const url = new URL(db); url.searchParams.set('options', `-c search_path=${schema}`); pool = new pg.Pool({ connectionString: url.href, max: 8 });
    for (const f of (await readdir(directory)).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()) await pool.query(await readFile(`${directory}/${f}`, 'utf8'));
    users = new UserRepo(pool); credentials = new CredentialRepo(pool); states = new GoogleAuthRepo(pool); gmail = new GmailConnectionRepo(pool);
  });
  beforeEach(async () => {
    await pool.query("DELETE FROM service_credentials WHERE service='gmail'");
    alice = await person(); bob = await person();
  });
  afterAll(async () => { await pool?.end(); await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin?.end(); });

  describe('CredentialRepo personal reads', () => {
    it('requires a user id and never falls back to a shared credential', async () => {
      await expect(credentials.getPersonalCredentials('gmail', '')).rejects.toThrow('user id');
      await expect(credentials.getPersonalCredentials('gmail', undefined as any)).rejects.toThrow('user id');
      await expect(credentials.getPersonalConnectionStatus('gmail', '')).rejects.toThrow('user id');
      // Even with the owner constraint temporarily removed, a NULL-owner Gmail row is never returned.
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('ALTER TABLE service_credentials DROP CONSTRAINT service_credentials_gmail_owner_check');
        await client.query("INSERT INTO service_credentials(service,user_id,config) VALUES('gmail',NULL,'v1:shared-gmail')");
        const inTransaction = new CredentialRepo(client as unknown as pg.Pool);
        expect(await inTransaction.getPersonalCredentials('gmail', alice.id)).toBeNull();
        expect(await inTransaction.getPersonalConnectionStatus('gmail', alice.id)).toBeNull();
        expect((await inTransaction.getCredentials('gmail', alice.id))?.config).toBe('v1:shared-gmail');
      } finally {
        await client.query('ROLLBACK'); client.release();
      }
    });

    it("returns only the caller's own active credential; status reads any state", async () => {
      const own = await credentials.saveCredentials('gmail', 'v1:alice', alice.id);
      expect(own.status).toBe('active');
      expect((await credentials.getPersonalCredentials('gmail', alice.id))?.id).toBe(own.id);
      expect(await credentials.getPersonalCredentials('gmail', bob.id)).toBeNull();
      expect(await credentials.getPersonalConnectionStatus('gmail', bob.id)).toBeNull();

      expect(await credentials.markReconnectRequired('gmail', alice.id, randomUUID())).toBe(false);
      expect((await credentials.getPersonalCredentials('gmail', alice.id))?.id).toBe(own.id);
      expect(await credentials.markReconnectRequired('gmail', bob.id, own.id)).toBe(false);
      expect(await credentials.markReconnectRequired('gmail', alice.id, own.id)).toBe(true);
      expect(await credentials.getPersonalCredentials('gmail', alice.id)).toBeNull();
      const status = await credentials.getPersonalConnectionStatus('gmail', alice.id);
      expect(status).toMatchObject({ id: own.id, status: 'reconnect_required' });
      expect(status!.status_changed_at).toBeInstanceOf(Date);
    });

    it('does not flip a newer connection when an older credential id reports invalid_grant', async () => {
      const old = await credentials.saveCredentials('gmail', 'v1:old', alice.id);
      const fresh = await credentials.saveCredentials('gmail', 'v1:new', alice.id);
      expect(fresh.id).not.toBe(old.id);
      expect(await credentials.markReconnectRequired('gmail', alice.id, old.id)).toBe(false);
      expect((await credentials.getPersonalCredentials('gmail', alice.id))?.id).toBe(fresh.id);
    });
  });

  describe('connect_gmail state mode isolation', () => {
    it('is invisible to the login/link flows and only consumable by its own owner and session', async () => {
      const { state, browser } = await connectState(alice);
      expect(await states.findState(state, browser, Date.now(), ['login', 'link'])).toBeNull();
      expect(await states.consumeState(state, browser, Date.now(), ['login', 'link'], alice.id, alice.sid)).toBeNull();
      expect(await states.consumeState(state, browser, Date.now(), ['connect_gmail'], bob.id, bob.sid)).toBeNull();
      expect(await states.consumeState(state, browser, Date.now(), ['connect_gmail'], alice.id, randomUUID())).toBeNull();
      expect((await states.findState(state, browser, Date.now(), ['connect_gmail']))?.mode).toBe('connect_gmail');
      const consumed = await states.consumeState(state, browser, Date.now(), ['connect_gmail'], alice.id, alice.sid);
      expect(consumed).toMatchObject({ mode: 'connect_gmail', user_id: alice.id, session_id: alice.sid });
      expect(consumed!.id).toBeTruthy();
      expect(await states.consumeState(state, browser, Date.now(), ['connect_gmail'], alice.id, alice.sid)).toBeNull();
    });

    it('keeps login states out of the Gmail flow', async () => {
      const state = token(), browser = token();
      await states.createState({ state_hash: hash(state), browser_binding_hash: hash(browser), code_verifier: 'v', nonce: 'n', mode: 'login', user_id: null, session_id: null }, Date.now());
      expect(await states.findState(state, browser, Date.now(), ['connect_gmail'])).toBeNull();
      expect(await states.consumeState(state, browser, Date.now(), ['connect_gmail'], alice.id, alice.sid)).toBeNull();
      expect(await states.consumeState(state, browser, Date.now(), ['login', 'link'])).toMatchObject({ mode: 'login' });
    });
  });

  describe('GmailConnectionRepo', () => {
    const consume = async (who: { id: string; sid: string }) => {
      const { state, browser } = await connectState(who);
      return (await states.consumeState(state, browser, Date.now(), ['connect_gmail'], who.id, who.sid))!;
    };

    it('saves a new credential id for each connection, replacing the old one', async () => {
      const first = await gmail.saveConnection(alice.id, (await consume(alice)).id!, 'v1:first', Date.now());
      const second = await gmail.saveConnection(alice.id, (await consume(alice)).id!, 'v1:second', Date.now());
      expect(first?.id).toBeTruthy(); expect(second?.id).toBeTruthy(); expect(second!.id).not.toBe(first!.id);
      expect((await pool.query("SELECT config FROM service_credentials WHERE service='gmail' AND user_id=$1", [alice.id])).rows).toEqual([{ config: 'v1:second' }]);
    });

    it('does not recreate a connection from a callback that finishes after disconnect', async () => {
      await gmail.saveConnection(alice.id, (await consume(alice)).id!, 'v1:connected', Date.now());
      const inFlight = await consume(alice);
      const pending = await connectState(alice);
      const removed = await gmail.disconnect(alice.id);
      expect(removed?.config).toBe('v1:connected');
      expect(await gmail.saveConnection(alice.id, inFlight.id!, 'v1:late', Date.now())).toBeNull();
      expect(await states.consumeState(pending.state, pending.browser, Date.now(), ['connect_gmail'], alice.id, alice.sid)).toBeNull();
      expect(await credentials.getPersonalConnectionStatus('gmail', alice.id)).toBeNull();
      expect(await gmail.disconnect(alice.id)).toBeNull();
    });

    it('does not save after the session that started the flow logged out', async () => {
      const consumed = await consume(alice);
      await pool.query('UPDATE auth_sessions SET revoked_at=now() WHERE id=$1', [alice.sid]);
      expect(await gmail.saveConnection(alice.id, consumed.id!, 'v1:late', Date.now())).toBeNull();
      expect(await credentials.getPersonalConnectionStatus('gmail', alice.id)).toBeNull();
    });

    it('makes every other connect_gmail flow of the person unusable once one connection is saved', async () => {
      const older = await consume(alice);
      const newer = await consume(alice);
      const pending = await connectState(alice);
      expect(await gmail.saveConnection(alice.id, newer.id!, 'v1:newer', Date.now())).toBeTruthy();
      expect(await gmail.saveConnection(alice.id, older.id!, 'v1:older', Date.now())).toBeNull();
      expect(await states.consumeState(pending.state, pending.browser, Date.now(), ['connect_gmail'], alice.id, alice.sid)).toBeNull();
      expect((await credentials.getPersonalConnectionStatus('gmail', alice.id))?.config).toBe('v1:newer');
      // Bob's flows are untouched.
      const bobs = await consume(bob);
      expect(await gmail.saveConnection(bob.id, bobs.id!, 'v1:bob', Date.now())).toBeTruthy();
    });

    it('orders a logout committed during the save after that save, never between its check and insert', async () => {
      await gmail.saveConnection(alice.id, (await consume(alice)).id!, 'v1:existing', Date.now());
      const consumed = await consume(alice);
      const holder = await pool.connect();
      const logout = await pool.connect();
      try {
        // Hold the current credential row so the save stops at its DELETE, after its validity check.
        await holder.query('BEGIN');
        await holder.query("SELECT id FROM service_credentials WHERE service='gmail' AND user_id=$1 FOR UPDATE", [alice.id]);
        let savedAt = 0;
        const saving = gmail.saveConnection(alice.id, consumed.id!, 'v1:new', Date.now()).then((row) => { savedAt = performance.now(); return row; });
        const waitingPid = async () => (await pool.query(`SELECT pid FROM pg_stat_activity WHERE wait_event_type = 'Lock'
          AND query LIKE 'DELETE FROM service_credentials WHERE service = $1 AND user_id = $2%'`)).rows[0]?.pid;
        await vi.waitFor(async () => expect(await waitingPid()).toBeTruthy(), { timeout: 5_000, interval: 20 });
        let loggedOutAt = 0;
        const loggingOut = logout.query('UPDATE auth_sessions SET revoked_at = now() WHERE id = $1', [alice.sid]).then(() => { loggedOutAt = performance.now(); });
        await new Promise((resolve) => setTimeout(resolve, 400));
        await holder.query('ROLLBACK');
        const saved = await saving;
        await loggingOut;
        if (saved) {
          expect(loggedOutAt).toBeGreaterThan(savedAt);
          expect((await credentials.getPersonalConnectionStatus('gmail', alice.id))?.config).toBe('v1:new');
        } else {
          expect((await credentials.getPersonalConnectionStatus('gmail', alice.id))?.config).toBe('v1:existing');
        }
      } finally {
        holder.release(); logout.release();
      }
    });

    it("refuses a state that belongs to someone else", async () => {
      const bobs = await consume(bob);
      expect(await gmail.saveConnection(alice.id, bobs.id!, 'v1:stolen', Date.now())).toBeNull();
      expect(await credentials.getPersonalConnectionStatus('gmail', alice.id)).toBeNull();
    });
  });
});
