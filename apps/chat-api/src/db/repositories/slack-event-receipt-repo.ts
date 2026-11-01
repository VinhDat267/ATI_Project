import { createHash } from 'node:crypto';
import type pg from 'pg';
import {
  SLACK_DERIVED_TARGET_KINDS,
  type SlackBinding,
  type SlackPurgeTarget,
} from '@wap/tool-schemas';
import {
  acquireSlackInvalidationLocks,
  compareSlackRevisions,
  slackInvalidationLockKeys,
  type SlackInvalidationBarrier,
  type SlackInvalidationService,
  type StageInTransactionResult,
} from '../../services/slack/slack-invalidation-service.js';

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const SAFE_EVENT_ID = /^[A-Za-z0-9_-]{1,128}$/;
/** Slack documents event_context as an opaque string; this is only a transport bound. */
const MAX_EVENT_CONTEXT_LENGTH = 1024;

/**
 * Canonical native identity for a Slack message: an unambiguous JSON tuple, never underscore
 * concatenation, with the timestamp preserved as its exact string form. The workspace stays a
 * separate field so the same channel/ts in another workspace cannot collide.
 */
export function slackMessageResourceId(channelId: string, messageTs: string): string {
  return JSON.stringify([channelId, messageTs]);
}
const SLACK_TS = /^[0-9]{1,10}(\.[0-9]{1,6})?$/;
const CANONICAL_ISO = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$/;
const PAYLOAD_HASH = /^[0-9a-f]{64}$/;

export class SlackOwnerLockBusyError extends Error {
  constructor() {
    super('SLACK_OWNER_LOCK_BUSY');
    this.name = 'SlackOwnerLockBusyError';
  }
}

export class SlackStagingTimeoutError extends Error {
  constructor() {
    super('SLACK_STAGING_TIMEOUT');
    this.name = 'SlackStagingTimeoutError';
  }
}

export class SlackEventIdConflictError extends Error {
  constructor() {
    super('SLACK_EVENT_ID_CONFLICT');
    this.name = 'SlackEventIdConflictError';
  }
}

export class SlackStaleBindingError extends Error {
  constructor() {
    super('SLACK_STALE_BINDING');
    this.name = 'SlackStaleBindingError';
  }
}

export type SlackEventReceiptStatus =
  | 'pending_fanout'
  | 'pending_lifecycle'
  | 'discarded'
  | 'processed'
  | 'failed';

export interface SlackEventReceiptRow {
  id: string;
  slack_app_id: string;
  event_id: string;
  team_id: string;
  event_type: string;
  event_subtype: string | null;
  source_event_ts: string | null;
  source_event_time: Date | null;
  event_context: string | null;
  channel_id: string | null;
  message_ts: string | null;
  payload_hash: string;
  status: SlackEventReceiptStatus;
  discard_reason: string | null;
  created_at: Date;
  processed_at: Date | null;
}

/**
 * The durable intent payload carries only validated routing metadata, never event content.
 * sourceEventTime is the canonical UTC ISO string persisted in the receipt.
 */
export type SlackLifecycleIntentPayload =
  | {
      intentType: 'token_revocation_validation';
      binding: SlackBinding;
      credentialFingerprint: string;
      barrierId: string;
      sourceEventTime: string;
    }
  | {
      intentType: 'app_uninstall_validation';
      binding: SlackBinding;
      credentialFingerprint: string;
      barrierId: string;
      sourceEventTime: string;
    }
  | {
      intentType: 'message_deleted';
      workspaceId: string;
      channelId: string;
      messageTs: string;
      deletedTs: string;
      sourceEventTime: string;
    }
  | {
      intentType: 'message_changed';
      workspaceId: string;
      channelId: string;
      messageTs: string;
      editTs: string;
      sourceEventTime: string;
    };

export interface SlackLifecycleIntentRow {
  id: string;
  receipt_id: string;
  team_id: string;
  effect_key: string;
  intent_type: SlackLifecycleIntentPayload['intentType'];
  payload: SlackLifecycleIntentPayload;
  status: 'pending' | 'applied' | 'failed';
  created_at: Date;
  applied_at: Date | null;
}

