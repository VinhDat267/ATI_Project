import type pg from 'pg';
import {
  SLACK_POLICY_PURPOSES,
  SLACK_TOMBSTONE_REASONS,
  validateSlackSourceRef,
  validateSlackPolicyReference,
  validateSlackPolicyEpoch,
  validateSlackSourceEntity,
  validateSlackSourceMetadata,
  formatSlackOwnerSourceKey,
  sameSlackBinding,
  sameSlackPolicyEpoch,
  slackPolicyRefToEpoch,
  RAW_SOURCE_MAX_RETENTION_DAYS,
  type SlackSourceRef,
  type SlackPolicyReference,
  type SlackPolicyEpoch,
  type SlackPolicyPurpose,
  type SlackSourceMetadata,
  type SlackSourceEntity,
  type SlackTombstoneReason,
  type SlackModelBlockReason,
} from '@wap/tool-schemas';
import { SlackSourceRepo, type SlackSourceRecord } from '../../db/repositories/slack-source-repo.js';
import { SlackInvalidationService, hashPolicyEpoch } from './slack-invalidation-service.js';
import { SlackPolicyService } from './policy-service.js';

export interface SaveSourceInput {
  sourceRef: SlackSourceRef;
  acquisitionPolicyRef: SlackPolicyReference; // Tham chiếu ủy quyền từ thao tác đọc ban đầu
  storagePolicyRef: SlackPolicyReference;     // Tham chiếu mục đích 'storage' được cấp phát
  untrustedContent: string;
  metadata?: SlackSourceMetadata;
  capturedAt?: string;
}

export type GetSourceInput =
  | {
      expectedCaptureId: string;
      sourceRef: SlackSourceRef;
      consumerPurpose: SlackPolicyPurpose;
    }
  | {
      expectedPolicyEpoch: SlackPolicyEpoch;
      sourceRef: SlackSourceRef;
      consumerPurpose: SlackPolicyPurpose;
    };

export type GetSourceResult =
  | { status: 'ok'; entity: SlackSourceEntity }
  | { status: 'blocked_by_invalidation_barrier'; reason: string; safeMetadataOnly?: SlackSourceMetadata }
  | { status: 'blocked_by_policy_change'; reason: SlackModelBlockReason; safeMetadataOnly?: SlackSourceMetadata }
  | { status: 'tombstoned_or_expired'; reason: SlackTombstoneReason; safeMetadataOnly?: SlackSourceMetadata }
  | { status: 'not_found' };

export interface SlackSourceStoreConfig {
  env?: Record<string, string | undefined>;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function recordBinding(record: SlackSourceRecord) {
  return {
    atiUserId: record.userId,
    connectionId: record.connectionId,
    workspaceId: record.workspaceId,
    slackUserId: record.slackUserId,
    identityVersion: record.identityVersion,
  };
}

function safeMetadata(record: SlackSourceRecord): SlackSourceMetadata {
  try {
    return validateSlackSourceMetadata(record.metadata);
  } catch {
    return {};
  }
}

function validTombstoneReason(
  record: SlackSourceRecord,
  fallback: SlackTombstoneReason
): SlackTombstoneReason {
  const reason = record.tombstoneReason;
  return typeof reason === 'string' && SLACK_TOMBSTONE_REASONS.includes(reason as SlackTombstoneReason)
    ? (reason as SlackTombstoneReason)
    : fallback;
}

function resolveStoredPolicy(
  record: SlackSourceRecord
): { policyRef: SlackPolicyReference; epoch: SlackPolicyEpoch } | null {
  try {
    const policyRef = validateSlackPolicyReference(record.policyRef);
    if (policyRef.purpose !== 'storage') return null;
    if (!sameSlackBinding(policyRef.binding, recordBinding(record))) return null;
    if (policyRef.requestedRetentionDays !== record.policyRequestedRetentionDays) return null;
    if (
      !Number.isSafeInteger(record.retentionDays) ||
      record.retentionDays <= 0 ||
      record.retentionDays > RAW_SOURCE_MAX_RETENTION_DAYS ||
      record.retentionDays > policyRef.requestedRetentionDays
    ) {
      return null;
    }
    const epoch = slackPolicyRefToEpoch(policyRef);
    if (hashPolicyEpoch(epoch) !== record.policyEpochHash) return null;
    return { policyRef, epoch };
  } catch {
    return null;
  }
}

function recordMatchesSourceRef(record: SlackSourceRecord, sourceRef: SlackSourceRef): boolean {
  return (
    sameSlackBinding(recordBinding(record), sourceRef.binding) &&
    record.resourceType === sourceRef.resourceType &&
    record.resourceId === sourceRef.resourceId &&
    record.revision === sourceRef.revision
  );
}

function mapRecordToEntity(record: SlackSourceRecord): SlackSourceEntity {
  return validateSlackSourceEntity({
    id: record.id,
    sourceRef: {
      binding: recordBinding(record),
      resourceType: record.resourceType,
      resourceId: record.resourceId,
      revision: record.revision,
    },
    policyRef: record.policyRef,
    untrustedContent: record.untrustedContent,
    metadata: record.metadata,
    observedRevision: record.revision,
    retentionDays: record.retentionDays,
    capturedAt: record.capturedAt.toISOString(),
    expiresAt: record.expiresAt.toISOString(),
    tombstonedAt: record.tombstonedAt ? record.tombstonedAt.toISOString() : null,
    purgedAt: record.purgedAt ? record.purgedAt.toISOString() : null,
  });
}

export class SlackSourceStore {
  constructor(
    private readonly pool: pg.Pool,
    private readonly sourceRepo: SlackSourceRepo,
    private readonly invalidationService: SlackInvalidationService,
    private readonly policyService: SlackPolicyService,
    private readonly runtimeConfig?: SlackSourceStoreConfig
  ) {}

