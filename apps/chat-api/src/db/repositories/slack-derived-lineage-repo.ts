import type pg from 'pg';
import {
  formatSlackOwnerSourceKey, sameSlackBinding, sameSlackPolicyEpoch, slackPolicyRefToEpoch,
  validateSlackPolicyReference, validateSlackSourceRef,
  type SlackDerivedTargetKind, type SlackPolicyReference, type SlackSourceRef,
} from '@wap/tool-schemas';
import type { SlackPolicyService } from '../../services/slack/policy-service.js';
import {
  acquireSlackInvalidationLocks, checkSlackInvalidationBarriers, slackSourceWriteLockKeys,
} from '../../services/slack/slack-invalidation-service.js';
import { isUuid } from './uuid.js';
import { messageFingerprint as fingerprint } from '../../services/slack/slack-message-selectors.js';
import { lockSlackArtifact,slackArtifactLocation,slackArtifactValue,validateSlackArtifactTarget } from '../../services/slack/slack-artifact-targets.js';

/** Private server acquisition context, never HTTP/model-supplied lineage. */
export interface DerivedSegmentInput {
  sourceRef: SlackSourceRef;
  acquisitionPolicyRef: SlackPolicyReference;
  storagePolicyRef: SlackPolicyReference;
  captureHash: string;
  channelId?: string;
  rawSourceId?: string;
  capturedAt: string;
}
export interface RegisterDerivedCopyInput {
  atiUserId: string;
  targetKind: SlackDerivedTargetKind;
  targetId: string;
  targetSubId: string;
  segments: DerivedSegmentInput[];
}
interface Target { atiUserId: string; targetKind: SlackDerivedTargetKind; targetId: string; targetSubId: string }
interface Copy { derivedCopyId: string; targetVersion: string; targetFingerprint: string }
export interface AssertDerivedCopyAllowedInput {
  callerAtiUserId: string;
  consumerPurpose: 'manual_lookup' | 'triage' | 'planning' | 'digest';
  targetKind: SlackDerivedTargetKind;
  targetId: string;
  targetSubId: string;
  expectedTargetVersion: string;
  signal?: AbortSignal;
}
export type DerivedAccessDecision = { status: 'allowed' } | {
  status: 'blocked'; reason: string; tombstone: string;
};
const TOMBSTONE = 'Slack content is unavailable.';
const DAY = 86_400_000;
function deny(reason: string): never { throw new Error(reason); }
function version(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,18}$/.test(value) ||
      BigInt(value) > 9223372036854775807n) deny('version_mismatch');
  return value;
}
function validateTarget(target: Target): void {
  if (!isUuid(target.atiUserId) || !isUuid(target.targetId)) deny('invalid_target');
  validateSlackArtifactTarget(target.targetKind, target.targetSubId);
}
function cleanSegment(input: DerivedSegmentInput, owner: string): DerivedSegmentInput {
  if (!input || typeof input !== 'object') deny('invalid_segment');
  const sourceRef = validateSlackSourceRef(input.sourceRef);
  const acquisitionPolicyRef = validateSlackPolicyReference(input.acquisitionPolicyRef);
  const storagePolicyRef = validateSlackPolicyReference(input.storagePolicyRef);
  if (sourceRef.binding.atiUserId !== owner || !sameSlackBinding(sourceRef.binding, acquisitionPolicyRef.binding) ||
      !sameSlackBinding(sourceRef.binding, storagePolicyRef.binding)) deny('unauthorized_caller');
  if (acquisitionPolicyRef.purpose === 'storage' || storagePolicyRef.purpose !== 'storage' ||
      !sameSlackPolicyEpoch(slackPolicyRefToEpoch(acquisitionPolicyRef), slackPolicyRefToEpoch(storagePolicyRef))) deny('stale_lineage');
  if (storagePolicyRef.requestedRetentionDays <= 0 || storagePolicyRef.requestedRetentionDays > 30 ||
      !/^[a-f0-9]{64}$/.test(input.captureHash)) deny('invalid_segment');
  const captured = new Date(input.capturedAt);
  if (!Number.isFinite(captured.getTime()) || captured.toISOString() !== input.capturedAt || captured.getTime() > Date.now()) deny('invalid_capture_clock');
  if (captured.getTime() + storagePolicyRef.requestedRetentionDays * DAY <= Date.now()) deny('retention_expired');
  if (input.rawSourceId !== undefined && !isUuid(input.rawSourceId)) deny('invalid_segment');
  if (input.channelId !== undefined && (typeof input.channelId !== 'string' || !input.channelId.trim())) deny('invalid_segment');
  let channelId = input.channelId;
  if (sourceRef.resourceType === 'message') {
    let tuple: unknown;
    try { tuple = JSON.parse(sourceRef.resourceId); } catch { deny('stale_lineage'); }
    if (!Array.isArray(tuple) || tuple.length !== 2 || typeof tuple[0] !== 'string' || !tuple[0].trim() ||
        typeof tuple[1] !== 'string' || !/^[0-9]{1,10}(?:[.][0-9]{1,6})?$/.test(tuple[1]) ||
        JSON.stringify(tuple) !== sourceRef.resourceId) deny('stale_lineage');
    if (channelId !== undefined && channelId !== tuple[0]) deny('stale_lineage');
    channelId = tuple[0];
  } else if (sourceRef.resourceType === 'conversation') {
    if (channelId !== undefined && channelId !== sourceRef.resourceId) deny('stale_lineage');
    channelId = sourceRef.resourceId;
  }
  return { sourceRef, acquisitionPolicyRef, storagePolicyRef, captureHash: input.captureHash,
    capturedAt: input.capturedAt, ...(channelId ? { channelId } : {}),
    ...(input.rawSourceId ? { rawSourceId: input.rawSourceId } : {}) };
}
function copy(row: any): Copy {
  return { derivedCopyId: row.id, targetVersion: version(row.target_version), targetFingerprint: row.target_fingerprint };
}
function fromRow(row: any): DerivedSegmentInput {
  const binding = { atiUserId: row.ati_user_id, connectionId: row.connection_id,
    workspaceId: row.workspace_id, slackUserId: row.slack_user_id, identityVersion: row.identity_version };
  const common = { binding, providerProfileId: row.provider_profile_id, configFingerprint: row.config_fingerprint,
    policyVersion: row.policy_version, consentRevision: row.consent_revision, providerRevision: row.provider_revision };
  return { sourceRef: { binding, resourceType: row.resource_type, resourceId: row.resource_id, revision: row.revision },
    acquisitionPolicyRef: { ...common, purpose: row.acquisition_purpose, requestedRetentionDays: row.acquisition_requested_retention_days },
    storagePolicyRef: { ...common, purpose: 'storage', requestedRetentionDays: row.storage_requested_retention_days },
    captureHash: row.capture_hash, capturedAt: row.captured_at.toISOString(),
    ...(row.channel_id ? { channelId: row.channel_id } : {}), ...(row.raw_source_id ? { rawSourceId: row.raw_source_id } : {}) };
}

