import type pg from 'pg';
import { createHash } from 'node:crypto';
import type {
  SlackBinding,
  SlackPolicyEpoch,
  SlackResourceType,
  SlackPurgeTarget,
} from '@wap/tool-schemas';

export type SlackInvalidationBarrier =
  | {
      barrierType: 'binding';
      binding: SlackBinding;
      reason: string;
    }
  | {
      barrierType: 'channel';
      binding: SlackBinding;
      channelId: string;
      reason: string;
    }
  | {
      barrierType: 'epoch';
      epoch: SlackPolicyEpoch;
      reason: string;
    }
  | {
      barrierType: 'resource';
      workspaceId: string;
      resourceType: SlackResourceType;
      resourceId: string;
      minValidRevision?: string;
      deleted?: boolean;
      reason: string;
    }
  | {
      barrierType: 'provisional_auth';
      binding: SlackBinding;
      sourceEventKey: string;
      credentialFingerprint?: string;
      provisionalAction: string;
      reason: string;
    };

export interface InvalidationEffect {
  effectKey: string;
  barrier: SlackInvalidationBarrier;
  purgeTarget?: SlackPurgeTarget;
}

export interface StageInTransactionInput {
  sourceEventKey: string; // namespaced "slack:app:evt" hoặc "policy:evt"
  effects: InvalidationEffect[];
}

export interface StageInTransactionResult {
  receiptId: string;
  barrierIds: string[];
  intentIds: string[];
}

export interface SlackIntentRow {
  id: string;
  sourceEventKey: string;
  effectKey: string;
  targetKind: string;
  purgeTarget: SlackPurgeTarget;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  attempts: number;
  leasedUntil: Date | null;
  workerId: string | null;
  lastError: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface CheckBarriersQuery {
  binding?: SlackBinding;
  channelId?: string;
  epoch?: SlackPolicyEpoch;
  epochHash?: string;
  resourceType?: SlackResourceType;
  resourceId?: string;
  revision?: string;
  workspaceId?: string;
}

export interface CheckBarriersResult {
  blocked: boolean;
  barrierType?: string;
  reason?: string;
  barrierId?: string;
}

export function hashPolicyEpoch(epoch: SlackPolicyEpoch): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        epoch.binding.atiUserId,
        epoch.binding.connectionId,
        epoch.binding.workspaceId,
        epoch.binding.slackUserId,
        epoch.binding.identityVersion,
        epoch.providerProfileId,
        epoch.configFingerprint,
        epoch.policyVersion,
        epoch.consentRevision,
        epoch.providerRevision,
      ])
    )
    .digest('hex');
}

const DECIMAL_REVISION_REGEX = /^\d+(\.\d+)?$/;

/**
 * Compare two decimal string revisions (e.g. "1730219400.000100" vs "1730219400.000200", or "9999999999.000001")
 * Uses exact BigInt decimal parsing without floating-point numbers.
 * Rejects unsupported opaque or non-decimal revision strings (fail-closed).
 * Returns -1 if a < b, 1 if a > b, 0 if a === b
 */
export function compareSlackRevisions(a: string, b: string): number {
  if (
    typeof a !== 'string' ||
    typeof b !== 'string' ||
    !DECIMAL_REVISION_REGEX.test(a) ||
    !DECIMAL_REVISION_REGEX.test(b)
  ) {
    throw new TypeError('Invalid decimal revision: must match /^\\d+(\\.\\d+)?$/');
  }
  if (a === b) return 0;

  const [intA, fracA = ''] = a.split('.');
  const [intB, fracB = ''] = b.split('.');

  const bigIntA = BigInt(intA ?? '0');
  const bigIntB = BigInt(intB ?? '0');
  if (bigIntA < bigIntB) return -1;
  if (bigIntA > bigIntB) return 1;

  // Compare fractions by normalizing trailing zeros
  const maxLen = Math.max(fracA.length, fracB.length);
  const normA = fracA.padEnd(maxLen, '0');
  const normB = fracB.padEnd(maxLen, '0');

  const bigFracA = normA ? BigInt(normA) : 0n;
  const bigFracB = normB ? BigInt(normB) : 0n;

  if (bigFracA < bigFracB) return -1;
  if (bigFracA > bigFracB) return 1;
  return 0;
}

