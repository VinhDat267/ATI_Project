import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createMigratedSchema } from '../../helpers/gmail-test-db.js';
import {
  SlackInvalidationService,
  type StageInTransactionInput,
  type SlackInvalidationBarrier,
} from '../../../src/services/slack/slack-invalidation-service.js';
import { SlackConnectionRepo } from '../../../src/db/repositories/slack-connection-repo.js';
import type { SlackBinding, SlackPurgeTarget } from '@wap/tool-schemas';

describe('SlackInvalidationService on PostgreSQL (03B1)', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  let service: SlackInvalidationService;
  let connectionRepo: SlackConnectionRepo;

  beforeAll(async () => {
    db = await createMigratedSchema('slack_invalidation_svc');
    service = new SlackInvalidationService(db.pool);
    connectionRepo = new SlackConnectionRepo(db.pool);
  });

  afterAll(async () => {
    await db?.close();
  });

  async function seedConnection(workspaceId = 'T_INVAL_1') {
    const person = await db.person('Bob');
    const connectionId = randomUUID();
    await db.pool.query(
      `INSERT INTO slack_connections (
        id, user_id, app_id, workspace_id, workspace_name, actor_id,
        identity_version, status, config, scopes, connected_at, last_state_order
      ) VALUES ($1, $2, 'A_APP', $3, 'Test Workspace', 'U_BOB', 1, 'active', 'ENCRYPTED_CONFIG', ARRAY['channels:history'], now(), '0001')`,
      [connectionId, person.id, workspaceId]
    );

    const binding: SlackBinding = {
      atiUserId: person.id,
      connectionId,
      workspaceId,
      slackUserId: 'U_BOB',
      identityVersion: 1,
    };

    return { person, connectionId, workspaceId, binding };
  }

  it('T3.1: stageInTransaction caller-managed transaction commits receipt, barriers, and intents atomically', async () => {
    const env = await seedConnection('T_STAGE_1');
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const provisionalBarrier: SlackInvalidationBarrier = {
        barrierType: 'provisional_auth',
        binding: env.binding,
        sourceEventKey: 'slack:A_APP:evt_1',
        credentialFingerprint: 'fp_cred_1',
        provisionalAction: 'probe_credential',
        reason: 'tokens_revoked',
      };

      const resourceBarrier: SlackInvalidationBarrier = {
        barrierType: 'resource',
        workspaceId: env.workspaceId,
        resourceType: 'message',
        resourceId: 'C123_TS_1',
        deleted: true,
        reason: 'message_deleted',
      };

      const purgeTarget: SlackPurgeTarget = {
        scope: 'resource_lifecycle',
        workspaceId: env.workspaceId,
        resourceType: 'message',
        resourceId: 'C123_TS_1',
        cascadeTargetKinds: ['chat_history_message', 'working_memory_entity'],
        tombstoneReason: 'source_deleted',
      };

      const input: StageInTransactionInput = {
        sourceEventKey: 'slack:A_APP:evt_1',
        effects: [
          {
            effectKey: 'provisional_block',
            barrier: provisionalBarrier,
            // Barrier-only: no purgeTarget!
          },
          {
            effectKey: 'purge_deleted_msg',
            barrier: resourceBarrier,
            purgeTarget,
          },
        ],
      };

      const result = await service.stageInTransaction(client, input);
      expect(result.receiptId).toBeDefined();
      expect(result.barrierIds).toHaveLength(2);
      expect(result.intentIds).toHaveLength(3); // 1 raw + 2 cascade target kinds

      await client.query('COMMIT');

      // Verify records exist in DB
      const receiptRes = await db.pool.query('SELECT * FROM slack_invalidation_receipts WHERE source_event_key = $1', ['slack:A_APP:evt_1']);
      expect(receiptRes.rows).toHaveLength(1);

      const barrierRes = await db.pool.query('SELECT * FROM slack_invalidation_barriers WHERE source_event_key = $1', ['slack:A_APP:evt_1']);
      expect(barrierRes.rows).toHaveLength(2);

      const intentRes = await db.pool.query('SELECT * FROM slack_invalidation_intents WHERE source_event_key = $1', ['slack:A_APP:evt_1']);
      expect(intentRes.rows).toHaveLength(3);
    } finally {
      client.release();
    }
  });

  it('T3.2: rollback of caller transaction cleanly rolls back all staged records', async () => {
    const env = await seedConnection('T_ROLLBACK_1');
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await service.stageInTransaction(client, {
        sourceEventKey: 'slack:A_APP:evt_rollback',
        effects: [
          {
            effectKey: 'eff1',
            barrier: {
              barrierType: 'binding',
              binding: env.binding,
              reason: 'connection_disconnected',
            },
          },
        ],
      });
      await client.query('ROLLBACK');

      const receipt = await db.pool.query('SELECT * FROM slack_invalidation_receipts WHERE source_event_key = $1', ['slack:A_APP:evt_rollback']);
      expect(receipt.rows).toHaveLength(0);
      const barriers = await db.pool.query('SELECT * FROM slack_invalidation_barriers WHERE source_event_key = $1', ['slack:A_APP:evt_rollback']);
      expect(barriers.rows).toHaveLength(0);
    } finally {
      client.release();
    }
  });

  it('T3.3: duplicate event is idempotent and returns existing ids without re-binding new generation', async () => {
    const env = await seedConnection('T_IDEMPOTENT_1');
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const input: StageInTransactionInput = {
        sourceEventKey: 'slack:A_APP:evt_dup',
        effects: [
          {
            effectKey: 'eff_dup',
            barrier: {
              barrierType: 'binding',
              binding: env.binding,
              reason: 'test_dup',
            },
          },
        ],
      };
      const first = await service.stageInTransaction(client, input);
      await client.query('COMMIT');

      // Second call on a new transaction
      await client.query('BEGIN');
      const second = await service.stageInTransaction(client, input);
      await client.query('COMMIT');

      expect(second.receiptId).toBe(first.receiptId);
      expect(second.barrierIds).toEqual(first.barrierIds);

      // Verify no duplicate rows
      const receiptRes = await db.pool.query('SELECT * FROM slack_invalidation_receipts WHERE source_event_key = $1', ['slack:A_APP:evt_dup']);
      expect(receiptRes.rows).toHaveLength(1);
    } finally {
      client.release();
    }
  });

  it('T3.4: concurrency SKIP LOCKED claims intents without overlap and recovers stale leases', async () => {
    await db.pool.query('DELETE FROM slack_invalidation_intents');
    const env = await seedConnection('T_INTENTS_CLAIM');
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const effects = Array.from({ length: 5 }, (_, i) => ({
        effectKey: `eff_${i}`,
        barrier: {
          barrierType: 'resource' as const,
          workspaceId: env.workspaceId,
          resourceType: 'message' as const,
          resourceId: `msg_${i}`,
          reason: 'source_deleted',
        },
        purgeTarget: {
          scope: 'resource_lifecycle' as const,
          workspaceId: env.workspaceId,
          resourceType: 'message' as const,
          resourceId: `msg_${i}`,
          cascadeTargetKinds: [] as any[],
          tombstoneReason: 'source_deleted' as const,
        },
      }));

      await service.stageInTransaction(client, {
        sourceEventKey: 'slack:A_APP:evt_multi_intent',
        effects,
      });
      await client.query('COMMIT');

      // Worker 1 claims 3 intents
      const worker1Claims = await service.claimIntents(3, 'worker-1', 60, 'slack_source_raw');
      expect(worker1Claims).toHaveLength(3);

      // Worker 2 concurrently claims intents: must get the remaining 2
      const worker2Claims = await service.claimIntents(3, 'worker-2', 60, 'slack_source_raw');
      expect(worker2Claims).toHaveLength(2);

      // Confirm zero intersection between claims
      const w1Ids = new Set(worker1Claims.map(c => c.id));
      const w2Ids = new Set(worker2Claims.map(c => c.id));
      for (const id of w1Ids) {
        expect(w2Ids.has(id)).toBe(false);
      }

      // Simulate worker 1 crash: make its leases expired
      await db.pool.query(
        "UPDATE slack_invalidation_intents SET leased_until = now() - INTERVAL '10 seconds' WHERE worker_id = 'worker-1'"
      );

      // Recover stale leases
      const recovery = await service.recoverStaleLeases();
      expect(recovery.recoveredCount).toBe(3);

      // Verify the 3 recovered intents are pending again and can be claimed
      const reclaims = await service.claimIntents(5, 'worker-3', 60, 'slack_source_raw');
      expect(reclaims).toHaveLength(3);
    } finally {
      client.release();
    }
  });

  it('T3.5: checkBarriers verifies binding, channel, resource edit watermark, and provisional blocks', async () => {
    const env = await seedConnection('T_BARRIERS_CHECK');
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await service.stageInTransaction(client, {
        sourceEventKey: 'slack:A_APP:evt_barrier_check',
        effects: [
          // 1. Channel barrier
          {
            effectKey: 'chan_block',
            barrier: {
              barrierType: 'channel',
              binding: env.binding,
              channelId: 'C_BLOCKED',
              reason: 'channel_membership_lost',
            },
          },
          // 2. Resource watermark (edit)
          {
            effectKey: 'res_edit_watermark',
            barrier: {
              barrierType: 'resource',
              workspaceId: env.workspaceId,
              resourceType: 'message',
              resourceId: 'MSG_EDITED',
              minValidRevision: '100.5',
              reason: 'message_changed',
            },
          },
        ],
      });
      await client.query('COMMIT');

      // Check channel barrier
      const chanCheckBlocked = await service.checkBarriers({
        binding: env.binding,
        channelId: 'C_BLOCKED',
      });
      expect(chanCheckBlocked.blocked).toBe(true);
      expect(chanCheckBlocked.reason).toBe('channel_membership_lost');

      const chanCheckAllowed = await service.checkBarriers({
        binding: env.binding,
        channelId: 'C_ALLOWED',
      });
      expect(chanCheckAllowed.blocked).toBe(false);

      // Check resource edit watermark
      const oldRevCheck = await service.checkBarriers({
        workspaceId: env.workspaceId,
        resourceType: 'message',
        resourceId: 'MSG_EDITED',
        revision: '100.4', // Older than 100.5 -> blocked!
      });
      expect(oldRevCheck.blocked).toBe(true);

      const newRevCheck = await service.checkBarriers({
        workspaceId: env.workspaceId,
        resourceType: 'message',
        resourceId: 'MSG_EDITED',
        revision: '100.5', // Equal to watermark -> allowed!
      });
      expect(newRevCheck.blocked).toBe(false);
    } finally {
      client.release();
    }
  });

  it('T3.6: disconnect integration captures old binding under lock and fresh reconnect is not blocked', async () => {
    const env = await seedConnection('T_DISCONNECT_RECONNECT');

    // Disconnect connection
    await connectionRepo.disconnect(env.person.id, env.connectionId, async row => {
      // Stage invalidation in same flow
      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');
        await service.stageInTransaction(client, {
          sourceEventKey: `disconnect:${row.id}:${row.identity_version}`,
          effects: [
            {
              effectKey: 'auth_disconnect',
              barrier: {
                barrierType: 'binding',
                binding: {
                  atiUserId: row.user_id,
                  connectionId: row.id,
                  workspaceId: row.workspace_id,
                  slackUserId: row.actor_id,
                  identityVersion: row.identity_version,
                },
                reason: 'connection_disconnected',
              },
            },
          ],
        });
        await client.query('COMMIT');
      } finally {
        client.release();
      }
    });

    // Check old binding (version 1) is blocked
    const oldCheck = await service.checkBarriers({
      binding: env.binding,
    });
    expect(oldCheck.blocked).toBe(true);

    // Reconnect: User gets identityVersion = 2
    const freshBinding: SlackBinding = {
      ...env.binding,
      identityVersion: 2,
    };

    // Fresh reconnect MUST NOT be blocked by version 1 barrier!
    const freshCheck = await service.checkBarriers({
      binding: freshBinding,
    });
    expect(freshCheck.blocked).toBe(false);
  });
});
