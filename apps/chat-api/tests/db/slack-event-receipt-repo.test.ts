import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';
import {
  SlackEventIdConflictError,
  SlackEventReceiptRepo,
  SlackOwnerLockBusyError,
  SlackStagingTimeoutError,
  slackEventSourceKey,
  slackMessageResourceId,
  type RecordLifecycleEventInput,
  type RecordOrdinaryEventInput,
  type SlackLifecycleDescriptor,
} from '../../src/db/repositories/slack-event-receipt-repo.js';
import { SlackInvalidationService } from '../../src/services/slack/slack-invalidation-service.js';

const APP_ID = 'A04A';
const TEAM_ID = 'T04A';
const SOURCE_TS = '1730214000.000100';
const SOURCE_TIME_ISO = '2024-10-29T15:00:00.000100Z';

function sha(label: string): string {
  return createHash('sha256').update(label).digest('hex');
}

function ordinary(overrides: Partial<RecordOrdinaryEventInput> = {}): RecordOrdinaryEventInput {
  return {
    appId: APP_ID,
    eventId: `Ev${randomUUID().replaceAll('-', '')}`,
    teamId: TEAM_ID,
    eventType: 'message',
    eventSubtype: null,
    eventContext: 'connect',
    sourceEventTs: SOURCE_TS,
    sourceEventTimeIso: SOURCE_TIME_ISO,
    channelId: 'C04A',
    messageTs: '1730214000.000100',
    payloadHash: sha(`payload-${randomUUID()}`),
    discardReason: null,
    ...overrides,
  };
}

function lifecycle(
  descriptor: SlackLifecycleDescriptor,
  overrides: Partial<RecordLifecycleEventInput> = {}
): RecordLifecycleEventInput {
  return {
    appId: APP_ID,
    eventId: `Ev${randomUUID().replaceAll('-', '')}`,
    teamId: TEAM_ID,
    eventType:
      descriptor.intentType === 'token_revocation_validation'
        ? 'tokens_revoked'
        : descriptor.intentType === 'app_uninstall_validation'
          ? 'app_uninstalled'
          : 'message',
    eventSubtype:
      descriptor.intentType === 'message_deleted'
        ? 'message_deleted'
        : descriptor.intentType === 'message_changed'
          ? 'message_changed'
          : null,
    eventContext: null,
    sourceEventTs: SOURCE_TS,
    sourceEventTimeIso: SOURCE_TIME_ISO,
    channelId: null,
    messageTs: null,
    payloadHash: sha(`payload-${randomUUID()}`),
    lifecycle: descriptor,
    ...overrides,
  };
}