export class SlackInvalidationService {
  constructor(private readonly pool: pg.Pool) {}

  /**
   * Stages invalidation receipt, barriers, and intents within caller's real PostgreSQL transaction.
   * Caller is responsible for BEGIN / COMMIT / ROLLBACK.
   */
  async stageInTransaction(
    client: pg.PoolClient,
    input: StageInTransactionInput
  ): Promise<StageInTransactionResult> {
    if (!input.sourceEventKey || !input.sourceEventKey.trim()) {
      throw new TypeError('sourceEventKey must be a non-blank string');
    }
    const sourceEventKey = input.sourceEventKey.trim();
    const payloadHash = createHash('sha256')
      .update(JSON.stringify(input.effects))
      .digest('hex');

    // 1. Idempotency check on receipt
    const existingReceiptRes = await client.query(
      'SELECT id, payload_hash FROM slack_invalidation_receipts WHERE source_event_key = $1',
      [sourceEventKey]
    );

    if (existingReceiptRes.rows[0]) {
      const existingReceiptId = existingReceiptRes.rows[0].id;
      const barrierIdsRes = await client.query(
        'SELECT id FROM slack_invalidation_barriers WHERE source_event_key = $1 ORDER BY id',
        [sourceEventKey]
      );
      const intentIdsRes = await client.query(
        'SELECT id FROM slack_invalidation_intents WHERE source_event_key = $1 ORDER BY id',
        [sourceEventKey]
      );
      return {
        receiptId: existingReceiptId,
        barrierIds: barrierIdsRes.rows.map(r => r.id),
        intentIds: intentIdsRes.rows.map(r => r.id),
      };
    }

    // 2. Insert receipt
    const receiptRes = await client.query(
      'INSERT INTO slack_invalidation_receipts (source_event_key, payload_hash) VALUES ($1, $2) RETURNING id',
      [sourceEventKey, payloadHash]
    );
    const receiptId = receiptRes.rows[0].id;

    const barrierIds: string[] = [];
    const intentIds: string[] = [];

    // 3. Insert each effect's barrier and intents
    for (const effect of input.effects) {
      if (!effect.effectKey || !effect.effectKey.trim()) {
        throw new TypeError('effectKey must be a non-blank string');
      }
      const effectKey = effect.effectKey.trim();
      const b = effect.barrier;

      let workspaceId = '';
      let connectionId: string | null = null;
      let userId: string | null = null;
      let slackUserId: string | null = null;
      let identityVersion: number | null = null;
      let channelId: string | null = null;
      let resourceType: string | null = null;
      let resourceId: string | null = null;
      let minValidRevision: string | null = null;
      let deleted = false;
      let epochHash: string | null = null;
      let epochJson: any = null;
      let provisional = false;
      let provisionalAction: string | null = null;
      let credentialFingerprint: string | null = null;

      switch (b.barrierType) {
        case 'binding':
          workspaceId = b.binding.workspaceId;
          connectionId = b.binding.connectionId;
          userId = b.binding.atiUserId;
          slackUserId = b.binding.slackUserId;
          identityVersion = b.binding.identityVersion;
          break;

        case 'channel':
          workspaceId = b.binding.workspaceId;
          connectionId = b.binding.connectionId;
          userId = b.binding.atiUserId;
          slackUserId = b.binding.slackUserId;
          identityVersion = b.binding.identityVersion;
          channelId = b.channelId;
          break;

        case 'epoch':
          workspaceId = b.epoch.binding.workspaceId;
          connectionId = b.epoch.binding.connectionId;
          userId = b.epoch.binding.atiUserId;
          slackUserId = b.epoch.binding.slackUserId;
          identityVersion = b.epoch.binding.identityVersion;
          epochHash = hashPolicyEpoch(b.epoch);
          epochJson = b.epoch;
          break;

        case 'resource':
          workspaceId = b.workspaceId;
          resourceType = b.resourceType;
          resourceId = b.resourceId;
          minValidRevision = b.minValidRevision ?? null;
          deleted = b.deleted ?? false;
          break;

        case 'provisional_auth':
          workspaceId = b.binding.workspaceId;
          connectionId = b.binding.connectionId;
          userId = b.binding.atiUserId;
          slackUserId = b.binding.slackUserId;
          identityVersion = b.binding.identityVersion;
          provisional = true;
          provisionalAction = b.provisionalAction;
          credentialFingerprint = b.credentialFingerprint ?? null;
          break;
      }

      const barrierRes = await client.query(
        `INSERT INTO slack_invalidation_barriers (
          source_event_key, effect_key, barrier_type, workspace_id, connection_id,
          user_id, slack_user_id, identity_version, channel_id, resource_type,
          resource_id, min_valid_revision, deleted, epoch_hash, epoch_json,
          provisional, provisional_action, credential_fingerprint, reason
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
        RETURNING id`,
        [
          sourceEventKey,
          effectKey,
          b.barrierType,
          workspaceId,
          connectionId,
          userId,
          slackUserId,
          identityVersion,
          channelId,
          resourceType,
          resourceId,
          minValidRevision,
          deleted,
          epochHash,
          epochJson ? JSON.stringify(epochJson) : null,
          provisional,
          provisionalAction,
          credentialFingerprint,
          b.reason,
        ]
      );
      barrierIds.push(barrierRes.rows[0].id);

      // If purgeTarget provided, create intents (raw + cascade derived kinds)
      if (effect.purgeTarget) {
        // 1. Raw source intent
        const rawIntentRes = await client.query(
          `INSERT INTO slack_invalidation_intents (
            source_event_key, effect_key, target_kind, purge_target, status
          ) VALUES ($1, $2, 'slack_source_raw', $3, 'pending')
          RETURNING id`,
          [sourceEventKey, effectKey, JSON.stringify(effect.purgeTarget)]
        );
        intentIds.push(rawIntentRes.rows[0].id);

        // 2. Cascade target kinds intents (for 03B2+)
        for (const cascadeKind of effect.purgeTarget.cascadeTargetKinds) {
          const cascadeRes = await client.query(
            `INSERT INTO slack_invalidation_intents (
              source_event_key, effect_key, target_kind, purge_target, status
            ) VALUES ($1, $2, $3, $4, 'pending')
            RETURNING id`,
            [sourceEventKey, effectKey, cascadeKind, JSON.stringify(effect.purgeTarget)]
          );
          intentIds.push(cascadeRes.rows[0].id);
        }
      }
    }

    return { receiptId, barrierIds, intentIds };
  }

