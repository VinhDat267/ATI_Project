import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { SlackConnectionRepo } from '../../src/db/repositories/slack-connection-repo.js';
import {
  SlackInvalidationService,
  acquireSlackInvalidationLocks,
  slackInvalidationLockKeys,
} from '../../src/services/slack/slack-invalidation-service.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';
import type { SlackBinding } from '@wap/tool-schemas';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
describe('Slack workspace connections on PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>, repo: SlackConnectionRepo;
  beforeAll(async () => { db = await createMigratedSchema('slack_connections'); repo = new SlackConnectionRepo(db.pool); });
  afterAll(async () => { await db?.close(); });
  async function flow(person: { id: string; sid: string }) {
    const state = randomBytes(32).toString('base64url'), browser = randomBytes(32).toString('base64url');
    await repo.start({ userId: person.id, sessionId: person.sid, stateHash: hash(state), browserHash: hash(browser) });
    return { state, browser };
  }
  const input = (workspaceId: string) => ({ appId: 'A_APP', workspaceId, workspaceName: 'Same name', actorId: 'U_ONE', config: 'ENCRYPTED', scopes: ['chat:write'] });
  it('consumes state once, bound to owner/session/browser; stores only hashes', async () => {
    const a = await db.person(), b = await db.person(), f = await flow(a);
    expect(await repo.consume({ ...f, userId: b.id, sessionId: b.sid })).toBeNull();
    const results = await Promise.all([repo.consume({ ...f, userId: a.id, sessionId: a.sid }), repo.consume({ ...f, userId: a.id, sessionId: a.sid })]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(JSON.stringify((await db.pool.query('SELECT * FROM slack_oauth_states')).rows)).not.toContain(f.state);
  });
  it('preserves two workspaces, isolates owners, reconnect changes identity version', async () => {
    const a = await db.person(), b = await db.person();
    const save = async (who: typeof a, workspace: string) => { const f = await flow(who), s = await repo.consume({ ...f, userId: who.id, sessionId: who.sid }); return repo.save(who.id, s!.id, input(workspace)); };
    const first = await save(a, 'T_A'); await save(a, 'T_B');
    expect(await repo.list(a.id)).toHaveLength(2); expect(await repo.list(b.id)).toHaveLength(0);
    await expect(save(b, 'T_A')).rejects.toThrow('SLACK_IDENTITY_CONFLICT');
    const next = await save(a, 'T_A'); expect(next!.id).toBe(first!.id); expect(next!.identity_version).toBe(first!.identity_version + 1);
  });
  it('disconnect invalidates an exchange in flight; cannot resurrect connection', async () => {
    const a = await db.person(), f = await flow(a), state = await repo.consume({ ...f, userId: a.id, sessionId: a.sid });
    await repo.disconnect(a.id, '00000000-0000-4000-8000-000000000000');
    expect(await repo.save(a.id, state!.id, input('T_RACE'))).toBeNull();
    expect(await repo.list(a.id)).toHaveLength(0);
  });
  it('logout after code exchange prevents a save', async () => {
    const a = await db.person(), f = await flow(a), state = await repo.consume({ ...f, userId: a.id, sessionId: a.sid });
    await db.users.sessions.revoke(a.sid, a.id);
    expect(await repo.save(a.id, state!.id, input('T_LOGOUT'))).toBeNull();
  });
  it('allows two concurrent flows for different workspaces to both save successfully regardless of order', async () => {
    const a = await db.person();
    // Test order 1: s1 then s2
    const f1 = await flow(a);
    const f2 = await flow(a);
    const s1 = await repo.consume({ ...f1, userId: a.id, sessionId: a.sid });
    const s2 = await repo.consume({ ...f2, userId: a.id, sessionId: a.sid });
    expect(s1).toBeTruthy();
    expect(s2).toBeTruthy();
    const res1 = await repo.save(a.id, s1!.id, input('T_PARALLEL_1'));
    const res2 = await repo.save(a.id, s2!.id, input('T_PARALLEL_2'));
    expect(res1).toBeTruthy();
    expect(res2).toBeTruthy();
    expect(await repo.list(a.id)).toHaveLength(2);

    // Test reverse order: s4 (newer) saves before s3 (older) for different workspaces
    const b = await db.person();
    const f3 = await flow(b);
    const f4 = await flow(b);
    const s3 = await repo.consume({ ...f3, userId: b.id, sessionId: b.sid });
    const s4 = await repo.consume({ ...f4, userId: b.id, sessionId: b.sid });
    const res4 = await repo.save(b.id, s4!.id, input('T_REV_2'));
    const res3 = await repo.save(b.id, s3!.id, input('T_REV_1'));
    expect(res4).toBeTruthy();
    expect(res3).toBeTruthy();
    expect(await repo.list(b.id)).toHaveLength(2);
  });
  it('prevents an older flow from replacing identity applied by a newer flow for the same workspace, but allows newer flow to update older flow', async () => {
    const a = await db.person();
    const f1 = await flow(a); // older flow started first
    const f2 = await flow(a); // newer flow started second
    const s1 = await repo.consume({ ...f1, userId: a.id, sessionId: a.sid });
    const s2 = await repo.consume({ ...f2, userId: a.id, sessionId: a.sid });
    expect(s1).toBeTruthy();
    expect(s2).toBeTruthy();
    // Case A: Newer flow f2 finishes first and saves
    const resNewer = await repo.save(a.id, s2!.id, { ...input('T_SAME'), config: 'NEW_CONFIG_FROM_F2' });
    expect(resNewer).toBeTruthy();
    expect(resNewer!.config).toBe('NEW_CONFIG_FROM_F2');
    // Older flow f1 arrives later and attempts to save for the same workspace
    const resOlder = await repo.save(a.id, s1!.id, { ...input('T_SAME'), config: 'STALE_CONFIG_FROM_F1' });
    expect(resOlder).toBeNull();
    // Verify connection in database was not overwritten by f1
    let stored = (await repo.list(a.id)).find(r => r.workspace_id === 'T_SAME');
    expect(stored).toBeTruthy();
    expect(stored!.config).toBe('NEW_CONFIG_FROM_F2');

    // Case B: In a subsequent flow f3 (newer than f2), newer flow successfully updates connection
    const f3 = await flow(a);
    const s3 = await repo.consume({ ...f3, userId: a.id, sessionId: a.sid });
    const resLatest = await repo.save(a.id, s3!.id, { ...input('T_SAME'), config: 'LATEST_CONFIG_FROM_F3' });
    expect(resLatest).toBeTruthy();
    expect(resLatest!.config).toBe('LATEST_CONFIG_FROM_F3');
    expect(resLatest!.identity_version).toBe(resNewer!.identity_version + 1);
    stored = (await repo.list(a.id)).find(r => r.workspace_id === 'T_SAME');
    expect(stored!.config).toBe('LATEST_CONFIG_FROM_F3');
  });
  it('other ATI user cannot hijack active or reconnect_required identity and conflict does not auto-revoke victim', async () => {
    const a = await db.person(), b = await db.person();
    const fA = await flow(a);
    const sA = await repo.consume({ ...fA, userId: a.id, sessionId: a.sid });
    const connA = await repo.save(a.id, sA!.id, input('T_HIJACK_TARGET'));
    expect(connA).toBeTruthy();

    // Mark user A's connection as reconnect_required
    await db.pool.query("UPDATE slack_connections SET status='reconnect_required', config=NULL WHERE id=$1", [connA!.id]);
    const checkA = (await repo.list(a.id)).find(r => r.id === connA!.id);
    expect(checkA!.status).toBe('reconnect_required');

    // User B tries to connect with the same workspace actor
    const fB = await flow(b);
    const sB = await repo.consume({ ...fB, userId: b.id, sessionId: b.sid });
    await expect(repo.save(b.id, sB!.id, input('T_HIJACK_TARGET'))).rejects.toThrow('SLACK_IDENTITY_CONFLICT');

    // Verify user A's connection is intact and was NOT auto-revoked or deleted
    const victimAfter = (await repo.list(a.id)).find(r => r.id === connA!.id);
    expect(victimAfter).toBeTruthy();
    expect(victimAfter!.status).toBe('reconnect_required');
    expect(await repo.list(b.id)).toHaveLength(0);
  });
  it('disconnect takes invalidation locks before the connection row, matching the source-writer lock order', async () => {
    const a = await db.person();
    const f = await flow(a);
    const state = await repo.consume({ ...f, userId: a.id, sessionId: a.sid });
    const conn = await repo.save(a.id, state!.id, input('T_LOCK_ORDER'));
    expect(conn).toBeTruthy();
    const binding: SlackBinding = {
      atiUserId: conn!.user_id,
      connectionId: conn!.id,
      workspaceId: conn!.workspace_id,
      slackUserId: conn!.actor_id,
      identityVersion: conn!.identity_version,
    };

    const invalidation = new SlackInvalidationService(db.pool);
    let markStageEntered!: () => void;
    const stageEntered = new Promise<void>(resolve => { markStageEntered = resolve; });
    const originalStage = invalidation.stageInTransaction.bind(invalidation);
    invalidation.stageInTransaction = async (client, effectInput) => {
      markStageEntered();
      return originalStage(client, effectInput);
    };
    const observedRepo = new SlackConnectionRepo(db.pool, invalidation);

    // Hold the exact advisory lock a source writer takes before FOR SHARE on the connection
    // row. If disconnect updated the row before staging, this test's FOR SHARE would time out.
    const holder = await db.pool.connect();
    let committed = false;
    try {
      await holder.query('BEGIN');
      await holder.query("SET LOCAL lock_timeout = '1500ms'");
      await acquireSlackInvalidationLocks(
        holder,
        slackInvalidationLockKeys({ barrierType: 'binding', binding, reason: 'lock_order_hold' })
      );

      const disconnectPromise = observedRepo.disconnect(a.id, conn!.id);
      await stageEntered;
      await holder.query('SELECT id FROM slack_connections WHERE id=$1 FOR SHARE', [conn!.id]);
      await holder.query('COMMIT');
      committed = true;
      await disconnectPromise;
    } finally {
      if (!committed) {
        try { await holder.query('ROLLBACK'); } catch { /* connection may have errored */ }
      }
      holder.release();
    }

    const after = await db.pool.query(
      'SELECT status, identity_version FROM slack_connections WHERE id=$1',
      [conn!.id]
    );
    expect(after.rows[0].status).toBe('disconnected');
    expect(after.rows[0].identity_version).toBe(conn!.identity_version + 1);
    const barriers = await db.pool.query(
      'SELECT source_event_key, barrier_type FROM slack_invalidation_barriers WHERE connection_id=$1',
      [conn!.id]
    );
    expect(barriers.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source_event_key: `disconnect:${conn!.id}:${conn!.identity_version}`,
          barrier_type: 'binding',
        }),
      ])
    );
  });

  it('migration 0015 is idempotent and repeatable with real non-empty states and connections', async () => {
    const p = await db.person();
    // 1. Seed an existing saved connection
    const f = await flow(p);
    const s = await repo.consume({ ...f, userId: p.id, sessionId: p.sid });
    await repo.save(p.id, s!.id, input('T_MIGRATION'));

    // 2. Seed a real pending state that is NOT yet consumed/saved
    const pendingFlow = await flow(p);
    const pendingBefore = await db.pool.query("SELECT * FROM slack_oauth_states WHERE used_at IS NULL AND user_id=$1", [p.id]);
    expect(pendingBefore.rows.length).toBeGreaterThan(0);

    // 3. Read and execute the actual shipped migration file
    const migrationPath = fileURLToPath(new URL('../../../../db/v3/0015_slack_callback_order.sql', import.meta.url));
    const migration0015Sql = await readFile(migrationPath, 'utf8');

    // Repeat actual migration twice on non-empty schema with existing real rows
    await db.pool.query(migration0015Sql);
    await db.pool.query(migration0015Sql);

    // 4. Verify that the pending state survived the migration and can be consumed & saved
    const consumedPending = await repo.consume({ ...pendingFlow, userId: p.id, sessionId: p.sid });
    expect(consumedPending).toBeTruthy();
    const savedPending = await repo.save(p.id, consumedPending!.id, input('T_PENDING_AFTER_MIGRATION'));
    expect(savedPending).toBeTruthy();

    // 5. Verify system continues to operate properly for subsequent new flows
    const f2 = await flow(p);
    const s2 = await repo.consume({ ...f2, userId: p.id, sessionId: p.sid });
    const updated = await repo.save(p.id, s2!.id, input('T_MIGRATION'));
    expect(updated).toBeTruthy();
  });
});