describe('SlackEventReceiptRepo on PostgreSQL (SLACK-04A)', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  let invalidation: SlackInvalidationService;
  let repo: SlackEventReceiptRepo;

  beforeAll(async () => {
    db = await createMigratedSchema('slack_event_receipts');
    invalidation = new SlackInvalidationService(db.pool);
    repo = new SlackEventReceiptRepo(db.pool, invalidation);
  });

  afterAll(async () => {
    await db?.close();
  });

  async function seedConnection(
    options: {
      workspaceId?: string;
      actorId?: string;
      identityVersion?: number;
      status?: 'active' | 'reconnect_required';
      config?: string;
    } = {}
  ) {
    const person = await db.person('Thành viên Slack');
    const connectionId = randomUUID();
    const workspaceId = options.workspaceId ?? TEAM_ID;
    const actorId = options.actorId ?? `U${randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`;
    const identityVersion = options.identityVersion ?? 1;
    const status = options.status ?? 'active';
    const config = options.config ?? `ENCRYPTED_CONFIG_${randomUUID()}`;
    await db.pool.query(
      `INSERT INTO slack_connections (
         id, user_id, app_id, workspace_id, workspace_name, actor_id,
         identity_version, status, config, scopes, connected_at, last_state_order
       ) VALUES ($1, $2, $3, $4, '04A Workspace', $5, $6, $7, $8,
                 ARRAY['channels:history'], now(), '0001')`,
      [connectionId, person.id, APP_ID, workspaceId, actorId, identityVersion, status, config]
    );
    return { person, connectionId, workspaceId, actorId, identityVersion, config };
  }

  it('T1.1: records a body-free pending_fanout receipt with immutable routing metadata', async () => {
    const input = ordinary();
    const result = await repo.recordOrdinary(input);

    expect(result.kind).toBe('recorded');
    expect(result.receipt).toMatchObject({
      slack_app_id: APP_ID,
      event_id: input.eventId,
      team_id: TEAM_ID,
      event_type: 'message',
      event_subtype: null,
      source_event_ts: SOURCE_TS,
      event_context: 'connect',
      channel_id: 'C04A',
      message_ts: '1730214000.000100',
      status: 'pending_fanout',
      discard_reason: null,
      processed_at: null,
    });
    expect(result.receipt.source_event_time?.toISOString()).toBe('2024-10-29T15:00:00.000Z');

    const columns = await db.pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'slack_event_receipts'`
    );
    const names = columns.rows.map(row => row.column_name);
    for (const forbidden of ['text', 'blocks', 'body', 'raw_body', 'raw_payload']) {
      expect(names).not.toContain(forbidden);
    }

    const exact = await db.pool.query<{ exact: string }>(
      `SELECT to_char(source_event_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS exact
       FROM slack_event_receipts WHERE id = $1`,
      [result.receipt.id]
    );
    expect(exact.rows[0]?.exact).toBe(SOURCE_TIME_ISO);
  });

  it('T1.1b: event_context stays opaque, is preserved exactly, and has only a transport bound', async () => {
    const opaque = `Ctx 🔒 / tenant?x=1&y=two ${'z'.repeat(900)}`;
    const recorded = await repo.recordOrdinary(ordinary({ eventContext: opaque }));
    expect(recorded.receipt.event_context).toBe(opaque);

    const absent = await repo.recordOrdinary(ordinary({ eventContext: null }));
    expect(absent.receipt.event_context).toBeNull();

    await expect(repo.recordOrdinary(ordinary({ eventContext: 'x'.repeat(1025) }))).rejects.toBeInstanceOf(
      TypeError
    );
  });

  it('T1.2: a duplicate event id is idempotent but a different payload is a conflict', async () => {
    const input = ordinary();
    const first = await repo.recordOrdinary(input);
    const second = await repo.recordOrdinary(input);

    expect(second.kind).toBe('duplicate');
    expect(second.receipt.id).toBe(first.receipt.id);
    const count = await db.pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM slack_event_receipts WHERE slack_app_id = $1 AND event_id = $2',
      [APP_ID, input.eventId]
    );
    expect(count.rows[0]?.n).toBe('1');

    await expect(
      repo.recordOrdinary({ ...input, payloadHash: sha('tampered-payload') })
    ).rejects.toBeInstanceOf(SlackEventIdConflictError);
    const after = await db.pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM slack_event_receipts WHERE slack_app_id = $1 AND event_id = $2',
      [APP_ID, input.eventId]
    );
    expect(after.rows[0]?.n).toBe('1');
  });

  it('T1.3: ten concurrent duplicate deliveries create exactly one receipt', async () => {
    const input = ordinary();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => repo.recordOrdinary(input))
    );
    expect(results.filter(result => result.kind === 'recorded')).toHaveLength(1);
    expect(results.filter(result => result.kind === 'duplicate')).toHaveLength(9);
    expect(new Set(results.map(result => result.receipt.id)).size).toBe(1);

    const count = await db.pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM slack_event_receipts WHERE slack_app_id = $1 AND event_id = $2',
      [APP_ID, input.eventId]
    );
    expect(count.rows[0]?.n).toBe('1');
  });

  it('T1.4: a real lock-timeout rolls back receipt, intent, barrier and connection state', async () => {
    const connection = await seedConnection({ actorId: 'UREVOKED1' });
    const input = lifecycle({ intentType: 'token_revocation_validation', slackUserIds: ['UREVOKED1'] });
    const sourceEventKey = slackEventSourceKey(input.appId, input.eventId);
    const eventLockKey = `slack:v1:event:${JSON.stringify([sourceEventKey])}`;

    const holder = await db.pool.connect();
    const fastRepo = new SlackEventReceiptRepo(db.pool, invalidation, { lockTimeoutMs: 120 });
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [eventLockKey]);

      const started = Date.now();
      await expect(fastRepo.recordLifecycle(input)).rejects.toBeInstanceOf(SlackStagingTimeoutError);
      expect(Date.now() - started).toBeLessThan(1500);
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
    }

    const receipts = await db.pool.query('SELECT 1 FROM slack_event_receipts WHERE event_id = $1', [input.eventId]);
    expect(receipts.rowCount).toBe(0);
    const barriers = await db.pool.query('SELECT 1 FROM slack_invalidation_barriers WHERE source_event_key = $1', [sourceEventKey]);
    expect(barriers.rowCount).toBe(0);
    const intents = await db.pool.query('SELECT 1 FROM slack_lifecycle_intents WHERE receipt_id IS NOT NULL AND intent_type = $1', ['token_revocation_validation']);
    expect(intents.rowCount).toBe(0);
    const row = await db.pool.query<{ status: string; config: string }>(
      'SELECT status, config FROM slack_connections WHERE id = $1',
      [connection.connectionId]
    );
    expect(row.rows[0]).toEqual({ status: 'active', config: connection.config });
  });

  it('T1.5: one tokens_revoked event stages a provisional barrier and intent per binding generation', async () => {
    const a = await seedConnection({ actorId: 'U_MULTI_A' });
    const b = await seedConnection({ actorId: 'U_MULTI_B' });
    const untouched = await seedConnection({ actorId: 'U_MULTI_UNTOUCHED' });
    const input = lifecycle({
      intentType: 'token_revocation_validation',
      slackUserIds: ['U_MULTI_A', 'U_MULTI_B', 'U_NOT_LOCAL'],
    });

    const result = await repo.recordLifecycle(input);
    expect(result.kind).toBe('recorded');
    expect(result.receipt.status).toBe('pending_lifecycle');
    expect(result.intents).toHaveLength(2);
    expect(new Set(result.intents.map(intent => intent.effect_key)).size).toBe(2);
    expect(result.intents.every(intent => intent.intent_type === 'token_revocation_validation')).toBe(true);

    const barriers = await db.pool.query(
      `SELECT barrier_type, provisional, user_id, connection_id, identity_version,
              credential_fingerprint, active, reason
       FROM slack_invalidation_barriers WHERE source_event_key = $1 ORDER BY connection_id`,
      [slackEventSourceKey(input.appId, input.eventId)]
    );
    expect(barriers.rowCount).toBe(2);
    for (const row of barriers.rows) {
      expect(row.barrier_type).toBe('provisional_auth');
      expect(row.provisional).toBe(true);
      expect(row.active).toBe(true);
      expect(row.identity_version).toBe(1);
      expect(row.credential_fingerprint).toMatch(/^[0-9a-f]{64}$/);
    }
    const fingerprints = new Set(barriers.rows.map(row => row.credential_fingerprint));
    expect(fingerprints).toEqual(new Set([sha(a.config), sha(b.config)]));

    const connections = await db.pool.query<{ id: string; status: string; config: string }>(
      'SELECT id, status, config FROM slack_connections ORDER BY id'
    );
    const byId = new Map(connections.rows.map(row => [row.id, row]));
    expect(byId.get(a.connectionId)).toEqual({ id: a.connectionId, status: 'reconnect_required', config: a.config });
    expect(byId.get(b.connectionId)).toEqual({ id: b.connectionId, status: 'reconnect_required', config: b.config });
    expect(byId.get(untouched.connectionId)).toEqual({ id: untouched.connectionId, status: 'active', config: untouched.config });

    const staged = await db.pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM slack_invalidation_receipts WHERE source_event_key = $1',
      [slackEventSourceKey(input.appId, input.eventId)]
    );
    expect(staged.rows[0]?.n).toBe('1');
  });

  it.each(['app_uninstall_validation', 'token_revocation_validation'] as const)(
    '%s: a credentialless generation cannot prevent healthy bindings being fenced', async intentType => {
      const workspaceId = `T_NULL_${intentType}`;
      const unusable = await seedConnection({ workspaceId, actorId: 'U_NO_CONFIG', status: 'reconnect_required' });
      await db.pool.query('UPDATE slack_connections SET config=NULL WHERE id=$1', [unusable.connectionId]);
      const healthy = await seedConnection({ workspaceId, actorId: 'U_HAS_CONFIG' });
      const input = lifecycle(intentType === 'app_uninstall_validation'
        ? { intentType }
        : { intentType, slackUserIds: [unusable.actorId, healthy.actorId] }, { teamId: workspaceId });
      const result = await repo.recordLifecycle(input);
      expect(result.kind).toBe('recorded');
      expect(result.intents).toHaveLength(1);
      expect(result.intents[0]!.payload).toMatchObject({ binding: { connectionId: healthy.connectionId } });
      const barriers = await db.pool.query(
        'SELECT connection_id, barrier_type, active FROM slack_invalidation_barriers WHERE source_event_key=$1',
        [slackEventSourceKey(APP_ID, input.eventId)]
      );
      expect(barriers.rows).toEqual(expect.arrayContaining([
        { connection_id: healthy.connectionId, barrier_type: 'provisional_auth', active: true },
        { connection_id: unusable.connectionId, barrier_type: 'binding', active: true },
      ]));
      const targets = await db.pool.query(
        'SELECT purge_target FROM slack_invalidation_intents WHERE source_event_key=$1',
        [slackEventSourceKey(APP_ID, input.eventId)]
      );
      expect(targets.rowCount).toBe(8);
      expect(targets.rows.every(row => row.purge_target.binding.connectionId === unusable.connectionId)).toBe(true);
      const unchanged = await db.pool.query('SELECT status, config, identity_version FROM slack_connections WHERE id=$1',
        [unusable.connectionId]);
      expect(unchanged.rows[0]).toEqual({ status: 'reconnect_required', config: null, identity_version: 1 });
      expect((await db.pool.query('SELECT status FROM slack_connections WHERE id=$1',
        [healthy.connectionId])).rows[0].status).toBe('reconnect_required');
      expect((await repo.recordLifecycle(input)).kind).toBe('duplicate');
      // A subsequent OAuth grant has a new generation; the old local authority loss
      // must never poison its scope or trigger an auth.test against its new credential.
      await db.pool.query("UPDATE slack_connections SET identity_version=2, config='NEW_GRANT', status='active' WHERE id=$1",
        [unusable.connectionId]);
      const binding = { atiUserId: unusable.person.id, connectionId: unusable.connectionId,
        workspaceId, slackUserId: unusable.actorId, identityVersion: 1 };
      expect((await invalidation.checkBarriers({ binding })).blocked).toBe(true);
      expect((await invalidation.checkBarriers({ binding: { ...binding, identityVersion: 2 } })).blocked).toBe(false);
    }
  );

  it('T1.6: a duplicate lifecycle delivery adds no second intent or barrier', async () => {
    const connection = await seedConnection({ actorId: 'U_DUP_LIFECYCLE' });
    const input = lifecycle({
      intentType: 'token_revocation_validation',
      slackUserIds: ['U_DUP_LIFECYCLE'],
    });
    const first = await repo.recordLifecycle(input);
    const second = await repo.recordLifecycle(input);

    expect(second.kind).toBe('duplicate');
    expect(second.receipt.id).toBe(first.receipt.id);
    const intents = await db.pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM slack_lifecycle_intents WHERE receipt_id = $1',
      [first.receipt.id]
    );
    expect(intents.rows[0]?.n).toBe('1');
    const barriers = await db.pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM slack_invalidation_barriers WHERE source_event_key = $1',
      [slackEventSourceKey(input.appId, input.eventId)]
    );
    expect(barriers.rows[0]?.n).toBe('1');
    const connectionRow = await db.pool.query<{ status: string; config: string }>(
      'SELECT status, config FROM slack_connections WHERE id = $1',
      [connection.connectionId]
    );
    expect(connectionRow.rows[0]).toEqual({ status: 'reconnect_required', config: connection.config });

    await expect(
      repo.recordLifecycle({ ...input, payloadHash: sha('different-lifecycle-payload') })
    ).rejects.toBeInstanceOf(SlackEventIdConflictError);
  });

  it('T1.7: deleted is permanent, edit watermarks old revisions, and a late edit cannot resurrect', async () => {
    const deleted = lifecycle(
      {
        intentType: 'message_deleted',
        channelId: 'C04A',
        deletedTs: '1730215000.000200',
      },
      { eventType: 'message', eventSubtype: 'message_deleted', channelId: 'C04A', messageTs: '1730215000.000200' }
    );
    const deletedResult = await repo.recordLifecycle(deleted);
    expect(deletedResult.kind).toBe('recorded');
    const deletedBarrier = await db.pool.query(
      `SELECT barrier_type, resource_type, resource_id, deleted, min_valid_revision, reason
       FROM slack_invalidation_barriers WHERE source_event_key = $1`,
      [slackEventSourceKey(APP_ID, deleted.eventId)]
    );
    expect(deletedBarrier.rows[0]).toMatchObject({
      barrier_type: 'resource',
      resource_type: 'message',
      resource_id: slackMessageResourceId('C04A', '1730215000.000200'),
      deleted: true,
      min_valid_revision: null,
      reason: 'source_deleted',
    });
    const deletedIntent = await db.pool.query<{ payload_json: Record<string, unknown> }>(
      'SELECT payload_json FROM slack_lifecycle_intents WHERE receipt_id = $1',
      [deletedResult.receipt.id]
    );
    expect(deletedIntent.rows[0]?.payload_json).toMatchObject({
      intentType: 'message_deleted',
      channelId: 'C04A',
      messageTs: '1730215000.000200',
      deletedTs: '1730215000.000200',
    });

    const changed = lifecycle(
      {
        intentType: 'message_changed',
        channelId: 'C04A',
        messageTs: '1730216000.000300',
        editTs: '1730217000.000400',
      },
      { eventType: 'message', eventSubtype: 'message_changed', channelId: 'C04A', messageTs: '1730216000.000300' }
    );
    await repo.recordLifecycle(changed);
    const changedBarrier = await db.pool.query(
      `SELECT deleted, min_valid_revision, reason FROM slack_invalidation_barriers
       WHERE source_event_key = $1`,
      [slackEventSourceKey(APP_ID, changed.eventId)]
    );
    expect(changedBarrier.rows[0]).toMatchObject({
      deleted: false,
      min_valid_revision: '1730217000.000400',
      reason: 'source_edited',
    });

    const oldRevision = await invalidation.checkBarriers({
      workspaceId: TEAM_ID,
      resourceType: 'message',
      resourceId: slackMessageResourceId('C04A', '1730216000.000300'),
      revision: '1730216500.000350',
    });
    expect(oldRevision.blocked).toBe(true);
    const newRevision = await invalidation.checkBarriers({
      workspaceId: TEAM_ID,
      resourceType: 'message',
      resourceId: slackMessageResourceId('C04A', '1730216000.000300'),
      revision: '1730217000.000400',
    });
    expect(newRevision.blocked).toBe(false);

    const lateEdit = lifecycle(
      {
        intentType: 'message_changed',
        channelId: 'C04A',
        messageTs: '1730215000.000200',
        editTs: '1730219000.000500',
      },
      { eventType: 'message', eventSubtype: 'message_changed', channelId: 'C04A', messageTs: '1730215000.000200' }
    );
    await repo.recordLifecycle(lateEdit);
    const resurrect = await invalidation.checkBarriers({
      workspaceId: TEAM_ID,
      resourceType: 'message',
      resourceId: slackMessageResourceId('C04A', '1730215000.000200'),
      revision: '1730219000.000500',
    });
    expect(resurrect).toMatchObject({ blocked: true, barrierType: 'resource' });
  });

  it('T1.7b: message identity is a [channelId, messageTs] tuple; equal ts in another channel/workspace is isolated', async () => {
    const ts = '1730218500.000650';
    const deleted = lifecycle(
      { intentType: 'message_deleted', channelId: 'C_TUPLE_A', deletedTs: ts },
      { eventType: 'message', eventSubtype: 'message_deleted' }
    );
    await repo.recordLifecycle(deleted);

    const barriers = await db.pool.query<{ resource_id: string; workspace_id: string }>(
      `SELECT resource_id, workspace_id FROM slack_invalidation_barriers
       WHERE source_event_key = $1`,
      [slackEventSourceKey(APP_ID, deleted.eventId)]
    );
    expect(barriers.rows[0]).toEqual({
      resource_id: JSON.stringify(['C_TUPLE_A', ts]),
      workspace_id: TEAM_ID,
    });

    const sameChannel = await invalidation.checkBarriers({
      workspaceId: TEAM_ID,
      resourceType: 'message',
      resourceId: slackMessageResourceId('C_TUPLE_A', ts),
      revision: ts,
    });
    expect(sameChannel.blocked).toBe(true);

    // Equal timestamp in a different channel and in a different workspace must not inherit the
    // deletion, and the legacy underscore concatenation is not the identity representation.
    for (const [workspaceId, resourceId] of [
      [TEAM_ID, slackMessageResourceId('C_TUPLE_B', ts)],
      ['T04A_OTHER_WORKSPACE', slackMessageResourceId('C_TUPLE_A', ts)],
      [TEAM_ID, `C_TUPLE_A_${ts}`],
    ] as const) {
      const untouched = await invalidation.checkBarriers({
        workspaceId,
        resourceType: 'message',
        resourceId,
        revision: '9999999999.999999',
      });
      expect(untouched.blocked).toBe(false);
    }
  });

  it('T1.8: cleanup removes expired receipts after lifecycle work finishes and keeps barriers', async () => {
    const oldOrdinary = await repo.recordOrdinary(ordinary());
    const oldLifecycle = await repo.recordLifecycle(
      lifecycle({ intentType: 'message_deleted', channelId: 'C_CLEAN', deletedTs: '1730214000.000100' }, {
        eventType: 'message',
        eventSubtype: 'message_deleted',
      })
    );
    const recent = await repo.recordOrdinary(ordinary());
    await db.pool.query("UPDATE slack_lifecycle_intents SET status='applied',applied_at=now() WHERE receipt_id=$1", [oldLifecycle.receipt.id]);

    await db.pool.query(
      `UPDATE slack_event_receipts SET created_at = now() - interval '8 days' WHERE id = ANY($1)`,
      [[oldOrdinary.receipt.id, oldLifecycle.receipt.id]]
    );

    const result = await repo.purgeExpiredReceipts(new Date());
    expect(result.purgedCount).toBe(2);
    const remaining = await db.pool.query<{ id: string }>(
      'SELECT id FROM slack_event_receipts WHERE id = ANY($1) ORDER BY id',
      [[oldOrdinary.receipt.id, oldLifecycle.receipt.id, recent.receipt.id]]
    );
    expect(remaining.rows.map(row => row.id)).toEqual([recent.receipt.id]);
    const lifecycleIntents = await db.pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM slack_lifecycle_intents WHERE receipt_id = $1',
      [oldLifecycle.receipt.id]
    );
    expect(lifecycleIntents.rows[0]?.n).toBe('0');
    const barrier = await db.pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM slack_invalidation_barriers WHERE source_event_key = $1',
      [slackEventSourceKey(APP_ID, oldLifecycle.receipt.event_id)]
    );
    expect(barrier.rows[0]?.n).toBe('1');
  });

  it('keeps expired receipts while credential validation is pending or failed', async () => {
    const connection = await seedConnection();
    const staged = await repo.recordLifecycle(lifecycle({
      intentType: 'token_revocation_validation', slackUserIds: [connection.actorId],
    }));
    await db.pool.query("UPDATE slack_event_receipts SET created_at=now()-interval '8 days' WHERE id=$1", [staged.receipt.id]);
    for (const status of ['pending', 'failed']) {
      await db.pool.query('UPDATE slack_lifecycle_intents SET status=$1 WHERE receipt_id=$2', [status, staged.receipt.id]);
      await repo.purgeExpiredReceipts(new Date());
      expect((await db.pool.query('SELECT id FROM slack_event_receipts WHERE id=$1', [staged.receipt.id])).rowCount).toBe(1);
      expect((await db.pool.query('SELECT id FROM slack_lifecycle_intents WHERE receipt_id=$1', [staged.receipt.id])).rowCount).toBe(1);
    }
    await db.pool.query("UPDATE slack_lifecycle_intents SET status='applied',applied_at=now() WHERE receipt_id=$1", [staged.receipt.id]);
    await repo.purgeExpiredReceipts(new Date());
    expect((await db.pool.query('SELECT id FROM slack_event_receipts WHERE id=$1', [staged.receipt.id])).rowCount).toBe(0);
  });

  it('bounds pool acquisition and never stages a late receipt after its deadline', async () => {
    const limitedPool = new pg.Pool({ ...db.pool.options, max: 1 });
    const occupied = await limitedPool.connect();
    const bounded = new SlackEventReceiptRepo(limitedPool, invalidation, { statementTimeoutMs: 100, lockTimeoutMs: 50 });
    const input = ordinary();
    const pending = bounded.recordOrdinary(input);
    const observed = pending.then(() => 'unexpected-success', error => error);
    try {
      const error = await Promise.race([
        observed,
        new Promise(resolve => setTimeout(() => resolve('pool acquisition exceeded deadline'), 500)),
      ]);
      expect(error).toBeInstanceOf(SlackStagingTimeoutError);
    } finally {
      occupied.release();
      await observed;
      await limitedPool.end();
    }
    expect((await db.pool.query('SELECT id FROM slack_event_receipts WHERE event_id=$1', [input.eventId])).rowCount).toBe(0);
  });

  it('uses one deadline across real PostgreSQL statements and rolls back partial staging', async () => {
    await db.pool.query(`CREATE FUNCTION ingress_review_delay() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN PERFORM pg_sleep(0.07); RETURN NEW; END; $$`);
    await db.pool.query('CREATE TRIGGER ingress_receipt_delay BEFORE INSERT ON slack_event_receipts FOR EACH ROW EXECUTE FUNCTION ingress_review_delay()');
    await db.pool.query('CREATE TRIGGER ingress_invalidation_delay BEFORE INSERT ON slack_invalidation_receipts FOR EACH ROW EXECUTE FUNCTION ingress_review_delay()');
    const bounded = new SlackEventReceiptRepo(db.pool, invalidation, { statementTimeoutMs: 100, lockTimeoutMs: 50 });
    const input = lifecycle({ intentType: 'message_deleted', channelId: 'C_DEADLINE', deletedTs: SOURCE_TS });
    try {
      await expect(bounded.recordLifecycle(input)).rejects.toBeInstanceOf(SlackStagingTimeoutError);
      expect((await db.pool.query('SELECT id FROM slack_event_receipts WHERE event_id=$1', [input.eventId])).rowCount).toBe(0);
      expect((await db.pool.query('SELECT id FROM slack_invalidation_barriers WHERE source_event_key=$1', [slackEventSourceKey(APP_ID,input.eventId)])).rowCount).toBe(0);
    } finally {
      await db.pool.query('DROP TRIGGER ingress_receipt_delay ON slack_event_receipts');
      await db.pool.query('DROP TRIGGER ingress_invalidation_delay ON slack_invalidation_receipts');
      await db.pool.query('DROP FUNCTION ingress_review_delay()');
    }
  });

  it('T1.9: a live owner lock yields a fast lock-busy result, and the retry succeeds', async () => {
    const connection = await seedConnection({ actorId: 'U_LOCK_BUSY' });
    const input = lifecycle({
      intentType: 'token_revocation_validation',
      slackUserIds: ['U_LOCK_BUSY'],
    });
    const holder = await db.pool.connect();
    try {
      await holder.query("SELECT pg_advisory_lock(hashtext('ati-slack-owner'), hashtext($1))", [connection.person.id]);
      const started = Date.now();
      await expect(repo.recordLifecycle(input)).rejects.toBeInstanceOf(SlackOwnerLockBusyError);
      expect(Date.now() - started).toBeLessThan(1000);
    } finally {
      await holder.query("SELECT pg_advisory_unlock(hashtext('ati-slack-owner'), hashtext($1))", [connection.person.id]);
      holder.release();
    }

    const retry = await repo.recordLifecycle(input);
    expect(retry.kind).toBe('recorded');
    const row = await db.pool.query<{ status: string; config: string }>(
      'SELECT status, config FROM slack_connections WHERE id = $1',
      [connection.connectionId]
    );
    expect(row.rows[0]).toEqual({ status: 'reconnect_required', config: connection.config });
  });
});