export type SlackLifecycleDescriptor =
  | { intentType: 'token_revocation_validation'; slackUserIds: string[] }
  | { intentType: 'app_uninstall_validation' }
  | { intentType: 'message_deleted'; channelId: string; deletedTs: string }
  | { intentType: 'message_changed'; channelId: string; messageTs: string; editTs: string };

interface SlackEventInputBase {
  appId: string;
  eventId: string;
  teamId: string;
  eventType: string;
  eventSubtype: string | null;
  eventContext: string | null;
  sourceEventTs: string | null;
  sourceEventTimeIso: string | null;
  channelId: string | null;
  messageTs: string | null;
  payloadHash: string;
}

export interface RecordOrdinaryEventInput extends SlackEventInputBase {
  /** Set exactly when the source timestamp is missing or malformed. */
  discardReason: 'malformed_timestamp' | null;
  /** Optional signed-message metadata only, projected by the ingress boundary. */
  echo?: {slackUserId:string;clientMsgId:string|null};
  threadTs?:string|null;
}

export interface RecordLifecycleEventInput extends SlackEventInputBase {
  lifecycle: SlackLifecycleDescriptor;
}

export interface OrdinaryRecordResult {
  kind: 'recorded' | 'duplicate' | 'discarded';
  receipt: SlackEventReceiptRow;
}

export interface LifecycleRecordResult {
  kind: 'recorded' | 'duplicate';
  receipt: SlackEventReceiptRow;
  intents: SlackLifecycleIntentRow[];
  barrierIds: string[];
}

export interface SlackEventReceiptRepoOptions {
  /** Bounded lock wait, well inside Slack's 3s ACK budget. */
  lockTimeoutMs?: number;
  statementTimeoutMs?: number;
  maxPendingReceipts?:number;
}

export function slackEventSourceKey(appId: string, eventId: string): string {
  return `slack:${appId}:${eventId}`;
}

/** Mirrors 03B1's event advisory lock key so failures can be exercised against a real lock. */
export function slackEventLockKey(sourceEventKey: string): string {
  return `slack:v1:event:${JSON.stringify([sourceEventKey])}`;
}

function requireSafeId(value: unknown, field: string, eventId = false): string {
  if (typeof value !== 'string' || !(eventId ? SAFE_EVENT_ID : SAFE_ID).test(value)) {
    throw new TypeError(`Invalid ${field}`);
  }
  return value;
}

function optionalSafeId(value: unknown, field: string): string | null {
  if (value === null) return null;
  return requireSafeId(value, field);
}

function optionalTimestamp(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !SLACK_TS.test(value)) throw new TypeError(`Invalid ${field}`);
  return value;
}

function requireCanonicalIso(value: unknown, field: string): string {
  if (typeof value !== 'string' || !CANONICAL_ISO.test(value)) throw new TypeError(`Invalid ${field}`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`Invalid ${field}`);
  return value;
}

function normalizeBase(input: SlackEventInputBase, requireTime: boolean): SlackEventInputBase {
  if (!input || typeof input !== 'object') throw new TypeError('Invalid Slack event input');
  const appId = requireSafeId(input.appId, 'appId');
  const eventId = requireSafeId(input.eventId, 'eventId', true);
  const teamId = requireSafeId(input.teamId, 'teamId');
  const eventType = requireSafeId(input.eventType, 'eventType');
  let eventSubtype: string | null = null;
  if (input.eventSubtype !== null && input.eventSubtype !== undefined) {
    eventSubtype = requireSafeId(input.eventSubtype, 'eventSubtype');
  }
  let eventContext: string | null = null;
  if (input.eventContext !== null && input.eventContext !== undefined) {
    if (typeof input.eventContext !== 'string' || input.eventContext.length > MAX_EVENT_CONTEXT_LENGTH) {
      throw new TypeError('Invalid eventContext');
    }
    eventContext = input.eventContext;
  }
  const channelId = optionalSafeId(input.channelId, 'channelId');
  const messageTs = optionalTimestamp(input.messageTs, 'messageTs');
  const sourceEventTs = optionalTimestamp(input.sourceEventTs, 'sourceEventTs');
  const sourceEventTimeIso = input.sourceEventTimeIso === null
    ? null
    : requireCanonicalIso(input.sourceEventTimeIso, 'sourceEventTimeIso');
  if (requireTime && (sourceEventTs === null || sourceEventTimeIso === null)) {
    throw new TypeError('A lifecycle event requires an immutable source timestamp');
  }
  if (typeof input.payloadHash !== 'string' || !PAYLOAD_HASH.test(input.payloadHash)) {
    throw new TypeError('Invalid payloadHash');
  }
  return {
    appId,
    eventId,
    teamId,
    eventType,
    eventSubtype,
    eventContext,
    sourceEventTs,
    sourceEventTimeIso,
    channelId,
    messageTs,
    payloadHash: input.payloadHash,
  };
}

