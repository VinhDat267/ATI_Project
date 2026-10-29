import type pg from 'pg';
import {
  validateSlackSourceRef,
  validateSlackPolicyReference,
  validateSlackSourceEntity,
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

function mapRecordToEntity(record: SlackSourceRecord): SlackSourceEntity {
  return validateSlackSourceEntity({
    id: record.id,
    sourceRef: {
      binding: {
        atiUserId: record.userId,
        connectionId: record.connectionId,
        workspaceId: record.workspaceId,
        slackUserId: record.slackUserId,
        identityVersion: record.identityVersion,
      },
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
   * Saves untrusted raw source content enforcing server-owned TTL ceiling <= 7 days
   * and acquisition epoch provenance matching.
   */
  async saveSource(input: SaveSourceInput): Promise<SlackSourceEntity> {
    const cleanSourceRef = validateSlackSourceRef(input.sourceRef);
    const cleanAcqRef = validateSlackPolicyReference(input.acquisitionPolicyRef);
    const cleanStorageRef = validateSlackPolicyReference(input.storagePolicyRef);

    if (cleanAcqRef.purpose === 'storage') {
      throw new TypeError('acquisitionPolicyRef purpose cannot be storage');
    }

    if (cleanStorageRef.purpose !== 'storage') {
      throw new TypeError('storagePolicyRef purpose must be storage');
    }

    if (!sameSlackBinding(cleanSourceRef.binding, cleanStorageRef.binding)) {
      throw new TypeError('sourceRef binding must match storagePolicyRef binding');
    }

    if (!sameSlackBinding(cleanSourceRef.binding, cleanAcqRef.binding)) {
      throw new TypeError('sourceRef binding must match acquisitionPolicyRef binding');
    }

    // Provenance Check: Acquisition epoch must match storage epoch exactly
    const acqEpoch = slackPolicyRefToEpoch(cleanAcqRef);
    const storageEpoch = slackPolicyRefToEpoch(cleanStorageRef);
    if (!sameSlackPolicyEpoch(acqEpoch, storageEpoch)) {
      throw new Error('ACQUISITION_EPOCH_MISMATCH: Stale read observation from old grant cannot be stored under new grant');
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
   * 1. Check active invalidation barriers & revalidate stored storage policy
   * 2. Authorize caller's consumer purpose with fresh context
   * 3. Post-await barrier check before returning plaintext
   */
  async getSource(input: GetSourceInput): Promise<GetSourceResult> {
    const cleanSourceRef = validateSlackSourceRef(input.sourceRef);

    if (input.consumerPurpose === 'storage') {
      throw new TypeError('consumerPurpose cannot be storage');
    }

    let record: SlackSourceRecord | null = null;

    if ('expectedCaptureId' in input) {
      record = await this.sourceRepo.getSourceById(input.expectedCaptureId);
    } else if ('expectedPolicyEpoch' in input) {
      const epochHash = hashPolicyEpoch(input.expectedPolicyEpoch);
      const ownerSourceKey = formatSlackOwnerSourceKey(cleanSourceRef);
      record = await this.sourceRepo.getActiveSourceByOwnerKey(ownerSourceKey, epochHash);
    } else {
      throw new TypeError('Must provide either expectedCaptureId or expectedPolicyEpoch');
    }

    if (!record) {
      return { status: 'not_found' };
    }

    // Verify owner binding matches
    if (
      record.userId !== cleanSourceRef.binding.atiUserId ||
      record.connectionId !== cleanSourceRef.binding.connectionId ||
      record.identityVersion !== cleanSourceRef.binding.identityVersion
    ) {
      return { status: 'not_found' };
    }

    // Check tombstoned or purged
    if (record.purgedAt) {
      return {
        status: 'tombstoned_or_expired',
        reason: (record.tombstoneReason as SlackTombstoneReason) || 'retention_expired',
        safeMetadataOnly: record.metadata,
      };
    }

    if (record.tombstonedAt) {
      return {
        status: 'tombstoned_or_expired',
        reason: (record.tombstoneReason as SlackTombstoneReason) || 'source_deleted',
        safeMetadataOnly: record.metadata,
      };
    }

    if (record.expiresAt.getTime() <= Date.now()) {
      await this.sourceRepo.tombstoneSource(record.id, 'retention_expired');
      return {
        status: 'tombstoned_or_expired',
        reason: 'retention_expired',
        safeMetadataOnly: record.metadata,
      };
    }

    // Pre-await barrier check
    const preBarrier = await this.invalidationService.checkBarriers({
      binding: cleanSourceRef.binding,
      channelId: record.metadata.channelId,
      epochHash: record.policyEpochHash,
      resourceType: record.resourceType as any,
      resourceId: record.resourceId,
      revision: record.revision,
      workspaceId: record.workspaceId,
    });

    if (preBarrier.blocked) {
      return {
        status: 'blocked_by_invalidation_barrier',
        reason: preBarrier.reason || 'invalidation_barrier_active',
        safeMetadataOnly: record.metadata,
      };
    }

    const env = this.runtimeConfig?.env ?? process.env;

    // Phase 1: Revalidate Storage Policy Reference under purpose 'storage'
    const storageDecision = await this.policyService.resolveSlackModelPolicy({
      binding: record.policyRef.binding,
      purpose: 'storage',
      requestedRetentionDays: record.policyRef.requestedRetentionDays,
      expectedPolicyReference: record.policyRef,
      env,
    });

    if (!storageDecision.allowed) {
      return {
        status: 'blocked_by_policy_change',
        reason: storageDecision.reason as SlackModelBlockReason,
        safeMetadataOnly: record.metadata,
      };
    }

    // Phase 2: Authorize Caller's Consumer Purpose with fresh context
    const consumerDecision = await this.policyService.resolveSlackModelPolicy({
      binding: cleanSourceRef.binding,
      purpose: input.consumerPurpose,
      requestedRetentionDays: 0,
      env,
    });

    if (!consumerDecision.allowed) {
      return {
        status: 'blocked_by_policy_change',
        reason: consumerDecision.reason as SlackModelBlockReason,
        safeMetadataOnly: record.metadata,
      };
    }

    // Post-await barrier check: verify no barrier became active while awaiting async policy checks
    const postBarrier = await this.invalidationService.checkBarriers({
      binding: cleanSourceRef.binding,
      channelId: record.metadata.channelId,
      epochHash: record.policyEpochHash,
      resourceType: record.resourceType as any,
      resourceId: record.resourceId,
      revision: record.revision,
      workspaceId: record.workspaceId,
    });

    if (postBarrier.blocked) {
      return {
        status: 'blocked_by_invalidation_barrier',
        reason: postBarrier.reason || 'invalidation_barrier_active',
        safeMetadataOnly: record.metadata,
      };
    }

    return {
      status: 'ok',
      entity: mapRecordToEntity(record),
    };
  }
}
