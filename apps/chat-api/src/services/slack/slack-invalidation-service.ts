import type pg from 'pg';
import { createHash } from 'node:crypto';
import {
  SLACK_RESOURCE_TYPES,
  sameSlackBinding,
  sameSlackPolicyEpoch,
  validateSlackBinding,
  validateSlackPolicyEpoch,
  validateSlackPurgeTarget,
  type SlackBinding,
  type SlackPolicyEpoch,
  type SlackPurgeTarget,
  type SlackResourceType,
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

export interface NormalizedInvalidationEffect {
  effectKey: string;
  barrier: SlackInvalidationBarrier;
  purgeTarget?: SlackPurgeTarget;
}

const SLACK_LOCK_NAMESPACE = 'slack:v1';

function bindingLockKey(binding: SlackBinding): string {
  return `${SLACK_LOCK_NAMESPACE}:binding:${JSON.stringify([
    binding.atiUserId,
    binding.connectionId,
    binding.workspaceId,
    binding.slackUserId,
    binding.identityVersion,
  ])}`;
}

function channelLockKey(binding: SlackBinding, channelId: string): string {
  return `${SLACK_LOCK_NAMESPACE}:channel:${JSON.stringify([
    binding.atiUserId,
    binding.connectionId,
    binding.workspaceId,
    binding.slackUserId,
    binding.identityVersion,
    channelId,
  ])}`;
}

function epochLockKey(epochHash: string): string {
  return `${SLACK_LOCK_NAMESPACE}:epoch:${epochHash}`;
}

function resourceLockKey(workspaceId: string, resourceType: string, resourceId: string): string {
  return `${SLACK_LOCK_NAMESPACE}:resource:${JSON.stringify([workspaceId, resourceType, resourceId])}`;
}

function eventLockKey(sourceEventKey: string): string {
  return `${SLACK_LOCK_NAMESPACE}:event:${JSON.stringify([sourceEventKey])}`;
}

/**
 * Canonical lock keys for an invalidation barrier. Writers (source store) acquire the same
 * keys for their binding/resource/channel/epoch scope in the same transaction that performs
 * the write, so a barrier commit and a source insert can never interleave undetected.
 */
export function slackInvalidationLockKeys(barrier: SlackInvalidationBarrier): string[] {
  switch (barrier.barrierType) {
    case 'binding':
      return [bindingLockKey(barrier.binding)];
    case 'channel':
      return [bindingLockKey(barrier.binding), channelLockKey(barrier.binding, barrier.channelId)];
    case 'epoch':
      return [bindingLockKey(barrier.epoch.binding), epochLockKey(hashPolicyEpoch(barrier.epoch))];
    case 'resource':
      return [resourceLockKey(barrier.workspaceId, barrier.resourceType, barrier.resourceId)];
    case 'provisional_auth':
      return [bindingLockKey(barrier.binding)];
  }
}

export interface SlackSourceWriteLockScope {
  binding: SlackBinding;
  epoch: SlackPolicyEpoch;
  resourceType: SlackResourceType;
  resourceId: string;
  channelId?: string;
}

/**
 * Lock scope a raw-source writer must hold in the same transaction as its barrier check and
 * INSERT. It mirrors the keys used by stageInTransaction for each barrier family.
 */
export function slackSourceWriteLockKeys(scope: SlackSourceWriteLockScope): string[] {
  const keys = [
    bindingLockKey(scope.binding),
    resourceLockKey(scope.binding.workspaceId, scope.resourceType, scope.resourceId),
    epochLockKey(hashPolicyEpoch(scope.epoch)),
  ];
  if (scope.channelId) {
    keys.push(channelLockKey(scope.binding, scope.channelId));
  }
  return keys;
}

/**
 * Acquires PostgreSQL transaction-scoped advisory locks in a deterministic global order.
 * Sorting prevents AB-BA deadlocks when different events touch overlapping target sets.
 */
export async function acquireSlackInvalidationLocks(
  client: pg.PoolClient,
  keys: readonly string[]
): Promise<string[]> {
  const ordered = [...new Set(keys)].sort();
  for (const key of ordered) {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
  }
  return ordered;
}

function requireNonBlankString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${field} must be a non-blank string`);
  }
  return value.trim();
}

function validateAndNormalizeBarrier(input: unknown): SlackInvalidationBarrier {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Invalid invalidation barrier: must be an object');
  }
  const barrier = input as Record<string, unknown>;
  const barrierType = barrier.barrierType;

  switch (barrierType) {
    case 'binding': {
      const binding = validateSlackBinding(barrier.binding);
      return {
        barrierType: 'binding',
        binding,
        reason: requireNonBlankString(barrier.reason, 'barrier.reason'),
      };
    }

    case 'channel': {
      const binding = validateSlackBinding(barrier.binding);
      return {
        barrierType: 'channel',
        binding,
        channelId: requireNonBlankString(barrier.channelId, 'barrier.channelId'),
        reason: requireNonBlankString(barrier.reason, 'barrier.reason'),
      };
    }

    case 'epoch': {
      const epoch = validateSlackPolicyEpoch(barrier.epoch);
      return {
        barrierType: 'epoch',
        epoch,
        reason: requireNonBlankString(barrier.reason, 'barrier.reason'),
      };
    }

    case 'resource': {
      if (
        typeof barrier.resourceType !== 'string' ||
        !SLACK_RESOURCE_TYPES.includes(barrier.resourceType as SlackResourceType)
      ) {
        throw new TypeError('Invalid resource barrier resourceType');
      }
      let minValidRevision: string | undefined;
      if (barrier.minValidRevision !== undefined && barrier.minValidRevision !== null) {
        minValidRevision = requireNonBlankString(barrier.minValidRevision, 'barrier.minValidRevision');
      }
      if (barrier.deleted !== undefined && typeof barrier.deleted !== 'boolean') {
        throw new TypeError('barrier.deleted must be a boolean');
      }
      return {
        barrierType: 'resource',
        workspaceId: requireNonBlankString(barrier.workspaceId, 'barrier.workspaceId'),
        resourceType: barrier.resourceType as SlackResourceType,
        resourceId: requireNonBlankString(barrier.resourceId, 'barrier.resourceId'),
        ...(minValidRevision ? { minValidRevision } : {}),
        ...(barrier.deleted !== undefined ? { deleted: barrier.deleted } : {}),
        reason: requireNonBlankString(barrier.reason, 'barrier.reason'),
      };
    }

    case 'provisional_auth': {
      const binding = validateSlackBinding(barrier.binding);
      let credentialFingerprint: string | undefined;
      if (barrier.credentialFingerprint !== undefined && barrier.credentialFingerprint !== null) {
        credentialFingerprint = requireNonBlankString(
          barrier.credentialFingerprint,
          'barrier.credentialFingerprint'
        );
      }
      return {
        barrierType: 'provisional_auth',
        binding,
        sourceEventKey: requireNonBlankString(barrier.sourceEventKey, 'barrier.sourceEventKey'),
        ...(credentialFingerprint ? { credentialFingerprint } : {}),
        provisionalAction: requireNonBlankString(barrier.provisionalAction, 'barrier.provisionalAction'),
        reason: requireNonBlankString(barrier.reason, 'barrier.reason'),
      };
    }

    default:
      throw new TypeError(`Unknown invalidation barrier type: ${String(barrierType)}`);
  }
}

function assertPurgeTargetMatchesBarrier(
  barrier: SlackInvalidationBarrier,
  purgeTarget: SlackPurgeTarget
): void {
  switch (barrier.barrierType) {
    case 'binding':
      if (
        purgeTarget.scope !== 'authorization_disconnect' ||
        !sameSlackBinding(purgeTarget.binding, barrier.binding)
      ) {
        throw new TypeError('binding barrier purgeTarget must be authorization_disconnect for the same binding');
      }
      return;

    case 'channel':
      if (
        purgeTarget.scope !== 'channel_membership_lost' ||
        !sameSlackBinding(purgeTarget.binding, barrier.binding) ||
        purgeTarget.channelId !== barrier.channelId
      ) {
        throw new TypeError('channel barrier purgeTarget must be channel_membership_lost for the same binding/channel');
      }
      return;

    case 'epoch':
      if (
        purgeTarget.scope !== 'policy_epoch_invalidated' ||
        !sameSlackPolicyEpoch(purgeTarget.epoch, barrier.epoch)
      ) {
        throw new TypeError('epoch barrier purgeTarget must be policy_epoch_invalidated for the exact same epoch');
      }
      return;

    case 'resource': {
      const matchesResource =
        purgeTarget.scope === 'resource_lifecycle' &&
        purgeTarget.workspaceId === barrier.workspaceId &&
        purgeTarget.resourceType === barrier.resourceType &&
        purgeTarget.resourceId === barrier.resourceId;
      const matchesOwner =
        purgeTarget.scope === 'owner_retention' &&
        purgeTarget.binding.workspaceId === barrier.workspaceId &&
        purgeTarget.resourceType === barrier.resourceType &&
        purgeTarget.resourceId === barrier.resourceId;
      if (!matchesResource && !matchesOwner) {
        throw new TypeError('resource barrier purgeTarget must target the same workspace/type/resource');
      }
      if (purgeTarget.scope === 'resource_lifecycle' && purgeTarget.tombstoneReason === 'source_edited' &&
          (barrier.deleted || !barrier.minValidRevision || !purgeTarget.beforeRevision ||
           compareSlackRevisions(purgeTarget.beforeRevision, barrier.minValidRevision) !== 0)) {
        throw new TypeError('edit purge cutoff must match the resource barrier watermark');
      }
      return;
    }

    case 'provisional_auth':
      throw new TypeError('provisional_auth barriers must not carry a purgeTarget');
  }
}

/**
 * Validates all effect payloads before any row is written. Runtime input is untrusted:
 * purge targets/barriers are revalidated through the canonical schema validators and each
 * purge target must describe the same scope as its barrier.
 */
export function normalizeInvalidationEffects(effects: unknown): NormalizedInvalidationEffect[] {
  if (!Array.isArray(effects)) {
    throw new TypeError('effects must be an array');
  }

  const seen = new Set<string>();
  const normalized: NormalizedInvalidationEffect[] = [];

  for (const rawEffect of effects) {
    if (!rawEffect || typeof rawEffect !== 'object' || Array.isArray(rawEffect)) {
      throw new TypeError('Invalid invalidation effect: must be an object');
    }
    const effect = rawEffect as Record<string, unknown>;
    const effectKey = requireNonBlankString(effect.effectKey, 'effectKey');
    if (seen.has(effectKey)) {
      throw new TypeError(`Duplicate effectKey: ${effectKey}`);
    }
    seen.add(effectKey);

    const barrier = validateAndNormalizeBarrier(effect.barrier);
    let purgeTarget: SlackPurgeTarget | undefined;
    if (effect.purgeTarget !== undefined) {
      purgeTarget = validateSlackPurgeTarget(effect.purgeTarget);
      assertPurgeTargetMatchesBarrier(barrier, purgeTarget);
    }

    normalized.push({ effectKey, barrier, purgeTarget });
  }

  return normalized;
}

function canonicalBarrierPayload(barrier: SlackInvalidationBarrier): Record<string, unknown> {
  switch (barrier.barrierType) {
    case 'binding':
      return {
        barrierType: barrier.barrierType,
        binding: barrier.binding,
        reason: barrier.reason,
      };
    case 'channel':
      return {
        barrierType: barrier.barrierType,
        binding: barrier.binding,
        channelId: barrier.channelId,
        reason: barrier.reason,
      };
    case 'epoch':
      return {
        barrierType: barrier.barrierType,
        epoch: barrier.epoch,
        reason: barrier.reason,
      };
    case 'resource':
      return {
        barrierType: barrier.barrierType,
        workspaceId: barrier.workspaceId,
        resourceType: barrier.resourceType,
        resourceId: barrier.resourceId,
        minValidRevision: barrier.minValidRevision ?? null,
        deleted: barrier.deleted ?? false,
        reason: barrier.reason,
      };
    case 'provisional_auth':
      return {
        barrierType: barrier.barrierType,
        binding: barrier.binding,
        sourceEventKey: barrier.sourceEventKey,
        credentialFingerprint: barrier.credentialFingerprint ?? null,
        provisionalAction: barrier.provisionalAction,
        reason: barrier.reason,
      };
  }
}

function canonicalPurgeTargetPayload(target: SlackPurgeTarget): Record<string, unknown> {
  return {
    ...target,
    cascadeTargetKinds: [...target.cascadeTargetKinds].sort(),
  };
}

/**
 * Stable payload hash independent of effect ordering. A replay of the same event with a
 * different target set is rejected rather than silently accepted as already barriered.
 */
export function hashInvalidationEffects(effects: readonly NormalizedInvalidationEffect[]): string {
  const canonical = effects
    .map(effect => ({
      effectKey: effect.effectKey,
      barrier: canonicalBarrierPayload(effect.barrier),
      purgeTarget: effect.purgeTarget ? canonicalPurgeTargetPayload(effect.purgeTarget) : null,
    }))
    .sort((a, b) => (a.effectKey < b.effectKey ? -1 : a.effectKey > b.effectKey ? 1 : 0));

  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
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

function barrierMatchesBinding(row: any, binding: SlackBinding): boolean {
  return (
    row.connection_id === binding.connectionId &&
    row.user_id === binding.atiUserId &&
    row.workspace_id === binding.workspaceId &&
    row.slack_user_id === binding.slackUserId &&
    row.identity_version === binding.identityVersion
  );
}

/**
 * Shared barrier evaluator used both by the service (pool) and by the source store/repo
 * inside a write transaction (same client). Matching uses the full canonical binding and
 * exact epoch/resource identity; there is no wildcard fallback.
 */
export async function checkSlackInvalidationBarriers(
  executor: Pick<pg.Pool | pg.PoolClient, 'query'>,
  query: CheckBarriersQuery
): Promise<CheckBarriersResult> {
  const wsId = query.workspaceId || query.binding?.workspaceId || query.epoch?.binding.workspaceId;

  let sql = 'SELECT * FROM slack_invalidation_barriers WHERE active = true';
  const params: unknown[] = [];
  if (wsId) {
    params.push(wsId);
    sql += ' AND workspace_id = $1';
  }
  sql += ' ORDER BY created_at, id';

  const res = await executor.query(sql, params);
  const barriers = res.rows;

  for (const b of barriers) {
    switch (b.barrier_type) {
      case 'binding': {
        if (query.binding && barrierMatchesBinding(b, query.binding)) {
          return { blocked: true, barrierType: 'binding', reason: b.reason, barrierId: b.id };
        }
        break;
      }

      case 'channel': {
        if (
          query.binding &&
          query.channelId &&
          b.channel_id === query.channelId &&
          barrierMatchesBinding(b, query.binding)
        ) {
          return { blocked: true, barrierType: 'channel', reason: b.reason, barrierId: b.id };
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
          if (b.min_valid_revision) {
            if (!query.revision) {
              return { blocked: true, barrierType: 'resource', reason: b.reason, barrierId: b.id };
            }
            if (compareSlackRevisions(query.revision, b.min_valid_revision) < 0) {
              return { blocked: true, barrierType: 'resource', reason: b.reason, barrierId: b.id };
            }
          }
        }
        break;
      }

      case 'provisional_auth': {
        if (query.binding && barrierMatchesBinding(b, query.binding)) {
          return { blocked: true, barrierType: 'provisional_auth', reason: b.reason, barrierId: b.id };
        }
        break;
      }
    }
  }

  return { blocked: false };
}

export class SlackInvalidationService {
  constructor(private readonly pool: pg.Pool) {}

  /**
   * Stages invalidation receipt, barriers, and intents within caller's real PostgreSQL transaction.
   * Caller is responsible for BEGIN / COMMIT / ROLLBACK.
   *
   * The serialization lock is acquired before the receipt check so concurrent duplicate events
   * cannot insert two receipts, and so a writer's in-transaction barrier check cannot race a
   * barrier commit for the same binding/resource/channel/epoch scope.
   */
  async stageInTransaction(
    client: pg.PoolClient,
    input: StageInTransactionInput
  ): Promise<StageInTransactionResult> {
    return this.stageIntentsInTransaction(client,input,false);
  }

  /** Separate receipt/hash domain for obligations reconstructed from derived
   * lineage. Never replay an immutable raw-policy receipt to append effects. */
  async stageDerivedInTransaction(client:pg.PoolClient,input:StageInTransactionInput):Promise<StageInTransactionResult> {
    await client.query('SAVEPOINT slack_derived_policy_tx_guard');
    await client.query('RELEASE SAVEPOINT slack_derived_policy_tx_guard');
    return this.stageIntentsInTransaction(client,input,true);
  }

  private async stageIntentsInTransaction(client:pg.PoolClient,input:StageInTransactionInput,derivedOnly:boolean):Promise<StageInTransactionResult> {
    if (!input || typeof input !== 'object') {
      throw new TypeError('stageInTransaction input must be an object');
    }
    const sourceEventKey = requireNonBlankString(input.sourceEventKey, 'sourceEventKey');
    const effects = normalizeInvalidationEffects(input.effects);
    const originalHash = hashInvalidationEffects(effects);
    const payloadHash = derivedOnly ? createHash('sha256').update(`derived-only:${originalHash}`).digest('hex') : originalHash;

    const lockKeys = [eventLockKey(sourceEventKey)];
    for (const effect of effects) {
      lockKeys.push(...slackInvalidationLockKeys(effect.barrier));
    }
    await acquireSlackInvalidationLocks(client, lockKeys);

    // 1. Idempotency check on receipt (under the event advisory lock)
    const existingReceiptRes = await client.query(
      'SELECT id, payload_hash FROM slack_invalidation_receipts WHERE source_event_key = $1',
      [sourceEventKey]
    );

    if (existingReceiptRes.rows[0]) {
      const existing = existingReceiptRes.rows[0];
      if (existing.payload_hash !== payloadHash) {
        throw new Error(
          'SLACK_INVALIDATION_PAYLOAD_CONFLICT: replay of sourceEventKey carries a different invalidation payload'
        );
      }
      const barrierIdsRes = await client.query(
        'SELECT id FROM slack_invalidation_barriers WHERE source_event_key = $1 ORDER BY id',
        [sourceEventKey]
      );
      const intentIdsRes = await client.query(
        'SELECT id FROM slack_invalidation_intents WHERE source_event_key = $1 ORDER BY id',
        [sourceEventKey]
      );
      return {
        receiptId: existing.id,
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
    for (const effect of effects) {
      const { effectKey, barrier: b, purgeTarget } = effect;

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
      let epochJson: SlackPolicyEpoch | null = null;
      let provisional = false;
      let provisionalAction: string | null = null;
      let provisionalSourceEventKey: string | null = null;
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
          provisionalSourceEventKey = b.sourceEventKey;
          credentialFingerprint = b.credentialFingerprint ?? null;
          break;
      }

      const barrierRes = await client.query(
        `INSERT INTO slack_invalidation_barriers (
          source_event_key, effect_key, barrier_type, workspace_id, connection_id,
          user_id, slack_user_id, identity_version, channel_id, resource_type,
          resource_id, min_valid_revision, deleted, epoch_hash, epoch_json,
          provisional, provisional_action, provisional_source_event_key,
          credential_fingerprint, reason
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
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
          provisionalSourceEventKey,
          credentialFingerprint,
          b.reason,
        ]
      );
      barrierIds.push(barrierRes.rows[0].id);

      // If purgeTarget provided, create intents (raw + cascade derived kinds).
      // Derived kinds stay pending here; 03B2 owns their execution seam.
      if (purgeTarget) {
        if (!derivedOnly) {
        const rawIntentRes = await client.query(
          `INSERT INTO slack_invalidation_intents (
            source_event_key, effect_key, target_kind, purge_target, status
          ) VALUES ($1, $2, 'slack_source_raw', $3, 'pending')
          RETURNING id`,
          [sourceEventKey, effectKey, JSON.stringify(purgeTarget)]
        );
        intentIds.push(rawIntentRes.rows[0].id);
        }

        for (const cascadeKind of purgeTarget.cascadeTargetKinds) {
          const cascadeRes = await client.query(
            `INSERT INTO slack_invalidation_intents (
              source_event_key, effect_key, target_kind, purge_target, status
            ) VALUES ($1, $2, $3, $4, 'pending')
            RETURNING id`,
            [sourceEventKey, effectKey, cascadeKind, JSON.stringify(purgeTarget)]
          );
          intentIds.push(cascadeRes.rows[0].id);
        }
      }
    }

    return { receiptId, barrierIds, intentIds };
  }

  async checkBarriers(query: CheckBarriersQuery, db: Pick<pg.Pool | pg.PoolClient, 'query'> = this.pool): Promise<CheckBarriersResult> {
    return checkSlackInvalidationBarriers(db, query);
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