/** Concrete message/memory/plan/step/audit selectors. Future/schedule kinds remain fail-closed. */
export class SlackDerivedLineageRepo {
  constructor(private readonly pool: pg.Pool, private readonly policy: Pick<SlackPolicyService, 'resolveSlackModelPolicy'>) {}

  private normalize(input: RegisterDerivedCopyInput): DerivedSegmentInput[] {
    validateTarget(input);
    for (const key of Object.keys(input)) {
      if (!['atiUserId', 'targetKind', 'targetId', 'targetSubId', 'segments'].includes(key)) deny('unexpected_registration_field');
    }
    if (!Array.isArray(input.segments) || input.segments.length === 0 || input.segments.length > 256) deny('empty_segments');
    return input.segments.map(s => cleanSegment(s, input.atiUserId));
  }

  private async requireTransaction(client: pg.PoolClient): Promise<void> {
    await client.query('SAVEPOINT slack_derived_tx_guard');
    await client.query('RELEASE SAVEPOINT slack_derived_tx_guard');
  }

  private async lockSources(client: pg.PoolClient, segments: DerivedSegmentInput[]): Promise<void> {
    await acquireSlackInvalidationLocks(client, segments.flatMap(s => slackSourceWriteLockKeys({
      binding: s.sourceRef.binding, epoch: slackPolicyRefToEpoch(s.storagePolicyRef),
      resourceType: s.sourceRef.resourceType, resourceId: s.sourceRef.resourceId, channelId: s.channelId,
    })));
  }