  /**
   * Checks whether an access or observation is blocked by any active invalidation barrier.
   */
  async checkBarriers(query: CheckBarriersQuery): Promise<CheckBarriersResult> {
    const res = await this.pool.query(
      'SELECT * FROM slack_invalidation_barriers WHERE active = true ORDER BY created_at'
    );
    const barriers = res.rows;

    const wsId = query.workspaceId || query.binding?.workspaceId;

    for (const b of barriers) {
      if (b.workspace_id && wsId && b.workspace_id !== wsId) {
        continue;
      }

      switch (b.barrier_type) {
        case 'binding': {
          if (query.binding) {
            if (
              b.connection_id === query.binding.connectionId &&
              b.user_id === query.binding.atiUserId &&
              b.identity_version === query.binding.identityVersion
            ) {
              return { blocked: true, barrierType: 'binding', reason: b.reason, barrierId: b.id };
            }
          }
          break;
        }

        case 'channel': {
          if (query.channelId && b.channel_id === query.channelId) {
            if (!query.binding || (b.connection_id === query.binding.connectionId && b.identity_version === query.binding.identityVersion)) {
              return { blocked: true, barrierType: 'channel', reason: b.reason, barrierId: b.id };
            }
          }
          break;
        }

        case 'epoch': {
          const queryEpochHash = query.epoch ? hashPolicyEpoch(query.epoch) : query.epochHash;
          if (queryEpochHash && b.epoch_hash === queryEpochHash) {
            return { blocked: true, barrierType: 'epoch', reason: b.reason, barrierId: b.id };
          }
          break;
        }

        case 'resource': {
          if (
            query.resourceType &&
            query.resourceId &&
            b.resource_type === query.resourceType &&
            b.resource_id === query.resourceId
          ) {
            if (b.deleted) {
              return { blocked: true, barrierType: 'resource', reason: b.reason, barrierId: b.id };
            }
            if (b.min_valid_revision && query.revision) {
              if (compareSlackRevisions(query.revision, b.min_valid_revision) < 0) {
                return { blocked: true, barrierType: 'resource', reason: b.reason, barrierId: b.id };
              }
            }
          }
          break;
        }

        case 'provisional_auth': {
          if (query.binding) {
            if (
              b.connection_id === query.binding.connectionId &&
              b.user_id === query.binding.atiUserId &&
              b.identity_version === query.binding.identityVersion
            ) {
              return { blocked: true, barrierType: 'provisional_auth', reason: b.reason, barrierId: b.id };
            }
          }
          break;
        }
      }
    }

    return { blocked: false };
  }