function normalizeDescriptor(value: unknown): SlackLifecycleDescriptor {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Invalid lifecycle descriptor');
  }
  const descriptor = value as Record<string, unknown>;
  switch (descriptor.intentType) {
    case 'token_revocation_validation': {
      if (!Array.isArray(descriptor.slackUserIds)) throw new TypeError('slackUserIds must be an array');
      if (descriptor.slackUserIds.length > 1000) throw new TypeError('slackUserIds is too large');
      const ids: string[] = [];
      const seen = new Set<string>();
      for (const id of descriptor.slackUserIds) {
        const clean = requireSafeId(id, 'slackUserId');
        if (!seen.has(clean)) {
          seen.add(clean);
          ids.push(clean);
        }
      }
      return { intentType: 'token_revocation_validation', slackUserIds: ids };
    }
    case 'app_uninstall_validation':
      return { intentType: 'app_uninstall_validation' };
    case 'message_deleted': {
      const channelId = requireSafeId(descriptor.channelId, 'channelId');
      const deletedTs = optionalTimestamp(descriptor.deletedTs, 'deletedTs');
      if (!deletedTs) throw new TypeError('message_deleted requires deletedTs');
      return { intentType: 'message_deleted', channelId, deletedTs };
    }
    case 'message_changed': {
      const channelId = requireSafeId(descriptor.channelId, 'channelId');
      const messageTs = optionalTimestamp(descriptor.messageTs, 'messageTs');
      const editTs = optionalTimestamp(descriptor.editTs, 'editTs');
      if (!messageTs || !editTs) throw new TypeError('message_changed requires messageTs and editTs');
      if (compareSlackRevisions(editTs, messageTs) < 0) {
        throw new TypeError('message_changed editTs precedes messageTs');
      }
      return { intentType: 'message_changed', channelId, messageTs, editTs };
    }
    default:
      throw new TypeError('Unknown lifecycle intent type');
  }
}

function mapReceiptRow(row: Record<string, unknown>): SlackEventReceiptRow {
  return {
    id: row.id as string,
    slack_app_id: row.slack_app_id as string,
    event_id: row.event_id as string,
    team_id: row.team_id as string,
    event_type: row.event_type as string,
    event_subtype: (row.event_subtype as string | null) ?? null,
    source_event_ts: (row.source_event_ts as string | null) ?? null,
    source_event_time: row.source_event_time ? new Date(row.source_event_time as string) : null,
    event_context: (row.event_context as string | null) ?? null,
    channel_id: (row.channel_id as string | null) ?? null,
    message_ts: (row.message_ts as string | null) ?? null,
    payload_hash: row.payload_hash as string,
    status: row.status as SlackEventReceiptStatus,
    discard_reason: (row.discard_reason as string | null) ?? null,
    created_at: new Date(row.created_at as string),
    processed_at: row.processed_at ? new Date(row.processed_at as string) : null,
  };
}

function mapIntentRow(row: Record<string, unknown>): SlackLifecycleIntentRow {
  return {
    id: row.id as string,
    receipt_id: row.receipt_id as string,
    team_id: row.team_id as string,
    effect_key: row.effect_key as string,
    intent_type: row.intent_type as SlackLifecycleIntentPayload['intentType'],
    payload: row.payload_json as SlackLifecycleIntentPayload,
    status: row.status as SlackLifecycleIntentRow['status'],
    created_at: new Date(row.created_at as string),
    applied_at: row.applied_at ? new Date(row.applied_at as string) : null,
  };
}