  private async lockTarget(client: pg.PoolClient, target: Target, write: boolean,
    segments: DerivedSegmentInput[], purpose?: AssertDerivedCopyAllowedInput['consumerPurpose']): Promise<unknown> {
    const found = await slackArtifactLocation(client,target);
    const mode = write ? 'UPDATE' : 'SHARE';
    const conversation = await client.query(`SELECT id FROM conversations WHERE id=$1 AND user_id=$2 FOR ${mode}`,
      [found.convId, target.atiUserId]);
    if (conversation.rowCount !== 1) deny('unauthorized_caller');
    await this.authorize(client, segments, purpose);
    // Parent first; re-read the concrete artifact under its own lock after the parent.
    const artifact = await lockSlackArtifact(client,target,mode);
    if (artifact.convId !== found.convId) deny('stale_lineage');
    return slackArtifactValue(artifact.row, target.targetKind, target.targetSubId);
  }

  private async authorize(client: pg.PoolClient, segments: DerivedSegmentInput[], purpose?: AssertDerivedCopyAllowedInput['consumerPurpose']): Promise<void> {
    // Global authority order also handles outputs containing several Slack workspaces.
    const users = [...new Set(segments.map(s => s.sourceRef.binding.atiUserId))].sort();
    const connections = [...new Set(segments.map(s => s.sourceRef.binding.connectionId))].sort();
    const providers = [...new Set(segments.map(s => s.storagePolicyRef.providerProfileId))].sort();
    await client.query('SELECT id FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE', [users]);
    await client.query('SELECT id FROM slack_connections WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE', [connections]);
    await client.query('SELECT id FROM slack_trusted_providers WHERE id=ANY($1::text[]) ORDER BY id FOR SHARE', [providers]);
    for (const key of [...new Set(segments.map(s => JSON.stringify([s.sourceRef.binding.workspaceId, s.storagePolicyRef.providerProfileId])))].sort()) {
      await client.query('SELECT workspace_id FROM slack_processing_consents WHERE workspace_id=$1 AND provider_id=$2 FOR SHARE', JSON.parse(key));
    }
    for (const s of segments) {
      const ref = s.storagePolicyRef;
      const storage = await this.policy.resolveSlackModelPolicy({ binding: ref.binding, purpose: 'storage',
        requestedRetentionDays: ref.requestedRetentionDays, expectedPolicyReference: ref }, client);
      if (storage.allowed !== true) deny('policy_changed');
      if (purpose) {
        const consumption = await this.policy.resolveSlackModelPolicy({ binding: ref.binding, purpose,
          requestedRetentionDays: 0, expectedPolicyReference: { ...s.acquisitionPolicyRef, purpose, requestedRetentionDays: 0 } }, client);
        if (consumption.allowed !== true) deny('policy_changed');
      }
      const barrier = await checkSlackInvalidationBarriers(client, { binding: ref.binding,
        epoch: slackPolicyRefToEpoch(ref), workspaceId: ref.binding.workspaceId, channelId: s.channelId,
        resourceType: s.sourceRef.resourceType, resourceId: s.sourceRef.resourceId, revision: s.sourceRef.revision });
      if (barrier.blocked !== false) deny('blocked_by_barrier');
    }
  }

  /** Call BEFORE changing existing message content, then register in this same transaction.
   * This gives artifact writers the common advisory -> conversation -> artifact lock order.
   */
  async prepareMessageWriteInTransaction(client: pg.PoolClient, input: RegisterDerivedCopyInput): Promise<void> {
    const segments = this.normalize(input);
    await this.requireTransaction(client);
    await this.lockSources(client, segments);
    await this.lockTarget(client, input, true, segments);
  }