  /**
   * Saves untrusted raw source content. Both the declared acquisition reference and the
   * storage reference are re-authorized against the current server-owned runtime policy
   * (same exact epoch) before any write; the repository then rechecks DB authority and
   * active barriers inside the write transaction.
   */
  async saveSource(input: SaveSourceInput): Promise<SlackSourceEntity> {
    const cleanSourceRef = validateSlackSourceRef(input.sourceRef);
    const cleanAcqRef = validateSlackPolicyReference(input.acquisitionPolicyRef);
    const cleanStorageRef = validateSlackPolicyReference(input.storagePolicyRef);

    if (cleanAcqRef.purpose === 'storage') {
      throw new TypeError('acquisitionPolicyRef purpose cannot be storage');
    }
    if (cleanAcqRef.requestedRetentionDays !== 0) {
      throw new Error('ACQUISITION_RETENTION_MUST_BE_ZERO: acquisition is a non-persisting read');
    }

    if (cleanStorageRef.purpose !== 'storage') {
      throw new TypeError('storagePolicyRef purpose must be storage');
    }
    if (cleanStorageRef.requestedRetentionDays <= 0) {
      throw new Error('RETENTION_EXCEEDED: storage requestedRetentionDays must be > 0');
    }

    if (!sameSlackBinding(cleanSourceRef.binding, cleanStorageRef.binding)) {
      throw new TypeError('sourceRef binding must match storagePolicyRef binding');
    }
    if (!sameSlackBinding(cleanSourceRef.binding, cleanAcqRef.binding)) {
      throw new TypeError('sourceRef binding must match acquisitionPolicyRef binding');
    }

    // Provenance check first: an acquisition epoch must equal the storage epoch exactly.
    const acqEpoch = slackPolicyRefToEpoch(cleanAcqRef);
    const storageEpoch = slackPolicyRefToEpoch(cleanStorageRef);
    if (!sameSlackPolicyEpoch(acqEpoch, storageEpoch)) {
      throw new Error('ACQUISITION_EPOCH_MISMATCH: Stale read observation from old grant cannot be stored under new grant');
    }

    if (input.capturedAt !== undefined) {
      const captured = new Date(input.capturedAt);
      if (Number.isNaN(captured.getTime())) {
        throw new TypeError('INVALID_CAPTURED_AT: must be a valid timestamp');
      }
      if (captured.getTime() > Date.now()) {
        throw new Error('CAPTURED_AT_IN_FUTURE: caller supplied capture time cannot extend server TTL');
      }
    }

    // Current runtime policy for the actual acquisition purpose.
    const acquisitionDecision = await this.policyService.resolveSlackModelPolicy({
      binding: cleanSourceRef.binding,
      purpose: cleanAcqRef.purpose,
      requestedRetentionDays: 0,
      expectedPolicyReference: cleanAcqRef,
    });
    if (!acquisitionDecision.allowed) {
      throw new Error(`SOURCE_POLICY_DENIED:acquisition:${acquisitionDecision.reason}`);
    }
    if (!sameSlackPolicyEpoch(slackPolicyRefToEpoch(acquisitionDecision.policyReference), acqEpoch)) {
      throw new Error('SOURCE_POLICY_DENIED:acquisition:epoch_mismatch');
    }

    // Current runtime policy for persistence.
    const storageDecision = await this.policyService.resolveSlackModelPolicy({
      binding: cleanSourceRef.binding,
      purpose: 'storage',
      requestedRetentionDays: cleanStorageRef.requestedRetentionDays,
      expectedPolicyReference: cleanStorageRef,
    });
    if (!storageDecision.allowed) {
      throw new Error(`SOURCE_POLICY_DENIED:storage:${storageDecision.reason}`);
    }
    if (!sameSlackPolicyEpoch(slackPolicyRefToEpoch(storageDecision.policyReference), storageEpoch)) {
      throw new Error('SOURCE_POLICY_DENIED:storage:epoch_mismatch');
    }

    const record = await this.sourceRepo.saveSourceAtomic({
      sourceRef: cleanSourceRef,
      policyRef: cleanStorageRef,
      untrustedContent: input.untrustedContent,
      metadata: input.metadata,
      capturedAt: input.capturedAt,
    });

    return mapRecordToEntity(record);
  }