function fingerprint(config: string): string {
  return createHash('sha256').update(config).digest('hex');
}

function pgCode(err: unknown): string | undefined {
  if (!err || typeof err !== 'object' || !('code' in err)) return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

interface ConnectionCandidate {
  id: string;
  user_id: string;
  app_id: string;
  workspace_id: string;
  actor_id: string;
  identity_version: number;
  status: string;
  config: string | null;
}

export class SlackEventReceiptRepo {
  private readonly lockTimeoutMs: number;
  private readonly maxPendingReceipts:number;
  private readonly statementTimeoutMs: number;

  constructor(
    private readonly pool: pg.Pool,
    private readonly invalidationService: SlackInvalidationService,
    options: SlackEventReceiptRepoOptions = {}
  ) {
    this.maxPendingReceipts=options.maxPendingReceipts??10000;
    if(!Number.isSafeInteger(this.maxPendingReceipts)||this.maxPendingReceipts<1||this.maxPendingReceipts>10000)throw new TypeError('Invalid ingress capacity');
    this.lockTimeoutMs = options.lockTimeoutMs ?? 2000;
    this.statementTimeoutMs = options.statementTimeoutMs ?? 2500;
    if (!Number.isSafeInteger(this.lockTimeoutMs) || this.lockTimeoutMs <= 0 || this.lockTimeoutMs > 2500) {
      throw new TypeError('lockTimeoutMs must be between 1 and 2500');
    }
    if (!Number.isSafeInteger(this.statementTimeoutMs) || this.statementTimeoutMs <= 0 || this.statementTimeoutMs > 2900) {
      throw new TypeError('statementTimeoutMs must be between 1 and 2900');
    }
  }

  async recordOrdinary(input: RecordOrdinaryEventInput): Promise<OrdinaryRecordResult> {
    const base = normalizeBase(input, false);
    if(input.threadTs!==undefined&&input.threadTs!==null&&!SLACK_TS.test(input.threadTs))throw new TypeError('Invalid threadTs');
    const discarded = input.discardReason === 'malformed_timestamp';
    if (discarded) {
      if (base.sourceEventTs !== null || base.sourceEventTimeIso !== null) {
        throw new TypeError('A discarded event must not claim a source timestamp');
      }
    } else if (input.discardReason !== null) {
      throw new TypeError('Unknown discard reason');
    } else if (base.sourceEventTs === null || base.sourceEventTimeIso === null) {
      throw new TypeError('A live receipt requires a source timestamp');
    }

    return this.withTransaction(async client => {
      let echo:any;
      if(!discarded && base.eventType==='message' && base.eventSubtype===null && base.channelId && base.messageTs && input.echo){
        const actor=requireSafeId(input.echo.slackUserId,'slackUserId'),id=input.echo.clientMsgId;
        if(id!==null && (typeof id!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))throw new TypeError('Invalid echo metadata');
        echo=(await client.query(`SELECT operation_id,status FROM slack_write_outbox WHERE app_id=$1 AND workspace_id=$2
          AND slack_user_id=$3 AND channel_id=$4 AND status<>'prepared'
          AND (($5::uuid IS NOT NULL AND client_msg_id=$5::uuid) OR provider_ts=$6)
          ORDER BY created_at LIMIT 1`,[base.appId,base.teamId,actor,base.channelId,id,base.messageTs])).rows[0];
      }
      if(!discarded&&!echo){
        await client.query("SELECT pg_advisory_xact_lock(hashtext('ati-slack-ingress-capacity'))");
        const duplicate=await this.findReceipt(client,base.appId,base.eventId);
        if(duplicate){if(duplicate.payload_hash!==base.payloadHash)throw new SlackEventIdConflictError();return {kind:'duplicate',receipt:duplicate};}
        const size=(await client.query("SELECT count(*)::int AS n FROM slack_event_receipts WHERE status='pending_fanout' OR status='failed' AND fanout_attempts>0")).rows[0].n;
        if(size>=this.maxPendingReceipts)throw new Error('SLACK_INGRESS_CAPACITY');
      }
      const inserted = await client.query(
        `INSERT INTO slack_event_receipts (
           slack_app_id, event_id, team_id, event_type, event_subtype, source_event_ts,
           source_event_time, event_context, channel_id, message_ts, payload_hash, status,
           discard_reason, processed_at,thread_ts
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                   CASE WHEN $12 = 'discarded' THEN now() ELSE NULL END,$14)
         ON CONFLICT (slack_app_id, event_id) DO NOTHING
         RETURNING *`,
        [
          base.appId,
          base.eventId,
          base.teamId,
          base.eventType,
          base.eventSubtype,
          base.sourceEventTs,
          base.sourceEventTimeIso,
          base.eventContext,
          base.channelId,
          base.messageTs,
          base.payloadHash,
          discarded || echo ? 'discarded' : 'pending_fanout',
          discarded ? 'malformed_timestamp' : echo ? echo.status==='confirmed'?'ati_echo':'echo_pending' : null,
          input.threadTs??null,
        ]
      );

      if (inserted.rows[0]) {
        const receipt = mapReceiptRow(inserted.rows[0]);
        if(echo)await client.query(`INSERT INTO slack_echo_candidates(receipt_id,operation_id,native_ts,client_msg_id,status)
          VALUES($1,$2,$3,$4,$5)`,[receipt.id,echo.operation_id,base.messageTs,input.echo!.clientMsgId,echo.status==='confirmed'?'confirmed':'pending']);
        return { kind: discarded || echo ? 'discarded' : 'recorded', receipt };
      }

      const existing = await this.findReceipt(client, base.appId, base.eventId);
      if (!existing) throw new Error('SLACK_EVENT_RECEIPT_NOT_VISIBLE');
      if (existing.payload_hash !== base.payloadHash) throw new SlackEventIdConflictError();
      return { kind: 'duplicate', receipt: existing };
    });
  }

  async recordLifecycle(input: RecordLifecycleEventInput): Promise<LifecycleRecordResult> {
    const base = normalizeBase(input, true);
    const descriptor = normalizeDescriptor(input.lifecycle);
    const sourceEventKey = slackEventSourceKey(base.appId!, base.eventId!);

    return this.withTransaction(async client => {
      const inserted = await client.query(
        `INSERT INTO slack_event_receipts (
           slack_app_id, event_id, team_id, event_type, event_subtype, source_event_ts,
           source_event_time, event_context, channel_id, message_ts, payload_hash, status,
           discard_reason, processed_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending_lifecycle', NULL, NULL)
         ON CONFLICT (slack_app_id, event_id) DO NOTHING
         RETURNING *`,
        [
          base.appId,
          base.eventId,
          base.teamId,
          base.eventType,
          base.eventSubtype,
          base.sourceEventTs,
          base.sourceEventTimeIso,
          base.eventContext,
          base.channelId,
          base.messageTs,
          base.payloadHash,
        ]
      );

      if (!inserted.rows[0]) {
        const existing = await this.findReceipt(client, base.appId!, base.eventId!);
        if (!existing) throw new Error('SLACK_EVENT_RECEIPT_NOT_VISIBLE');
        if (existing.payload_hash !== base.payloadHash) throw new SlackEventIdConflictError();
        const intents = await this.findIntents(client, existing.id);
        return { kind: 'duplicate', receipt: existing, intents, barrierIds: [] };
      }

      const receipt = mapReceiptRow(inserted.rows[0]);
      const effects: Array<{
        effectKey: string;
        barrier: SlackInvalidationBarrier;
        purgeTarget?: SlackPurgeTarget;
        connection?: ConnectionCandidate;
      }> = [];

      if (descriptor.intentType === 'token_revocation_validation' || descriptor.intentType === 'app_uninstall_validation') {
        const candidates = await this.selectConnections(client, base.appId!, base.teamId!, descriptor);
        const lockedUsers = new Set<string>();
        const userIds = [...new Set(candidates.map(row => row.user_id))].sort();
        for (const userId of userIds) {
          const lock = await client.query<{ locked: boolean }>(
            "SELECT pg_try_advisory_xact_lock(hashtext('ati-slack-owner'), hashtext($1)) AS locked",
            [userId]
          );
          if (lock.rows[0]?.locked !== true) throw new SlackOwnerLockBusyError();
          lockedUsers.add(userId);
        }

        // Owner locks stabilize credentials and generation; acquire the same advisory
        // scope as source writers BEFORE taking connection row locks. Taking FOR UPDATE
        // first would deadlock a writer holding the advisory lock before FOR SHARE.
        const stable = await this.selectConnections(client, base.appId!, base.teamId!, descriptor);
        const advisoryKeys = [slackEventLockKey(sourceEventKey)];
        for (const row of stable) {
          if (!lockedUsers.has(row.user_id)) throw new SlackOwnerLockBusyError();
          advisoryKeys.push(...slackInvalidationLockKeys({
            barrierType: 'binding',
            binding: {
              atiUserId: row.user_id,
              connectionId: row.id,
              workspaceId: row.workspace_id,
              slackUserId: row.actor_id,
              identityVersion: row.identity_version,
            },
            reason: 'lifecycle_validation_pending',
          }));
        }
        await acquireSlackInvalidationLocks(client, advisoryKeys);
        const current = await this.selectConnections(client, base.appId!, base.teamId!, descriptor, true);
        for (const row of current) {
          const captured = stable.find(candidate => candidate.id === row.id);
          if (!lockedUsers.has(row.user_id) || !captured ||
              captured.identity_version !== row.identity_version ||
              captured.actor_id !== row.actor_id || captured.config !== row.config) {
            throw new SlackStaleBindingError();
          }
        }

        for (const row of current) {
          const binding: SlackBinding = {
            atiUserId: row.user_id,
            connectionId: row.id,
            workspaceId: row.workspace_id,
            slackUserId: row.actor_id,
            identityVersion: row.identity_version,
          };
          if (!row.config) {
            // This generation is already unusable in ATI (e.g. refresh/decrypt failure).
            // There is no credential to probe. Durably invalidate only this generation;
            // a later OAuth grant increments identity_version under the same owner lock.
            // This makes no assertion about the provider's current credential generation.
            effects.push({
              effectKey: `unavailable:${row.id}`,
              barrier: { barrierType: 'binding', binding, reason: 'credential_unavailable' },
              purgeTarget: {
                scope: 'authorization_disconnect', binding,
                cascadeTargetKinds: [...SLACK_DERIVED_TARGET_KINDS],
                tombstoneReason: 'connection_disconnected',
              },
              connection: row,
            });
            continue;
          }
          effects.push({
            effectKey: `provisional:${row.id}`,
            barrier: {
              barrierType: 'provisional_auth',
              binding,
              sourceEventKey,
              credentialFingerprint: fingerprint(row.config),
              provisionalAction: descriptor.intentType,
              reason: descriptor.intentType === 'token_revocation_validation' ? 'token_revoked' : 'app_uninstalled',
            },
            connection: row,
          });
        }
      } else if (descriptor.intentType === 'message_deleted') {
        const resourceId = slackMessageResourceId(descriptor.channelId, descriptor.deletedTs);
        effects.push({
          effectKey: `resource:${resourceId}`,
          barrier: {
            barrierType: 'resource',
            workspaceId: base.teamId!,
            resourceType: 'message',
            resourceId,
            deleted: true,
            reason: 'source_deleted',
          },
          purgeTarget: {
            scope: 'resource_lifecycle',
            workspaceId: base.teamId!,
            resourceType: 'message',
            resourceId,
            cascadeTargetKinds: [...SLACK_DERIVED_TARGET_KINDS],
            tombstoneReason: 'source_deleted',
          },
        });
      } else {
        const resourceId = slackMessageResourceId(descriptor.channelId, descriptor.messageTs);
        effects.push({
          effectKey: `resource:${resourceId}`,
          barrier: {
            barrierType: 'resource',
            workspaceId: base.teamId!,
            resourceType: 'message',
            resourceId,
            minValidRevision: descriptor.editTs,
            deleted: false,
            reason: 'source_edited',
          },
          purgeTarget: {
            scope: 'resource_lifecycle',
            workspaceId: base.teamId!,
            resourceType: 'message',
            resourceId,
            beforeRevision: descriptor.editTs,
            cascadeTargetKinds: [...SLACK_DERIVED_TARGET_KINDS],
            tombstoneReason: 'source_edited',
          },
        });
      }

      let staged: StageInTransactionResult = { receiptId: '', barrierIds: [], intentIds: [] };
      if (effects.length > 0) {
        staged = await this.invalidationService.stageInTransaction(client, {
          sourceEventKey,
          effects: effects.map(effect => ({
            effectKey: effect.effectKey,
            barrier: effect.barrier,
            ...(effect.purgeTarget ? { purgeTarget: effect.purgeTarget } : {}),
          })),
        });
      }

      for (let index = 0; index < effects.length; index++) {
        const effect = effects[index];
        if (!effect) continue;
        if (effect.connection) {
          const updated = await client.query(
            `UPDATE slack_connections
             SET status = 'reconnect_required'
             WHERE id = $1 AND user_id = $2 AND identity_version = $3
               AND status IN ('active', 'reconnect_required')`,
            [effect.connection.id, effect.connection.user_id, effect.connection.identity_version]
          );
          if (updated.rowCount !== 1) throw new SlackStaleBindingError();
        }
      }

      const intents: SlackLifecycleIntentRow[] = [];
      for (let index = 0; index < effects.length; index++) {
        const effect = effects[index];
        if (!effect) continue;
        // Credentialless generations already have durable binding/purge effects above;
        // creating an auth.test job for them would poison retries for healthy bindings.
        if (effect.connection && !effect.connection.config) continue;
        const barrierId = staged.barrierIds[index];
        if (!barrierId) throw new Error('SLACK_BARRIER_NOT_STAGED');
        const payload = this.buildIntentPayload(descriptor, effect.connection, barrierId, base);
        const intent = await client.query(
          `INSERT INTO slack_lifecycle_intents (
             receipt_id, team_id, effect_key, intent_type, payload_json
           ) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (receipt_id, effect_key) DO NOTHING
           RETURNING *`,
          [receipt.id, base.teamId, effect.effectKey, descriptor.intentType, JSON.stringify(payload)]
        );
        if (intent.rows[0]) intents.push(mapIntentRow(intent.rows[0]));
      }

      return { kind: 'recorded', receipt, intents, barrierIds: staged.barrierIds };
    });
  }

  async purgeExpiredReceipts(now: Date, limit = 5000): Promise<{ purgedCount: number }> {
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new TypeError('Invalid cleanup clock');
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 10000) throw new TypeError('Invalid cleanup limit');
    const result = await this.pool.query(
      `DELETE FROM slack_event_receipts
       WHERE id IN (
         SELECT r.id FROM slack_event_receipts r
         WHERE r.created_at < $1::timestamptz - interval '7 days'
           AND NOT EXISTS (
             SELECT 1 FROM slack_lifecycle_intents i
             WHERE i.receipt_id=r.id AND i.status <> 'applied'
           )
         ORDER BY r.created_at
         LIMIT $2
       )`,
      [now.toISOString(), limit]
    );
    return { purgedCount: result.rowCount ?? 0 };
  }

  private buildIntentPayload(
    descriptor: SlackLifecycleDescriptor,
    connection: ConnectionCandidate | undefined,
    barrierId: string,
    base: SlackEventInputBase
  ): SlackLifecycleIntentPayload {
    const sourceEventTime = base.sourceEventTimeIso!;
    if (descriptor.intentType === 'token_revocation_validation' || descriptor.intentType === 'app_uninstall_validation') {
      if (!connection || !connection.config) throw new Error('SLACK_CONNECTION_CONFIG_MISSING');
      return {
        intentType: descriptor.intentType,
        binding: {
          atiUserId: connection.user_id,
          connectionId: connection.id,
          workspaceId: connection.workspace_id,
          slackUserId: connection.actor_id,
          identityVersion: connection.identity_version,
        },
        credentialFingerprint: fingerprint(connection.config),
        barrierId,
        sourceEventTime,
      };
    }
    if (descriptor.intentType === 'message_deleted') {
      return {
        intentType: 'message_deleted',
        workspaceId: base.teamId,
        channelId: descriptor.channelId,
        messageTs: descriptor.deletedTs,
        deletedTs: descriptor.deletedTs,
        sourceEventTime,
      };
    }
    return {
      intentType: 'message_changed',
      workspaceId: base.teamId,
      channelId: descriptor.channelId,
      messageTs: descriptor.messageTs,
      editTs: descriptor.editTs,
      sourceEventTime,
    };
  }

  private async selectConnections(
    client: pg.PoolClient,
    appId: string,
    teamId: string,
    descriptor: Extract<SlackLifecycleDescriptor, { intentType: 'token_revocation_validation' | 'app_uninstall_validation' }>,
    forUpdate = false
  ): Promise<ConnectionCandidate[]> {
    const actorClause = descriptor.intentType === 'token_revocation_validation'
      ? 'AND actor_id = ANY($3::text[])'
      : '';
    const params: unknown[] = descriptor.intentType === 'token_revocation_validation'
      ? [appId, teamId, descriptor.slackUserIds]
      : [appId, teamId];
    const result = await client.query<ConnectionCandidate>(
      `SELECT id, user_id, app_id, workspace_id, actor_id, identity_version, status, config
       FROM slack_connections
       WHERE app_id = $1 AND workspace_id = $2 AND status <> 'disconnected' ${actorClause}
       ORDER BY user_id, id
       ${forUpdate ? 'FOR UPDATE' : ''}`,
      params
    );
    return result.rows;
  }

  private async findReceipt(
    client: pg.PoolClient,
    appId: string,
    eventId: string
  ): Promise<SlackEventReceiptRow | null> {
    const result = await client.query(
      'SELECT * FROM slack_event_receipts WHERE slack_app_id = $1 AND event_id = $2',
      [appId, eventId]
    );
    return result.rows[0] ? mapReceiptRow(result.rows[0]) : null;
  }

  private async findIntents(
    client: pg.PoolClient,
    receiptId: string
  ): Promise<SlackLifecycleIntentRow[]> {
    const result = await client.query(
      'SELECT * FROM slack_lifecycle_intents WHERE receipt_id = $1 ORDER BY effect_key',
      [receiptId]
    );
    return result.rows.map(mapIntentRow);
  }

  private async acquireBefore(deadline: number): Promise<pg.PoolClient> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        settled = true;
        reject(new SlackStagingTimeoutError());
      }, Math.max(1, deadline - Date.now()));
      this.pool.connect().then(client => {
        clearTimeout(timer);
        if (settled) { client.release(); return; }
        settled = true;
        resolve(client);
      }, error => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        reject(error);
      });
    });
  }

  private async withTransaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    // One ACK budget includes pool acquisition and every statement, rather than
    // granting a new multi-second timeout to each lock/query in a large event.
    const deadline = Date.now() + this.statementTimeoutMs;
    const client = await this.acquireBefore(deadline);
    let discard = false;
    const remaining = () => {
      const ms = deadline - Date.now();
      if (ms <= 0) throw new SlackStagingTimeoutError();
      return ms;
    };
    const run = (text: string, values?: unknown[], timeout = remaining()) => {
      // pg supports a per-query read timeout; the server-side statement_timeout
      // below additionally cancels actual database work within the same budget.
      const config = { text, values, query_timeout: timeout };
      return client.query(config);
    };
    const bounded = new Proxy(client, {
      get(target, key) {
        if (key !== 'query') return Reflect.get(target, key, target);
        return async (text: string, values?: unknown[]) => {
          await run("SELECT set_config('statement_timeout', $1, true)", [String(remaining())]);
          return run(text, values);
        };
      },
    });
    try {
      await run('BEGIN');
      await bounded.query(`SET LOCAL lock_timeout = '${this.lockTimeoutMs}ms'`);
      const result = await work(bounded);
      await bounded.query('COMMIT');
      return result;
    } catch (err) {
      const readTimedOut = err instanceof Error && err.message === 'Query read timeout';
      try {
        const rollbackBudget = deadline - Date.now();
        if (readTimedOut || rollbackBudget <= 0) discard = true;
        else await run('ROLLBACK', undefined, rollbackBudget);
      } catch {
        discard = true;
      }
      const code = pgCode(err);
      if (readTimedOut || code === '55P03' || code === '57014') throw new SlackStagingTimeoutError();
      throw err;
    } finally {
      client.release(discard);
    }
  }
}