  /** Whole source union before any conversation/artifact locks, including new artifacts. */
  async prepareConversationWriteInTransaction(client: pg.PoolClient, convId: string, atiUserId: string,
    inputs: DerivedSegmentInput[], purpose?: AssertDerivedCopyAllowedInput['consumerPurpose']): Promise<void> {
    if (!isUuid(convId) || !isUuid(atiUserId) || inputs.length === 0 || inputs.length > 256) deny('invalid_target');
    const segments = inputs.map(s => cleanSegment(s, atiUserId));
    await this.requireTransaction(client);
    await this.lockSources(client, segments);
    if ((await client.query('SELECT id FROM conversations WHERE id=$1 AND user_id=$2 FOR UPDATE', [convId, atiUserId])).rowCount !== 1) deny('unauthorized_caller');
    await this.authorize(client, segments, purpose);
  }

  async lockSegmentsInTransaction(client: pg.PoolClient, inputs: DerivedSegmentInput[], owner: string): Promise<void> {
    await this.requireTransaction(client);
    await this.lockSources(client, inputs.map(s => cleanSegment(s, owner)));
  }

  /** Already acquired as part of the caller's complete source-lock union before any row locks. */
  async assertSegmentsAllowedInTransaction(client:pg.PoolClient,inputs:DerivedSegmentInput[],owner:string,purpose:AssertDerivedCopyAllowedInput['consumerPurpose']):Promise<void>{
    await this.requireTransaction(client);
    if(inputs.length===0||inputs.length>256)deny('empty_segments');
    const segments=inputs.map(s=>cleanSegment(s,owner));await this.authorize(client,segments,purpose);
  }

  async segmentsInTransaction(client: pg.PoolClient, copyId: string): Promise<DerivedSegmentInput[]> {
    return (await client.query('SELECT * FROM slack_derived_provenance_segments WHERE derived_copy_id=$1 ORDER BY segment_index', [copyId])).rows.map(fromRow);
  }

  async registerDerivedCopyInTransaction(client: pg.PoolClient, input: RegisterDerivedCopyInput): Promise<Copy> {
    const segments = this.normalize(input);
    await this.requireTransaction(client);
    await this.lockSources(client, segments);
    const content = await this.lockTarget(client, input, true, segments);
    if (content === undefined) deny('not_found');
    await client.query(`UPDATE slack_derived_copies SET status='retired',retired_at=statement_timestamp(),
      retired_reason='superseded',updated_at=statement_timestamp() WHERE ati_user_id=$1 AND target_kind=$2
      AND target_id=$3 AND target_sub_id=$4 AND status='active'`,
    [input.atiUserId, input.targetKind, input.targetId, input.targetSubId]);
    const row = (await client.query(`INSERT INTO slack_derived_copies(ati_user_id,target_kind,target_id,target_sub_id,target_fingerprint)
      VALUES($1,$2,$3,$4,$5) RETURNING *`, [input.atiUserId,input.targetKind,input.targetId,input.targetSubId,fingerprint(content,input.targetSubId)])).rows[0];
    for (const [index,s] of segments.entries()) {
      const b = s.sourceRef.binding, p = s.storagePolicyRef, a = s.acquisitionPolicyRef;
      await client.query(`INSERT INTO slack_derived_provenance_segments(derived_copy_id,segment_index,capture_hash,
        raw_source_id,owner_source_key,resource_type,resource_id,revision,channel_id,ati_user_id,connection_id,
        workspace_id,slack_user_id,identity_version,provider_profile_id,config_fingerprint,policy_version,
        consent_revision,provider_revision,acquisition_purpose,acquisition_requested_retention_days,
        storage_requested_retention_days,effective_retention_days,captured_at,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$22,$23,$24)`,
      [row.id,index,s.captureHash,s.rawSourceId ?? null,formatSlackOwnerSourceKey(s.sourceRef),s.sourceRef.resourceType,
        s.sourceRef.resourceId,s.sourceRef.revision,s.channelId ?? null,b.atiUserId,b.connectionId,b.workspaceId,b.slackUserId,
        b.identityVersion,p.providerProfileId,p.configFingerprint,p.policyVersion,p.consentRevision,p.providerRevision,
        a.purpose,a.requestedRetentionDays,p.requestedRetentionDays,s.capturedAt,
        new Date(Date.parse(s.capturedAt) + p.requestedRetentionDays * DAY)]);
    }
    return copy(row);
  }