  /**
   * Safely reads raw source content via 2-phase validation:
   * 1. Enforce the full captured resource/binding/revision identity and immutable epoch
   * 2. Check active invalidation barriers and revalidate the stored storage policy
   * 3. Authorize the consumer purpose and require its current epoch to equal the stored epoch
   * 4. Revalidate storage again, re-check barriers, and re-read the row before returning plaintext
   */
  async getSource(input: GetSourceInput): Promise<GetSourceResult> {
    if (!input || typeof input !== 'object') {
      throw new TypeError('getSource input must be an object');
    }

    const hasCaptureId =
      Object.hasOwn(input, 'expectedCaptureId') && (input as any).expectedCaptureId !== undefined;
    const hasPolicyEpoch =
      Object.hasOwn(input, 'expectedPolicyEpoch') && (input as any).expectedPolicyEpoch !== undefined;
    if (hasCaptureId === hasPolicyEpoch) {
      throw new TypeError('getSource requires exactly one of expectedCaptureId or expectedPolicyEpoch');
    }

    const cleanSourceRef = validateSlackSourceRef(input.sourceRef);
    const consumerPurpose = input.consumerPurpose;
    if (
      !SLACK_POLICY_PURPOSES.includes(consumerPurpose) ||
      consumerPurpose === 'storage'
    ) {
      throw new TypeError('consumerPurpose must be a non-storage Slack policy purpose');
    }

    let expectedEpoch: SlackPolicyEpoch | undefined;

    if (hasCaptureId) {
      const captureId = (input as any).expectedCaptureId;
      if (typeof captureId !== 'string' || !UUID_REGEX.test(captureId)) {
        throw new TypeError('expectedCaptureId must be a canonical UUID');
      }
    } else {
      expectedEpoch = validateSlackPolicyEpoch((input as any).expectedPolicyEpoch);
      if (!sameSlackBinding(expectedEpoch.binding, cleanSourceRef.binding)) {
        throw new TypeError('expectedPolicyEpoch binding must match sourceRef binding');
      }
    }

    let record: SlackSourceRecord | null;
    if (hasCaptureId) {
      record = await this.sourceRepo.getSourceById((input as any).expectedCaptureId);
    } else {
      const ownerSourceKey = formatSlackOwnerSourceKey(cleanSourceRef);
      record = await this.sourceRepo.getActiveSourceByOwnerKey(
        ownerSourceKey,
        hashPolicyEpoch(expectedEpoch!)
      );
    }

    if (!record) {
      return { status: 'not_found' };
    }

    // Full 5-field binding, resource type/id, and revision identity are all required.
    if (!recordMatchesSourceRef(record, cleanSourceRef)) {
      return { status: 'not_found' };
    }

    const stored = resolveStoredPolicy(record);
    if (!stored) {
      return { status: 'not_found' };
    }

    if (expectedEpoch && !sameSlackPolicyEpoch(stored.epoch, expectedEpoch)) {
      return { status: 'not_found' };
    }

    const metadata = safeMetadata(record);

    if (record.purgedAt) {
      return {
        status: 'tombstoned_or_expired',
        reason: validTombstoneReason(record, 'retention_expired'),
        safeMetadataOnly: metadata,
      };
    }

    if (record.tombstonedAt) {
      return {
        status: 'tombstoned_or_expired',
        reason: validTombstoneReason(record, 'source_deleted'),
        safeMetadataOnly: metadata,
      };
    }

    if (record.expiresAt.getTime() <= Date.now()) {
      await this.sourceRepo.tombstoneSource(record.id, 'retention_expired');
      return {
        status: 'tombstoned_or_expired',
        reason: 'retention_expired',
        safeMetadataOnly: metadata,
      };
    }

    const barrierQuery = {
      binding: cleanSourceRef.binding,
      channelId: metadata.channelId,
      epochHash: record.policyEpochHash,
      resourceType: cleanSourceRef.resourceType,
      resourceId: cleanSourceRef.resourceId,
      revision: cleanSourceRef.revision,
      workspaceId: record.workspaceId,
    };

    const preBarrier = await this.invalidationService.checkBarriers(barrierQuery);
    if (preBarrier.blocked) {
      return {
        status: 'blocked_by_invalidation_barrier',
        reason: preBarrier.reason || 'invalidation_barrier_active',
        safeMetadataOnly: metadata,
      };
    }

    const authorizeStorage = async (): Promise<
      { allowed: true } | { allowed: false; reason: SlackModelBlockReason }
    > => {
      const decision = await this.policyService.resolveSlackModelPolicy({
        binding: cleanSourceRef.binding,
        purpose: 'storage',
        requestedRetentionDays: stored.policyRef.requestedRetentionDays,
        expectedPolicyReference: stored.policyRef,
      });
      if (!decision.allowed) {
        return { allowed: false, reason: decision.reason as SlackModelBlockReason };
      }
      if (!sameSlackPolicyEpoch(slackPolicyRefToEpoch(decision.policyReference), stored.epoch)) {
        return { allowed: false, reason: 'policy_changed' };
      }
      return { allowed: true };
    };

    // Phase 1: revalidate the immutable stored storage reference.
    const storageDecision = await authorizeStorage();
    if (!storageDecision.allowed) {
      return {
        status: 'blocked_by_policy_change',
        reason: storageDecision.reason,
        safeMetadataOnly: metadata,
      };
    }

    // Phase 2: authorize the consumer context with a fresh policy read.
    const consumerDecision = await this.policyService.resolveSlackModelPolicy({
      binding: cleanSourceRef.binding,
      purpose: consumerPurpose,
      requestedRetentionDays: 0,
    });
    if (!consumerDecision.allowed) {
      return {
        status: 'blocked_by_policy_change',
        reason: consumerDecision.reason as SlackModelBlockReason,
        safeMetadataOnly: metadata,
      };
    }

    // The consumer's current epoch must exactly equal the immutable stored epoch. A regrant
    // committed while awaiting storage/consumer decisions can therefore never release the
    // old capture, and the stored reference is never relabeled with the new epoch.
    if (!sameSlackPolicyEpoch(slackPolicyRefToEpoch(consumerDecision.policyReference), stored.epoch)) {
      return {
        status: 'blocked_by_policy_change',
        reason: 'policy_changed',
        safeMetadataOnly: metadata,
      };
    }

    // Reauthorize storage across the awaits. Any denial/epoch drift fails closed.
    let storageRecheck: { allowed: true } | { allowed: false; reason: SlackModelBlockReason };
    try {
      storageRecheck = await authorizeStorage();
    } catch {
      storageRecheck = { allowed: false, reason: 'policy_changed' };
    }
    if (!storageRecheck.allowed) {
      return {
        status: 'blocked_by_policy_change',
        reason: storageRecheck.reason,
        safeMetadataOnly: metadata,
      };
    }

    // Post-await barrier check: no barrier may have become active while I/O was in flight.
    const postBarrier = await this.invalidationService.checkBarriers(barrierQuery);
    if (postBarrier.blocked) {
      return {
        status: 'blocked_by_invalidation_barrier',
        reason: postBarrier.reason || 'invalidation_barrier_active',
        safeMetadataOnly: metadata,
      };
    }

    // Final live-row read: never return plaintext that was purged or tombstoned after the
    // initial lookup (including a purge committed after the post-await barrier check).
    const fresh = await this.sourceRepo.getSourceById(record.id);
    if (!fresh) {
      return { status: 'not_found' };
    }
    if (!recordMatchesSourceRef(fresh, cleanSourceRef)) {
      return { status: 'not_found' };
    }
    const freshPolicy = resolveStoredPolicy(fresh);
    if (!freshPolicy || !sameSlackPolicyEpoch(freshPolicy.epoch, stored.epoch)) {
      return { status: 'not_found' };
    }
    if (fresh.purgedAt) {
      return {
        status: 'tombstoned_or_expired',
        reason: validTombstoneReason(fresh, 'retention_expired'),
        safeMetadataOnly: safeMetadata(fresh),
      };
    }
    if (fresh.tombstonedAt) {
      return {
        status: 'tombstoned_or_expired',
        reason: validTombstoneReason(fresh, 'source_deleted'),
        safeMetadataOnly: safeMetadata(fresh),
      };
    }
    if (fresh.expiresAt.getTime() <= Date.now()) {
      await this.sourceRepo.tombstoneSource(fresh.id, 'retention_expired');
      return {
        status: 'tombstoned_or_expired',
        reason: 'retention_expired',
        safeMetadataOnly: safeMetadata(fresh),
      };
    }

    return {
      status: 'ok',
      entity: mapRecordToEntity(fresh),
    };
  }
}