  /**
   * Concurrently claims pending/failed intents using FOR UPDATE SKIP LOCKED
   */
  async claimIntents(
    limit = 10,
    workerId: string,
    leaseSeconds = 60,
    targetKind = 'slack_source_raw'
  ): Promise<SlackIntentRow[]> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const selectRes = await client.query(
        `SELECT *
         FROM slack_invalidation_intents
         WHERE status IN ('pending', 'failed')
           AND target_kind = $1
           AND (leased_until IS NULL OR leased_until < now())
         ORDER BY created_at
         LIMIT $2
         FOR UPDATE SKIP LOCKED`,
        [targetKind, limit]
      );

      const rows = selectRes.rows;
      if (rows.length === 0) {
        await client.query('COMMIT');
        return [];
      }

      const ids = rows.map(r => r.id);
      await client.query(
        `UPDATE slack_invalidation_intents
         SET status = 'processing',
             leased_until = now() + make_interval(secs => $1),
             worker_id = $2
         WHERE id = ANY($3)`,
        [leaseSeconds, workerId, ids]
      );

      await client.query('COMMIT');
      return rows.map(r => ({
        id: r.id,
        sourceEventKey: r.source_event_key,
        effectKey: r.effect_key,
        targetKind: r.target_kind,
        purgeTarget: r.purge_target,
        status: 'processing',
        attempts: r.attempts,
        leasedUntil: new Date(Date.now() + leaseSeconds * 1000),
        workerId,
        lastError: r.last_error,
        createdAt: new Date(r.created_at),
        completedAt: null,
      }));
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async completeIntent(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE slack_invalidation_intents
       SET status = 'completed', completed_at = now()
       WHERE id = $1`,
      [id]
    );
  }

  async failIntent(id: string, error: string): Promise<void> {
    await this.pool.query(
      `UPDATE slack_invalidation_intents
       SET status = 'failed', last_error = $2, attempts = attempts + 1
       WHERE id = $1`,
      [id, error]
    );
  }

  async recoverStaleLeases(): Promise<{ recoveredCount: number }> {
    const res = await this.pool.query(
      `UPDATE slack_invalidation_intents
       SET status = 'pending', worker_id = NULL, leased_until = NULL, attempts = attempts + 1
       WHERE status = 'processing' AND leased_until < now()`
    );
    return { recoveredCount: res.rowCount ?? 0 };
  }

  async clearProvisionalBarrier(sourceEventKey: string, effectKey?: string): Promise<{ clearedCount: number }> {
    let query = 'UPDATE slack_invalidation_barriers SET active = false WHERE source_event_key = $1 AND provisional = true';
    const params: any[] = [sourceEventKey];
    if (effectKey) {
      params.push(effectKey);
      query += ' AND effect_key = $2';
    }
    const res = await this.pool.query(query, params);
    return { clearedCount: res.rowCount ?? 0 };
  }
}