  async getActiveCopyInTransaction(client: pg.PoolClient, target: Target): Promise<Copy | null> {
    validateTarget(target);
    const row = (await client.query(`SELECT * FROM slack_derived_copies WHERE ati_user_id=$1 AND target_kind=$2
      AND target_id=$3 AND target_sub_id=$4 AND status='active'`,
    [target.atiUserId,target.targetKind,target.targetId,target.targetSubId])).rows[0];
    return row ? copy(row) : null;
  }

  async assertDerivedCopyAllowed(input: AssertDerivedCopyAllowedInput): Promise<DerivedAccessDecision> {
    const snapshot = { ...input };
    const operation = this.assertInTransaction(snapshot);
    const signal = snapshot.signal;
    if (!signal) return operation;
    return new Promise(resolve => {
      const finish = (decision: DerivedAccessDecision) => {
        signal.removeEventListener('abort', onAbort);
        resolve(decision);
      };
      const onAbort = () => finish({ status: 'blocked', reason: 'aborted', tombstone: TOMBSTONE });
      signal.addEventListener('abort', onAbort, { once: true });
      // Observe late completion/rejection; the transaction checks cancellation before
      // commit. A caller never receives a late allowed decision after abort wins.
      operation.then(finish, () => finish({ status: 'blocked', reason: 'stale_lineage', tombstone: TOMBSTONE }));
      if (signal.aborted) onAbort();
    });
  }

  async assertDerivedCopyAllowedInTransaction(client: pg.PoolClient, input: AssertDerivedCopyAllowedInput): Promise<DerivedAccessDecision> {
    await this.requireTransaction(client);
    return this.assertInTransaction(input, client);
  }

  private async assertInTransaction(input: AssertDerivedCopyAllowedInput, heldClient?: pg.PoolClient): Promise<DerivedAccessDecision> {
    let client: pg.PoolClient | undefined;
    try {
      if (input.signal?.aborted) deny('aborted');
      const target = { atiUserId: input.callerAtiUserId, targetKind: input.targetKind,
        targetId: input.targetId, targetSubId: input.targetSubId };
      validateTarget(target);
      const expected = version(input.expectedTargetVersion);
      if (!['manual_lookup','triage','planning','digest'].includes(input.consumerPurpose)) deny('invalid_purpose');
      client = heldClient ?? await this.pool.connect();
      if (!heldClient) { await client.query('BEGIN'); await client.query("SET LOCAL statement_timeout='5s'"); }
      const first = await this.getActiveCopyInTransaction(client, target);
      if (!first || first.targetVersion !== expected) deny('version_mismatch');
      const rows = (await client.query('SELECT * FROM slack_derived_provenance_segments WHERE derived_copy_id=$1 ORDER BY segment_index', [first.derivedCopyId])).rows;
      if (rows.length === 0 || rows.length > 256) deny('empty_segments');
      const segments = rows.map(r => cleanSegment(fromRow(r), target.atiUserId));
      await this.lockSources(client, segments);
      if (input.signal?.aborted) deny('aborted');
      const content = await this.lockTarget(client, target, false, segments, input.consumerPurpose);
      const current = await this.getActiveCopyInTransaction(client, target);
      if (!current || current.derivedCopyId !== first.derivedCopyId || current.targetVersion !== expected) deny('version_mismatch');
      if (fingerprint(content,input.targetSubId) !== current.targetFingerprint) deny('stale_lineage');
      for (const r of rows) {
        if (r.expires_at.getTime() <= Date.now() || r.expires_at.getTime() > r.captured_at.getTime() + r.effective_retention_days * DAY ||
            r.owner_source_key !== formatSlackOwnerSourceKey(fromRow(r).sourceRef)) deny('retention_expired');
      }
      await this.authorize(client, segments, input.consumerPurpose);
      if (input.signal?.aborted) deny('aborted');
      if (!heldClient) await client.query('COMMIT');
      return { status: 'allowed' };
    } catch (error) {
      if (client && !heldClient) await client.query('ROLLBACK').catch(() => {});
      const reasons = new Set(['version_mismatch','unsupported_target','unauthorized_caller','not_found','empty_segments',
        'retention_expired','policy_changed','blocked_by_barrier','stale_lineage','aborted']);
      return { status: 'blocked', reason: error instanceof Error && reasons.has(error.message) ? error.message : 'stale_lineage', tombstone: TOMBSTONE };
    } finally { if (!heldClient) client?.release(); }
  }
}
