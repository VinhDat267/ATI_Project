import {
  sameSlackBinding,
  validateSlackBinding,
  validateSlackSourceRef,
  formatSlackOwnerSourceKey,
  SLACK_RESOURCE_TYPES,
  type SlackBinding,
  type SlackSourceRef,
  type SlackResourceType,
} from './myslack-context.js';
import {
  validateSlackPolicyReference,
  validateSlackPolicyEpoch,
  type SlackPolicyReference,
  type SlackPolicyEpoch,
} from './myslack-policy.js';

export interface SlackSourceMetadata {
  channelId?: string;
  channelName?: string;
  threadTs?: string;
  authorSlackUserId?: string;
  authorName?: string;
  fileName?: string;
  fileMimeType?: string;
  fileSizeBytes?: number;
  isBotMessage?: boolean;
}

const METADATA_STRING_FIELDS = [
  'channelId',
  'channelName',
  'threadTs',
  'authorSlackUserId',
  'authorName',
  'fileName',
  'fileMimeType',
] as const;

export function validateSlackSourceMetadata(input: unknown): SlackSourceMetadata {
  if (input === null || input === undefined) {
    return {};
  }
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Invalid Slack source metadata: must be an object');
  }

  const record = input as Record<string, unknown>;
  const clean: SlackSourceMetadata = {};

  for (const field of METADATA_STRING_FIELDS) {
    if (Object.hasOwn(record, field)) {
      const val = record[field];
      if (val !== undefined && val !== null) {
        if (typeof val !== 'string') {
          throw new TypeError(`Invalid metadata field ${field}: must be a string`);
        }
        if (val.trim()) {
          clean[field] = val.trim();
        }
      }
    }
  }

  if (Object.hasOwn(record, 'fileSizeBytes')) {
    const val = record.fileSizeBytes;
    if (val !== undefined && val !== null) {
      if (!Number.isSafeInteger(val) || (val as number) < 0) {
        throw new TypeError('Invalid metadata fileSizeBytes: must be a non-negative safe integer');
      }
      clean.fileSizeBytes = val as number;
    }
  }

  if (Object.hasOwn(record, 'isBotMessage')) {
    const val = record.isBotMessage;
    if (val !== undefined && val !== null) {
      if (typeof val !== 'boolean') {
        throw new TypeError('Invalid metadata isBotMessage: must be a boolean');
      }
      clean.isBotMessage = val;
    }
  }

  return clean;
}

export const RAW_SOURCE_MAX_RETENTION_DAYS = 7;

const ISO_UTC_REGEX = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d+)?Z$/;

export function isValidIsoUtcTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = ISO_UTC_REGEX.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return false;
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return false;
  }
  return true;
}

export interface SlackSourceEntity {
  id: string;
  sourceRef: SlackSourceRef;
  policyRef: SlackPolicyReference;
  untrustedContent: string;
  metadata: SlackSourceMetadata;
  observedRevision: string;
  retentionDays: number;
  capturedAt: string;
  expiresAt: string;
  tombstonedAt: string | null;
  purgedAt: string | null;
}

export function validateSlackSourceEntity(input: unknown): SlackSourceEntity {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Invalid Slack source entity');
  }
  const record = input as Record<string, unknown>;

  if (!Object.hasOwn(record, 'id') || typeof record.id !== 'string' || !record.id.trim()) {
    throw new TypeError('Invalid Slack source entity id');
  }

  if (!Object.hasOwn(record, 'sourceRef')) {
    throw new TypeError('Slack source entity missing sourceRef');
  }
  const cleanSourceRef = validateSlackSourceRef(record.sourceRef);

  if (!Object.hasOwn(record, 'policyRef')) {
    throw new TypeError('Slack source entity missing policyRef');
  }
  const cleanPolicyRef = validateSlackPolicyReference(record.policyRef);

  if (cleanPolicyRef.purpose !== 'storage') {
    throw new TypeError('Slack source entity policyRef purpose must be "storage"');
  }

  if (cleanPolicyRef.requestedRetentionDays <= 0) {
    throw new TypeError('Slack source entity requires policyRef requestedRetentionDays > 0');
  }

  if (!sameSlackBinding(cleanSourceRef.binding, cleanPolicyRef.binding)) {
    throw new TypeError('SourceRef binding must match policyRef binding');
  }

  if (!Object.hasOwn(record, 'untrustedContent') || typeof record.untrustedContent !== 'string') {
    throw new TypeError('Invalid Slack source entity untrustedContent: must be a string');
  }

  const cleanMetadata = validateSlackSourceMetadata(record.metadata);

  if (
    !Object.hasOwn(record, 'observedRevision') ||
    typeof record.observedRevision !== 'string' ||
    record.observedRevision.trim() !== cleanSourceRef.revision
  ) {
    throw new TypeError('Observed revision must match sourceRef revision');
  }

  if (
    !Object.hasOwn(record, 'retentionDays') ||
    !Number.isSafeInteger(record.retentionDays) ||
    (record.retentionDays as number) <= 0
  ) {
    throw new TypeError('Slack source entity requires positive safe integer retentionDays');
  }

  if ((record.retentionDays as number) > cleanPolicyRef.requestedRetentionDays) {
    throw new TypeError('Slack source entity retentionDays cannot exceed policyRef.requestedRetentionDays');
  }

  if ((record.retentionDays as number) > RAW_SOURCE_MAX_RETENTION_DAYS) {
    throw new TypeError('Raw source entity retentionDays cannot exceed ceiling of 7 days');
  }

  if (!Object.hasOwn(record, 'capturedAt') || !isValidIsoUtcTimestamp(record.capturedAt)) {
    throw new TypeError('Invalid Slack source entity capturedAt: must be valid ISO UTC timestamp');
  }

  if (!Object.hasOwn(record, 'expiresAt') || !isValidIsoUtcTimestamp(record.expiresAt)) {
    throw new TypeError('Invalid Slack source entity expiresAt: must be valid ISO UTC timestamp');
  }

  const capturedTime = Date.parse(record.capturedAt as string);
  const expiresTime = Date.parse(record.expiresAt as string);
  const intervalMs = expiresTime - capturedTime;
  if (intervalMs <= 0) {
    throw new TypeError('expiresAt must be after capturedAt');
  }
  const maxIntervalMs = (record.retentionDays as number) * 86_400_000;
  if (intervalMs > maxIntervalMs) {
    throw new TypeError('expiresAt cannot exceed the declared retentionDays TTL');
  }

  let tombstonedAt: string | null = null;
  if (Object.hasOwn(record, 'tombstonedAt') && record.tombstonedAt !== null) {
    if (!isValidIsoUtcTimestamp(record.tombstonedAt)) {
      throw new TypeError('Invalid Slack source entity tombstonedAt: must be valid ISO UTC timestamp');
    }
    tombstonedAt = record.tombstonedAt as string;
  }

  let purgedAt: string | null = null;
  if (Object.hasOwn(record, 'purgedAt') && record.purgedAt !== null) {
    if (!isValidIsoUtcTimestamp(record.purgedAt)) {
      throw new TypeError('Invalid Slack source entity purgedAt: must be valid ISO UTC timestamp');
    }
    purgedAt = record.purgedAt as string;
  }

  return {
    id: record.id.trim(),
    sourceRef: cleanSourceRef,
    policyRef: cleanPolicyRef,
    untrustedContent: record.untrustedContent,
    metadata: cleanMetadata,
    observedRevision: cleanSourceRef.revision,
    retentionDays: record.retentionDays as number,
    capturedAt: record.capturedAt as string,
    expiresAt: record.expiresAt as string,
    tombstonedAt,
    purgedAt,
  };
}

export type SlackDerivedTargetKind =
  | 'chat_history_message'
  | 'working_memory_entity'
  | 'plan_step_arg'
  | 'proposal_excerpt'
  | 'daily_digest_entry'
  | 'scheduled_workflow_arg'
  | 'audit_log_entry';

export const SLACK_DERIVED_TARGET_KINDS: readonly SlackDerivedTargetKind[] = [
  'chat_history_message',
  'working_memory_entity',
  'plan_step_arg',
  'proposal_excerpt',
  'daily_digest_entry',
  'scheduled_workflow_arg',
  'audit_log_entry',
] as const;

export interface SlackDerivedCopyRef {
  targetKind: SlackDerivedTargetKind;
  targetId: string;
  sourceRefs: SlackSourceRef[];
  policyRef: SlackPolicyReference;
  createdAt: string;
}

export function validateSlackDerivedCopyRef(input: unknown): SlackDerivedCopyRef {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Invalid Slack derived copy ref');
  }
  const record = input as Record<string, unknown>;

  if (
    !Object.hasOwn(record, 'targetKind') ||
    typeof record.targetKind !== 'string' ||
    !SLACK_DERIVED_TARGET_KINDS.includes(record.targetKind as SlackDerivedTargetKind)
  ) {
    throw new TypeError('Invalid Slack derived targetKind');
  }

  if (!Object.hasOwn(record, 'targetId') || typeof record.targetId !== 'string' || !record.targetId.trim()) {
    throw new TypeError('Invalid Slack derived targetId');
  }

  if (!Object.hasOwn(record, 'policyRef')) {
    throw new TypeError('Slack derived copy missing policyRef');
  }
  const cleanPolicyRef = validateSlackPolicyReference(record.policyRef);

  if (!Object.hasOwn(record, 'sourceRefs') || !Array.isArray(record.sourceRefs) || record.sourceRefs.length === 0) {
    throw new TypeError('Slack derived copy requires non-empty sourceRefs');
  }

  const cleanSourceRefs: SlackSourceRef[] = record.sourceRefs.map(ref => {
    const cleanRef = validateSlackSourceRef(ref);
    if (!sameSlackBinding(cleanRef.binding, cleanPolicyRef.binding)) {
      throw new TypeError('All sourceRefs in derived copy must match policyRef binding');
    }
    return cleanRef;
  });

  if (!Object.hasOwn(record, 'createdAt') || !isValidIsoUtcTimestamp(record.createdAt)) {
    throw new TypeError('Invalid Slack derived copy createdAt');
  }

  return {
    targetKind: record.targetKind as SlackDerivedTargetKind,
    targetId: record.targetId.trim(),
    sourceRefs: cleanSourceRefs,
    policyRef: cleanPolicyRef,
    createdAt: record.createdAt as string,
  };
}

export interface SlackSourceLineage {
  ownerSourceKey: string;
  origin: SlackSourceRef;
  policyRef: SlackPolicyReference;
  derivedCopies: SlackDerivedCopyRef[];
}

export function validateSlackSourceLineage(input: unknown): SlackSourceLineage {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Invalid Slack source lineage');
  }
  const record = input as Record<string, unknown>;

  if (!Object.hasOwn(record, 'origin')) {
    throw new TypeError('Slack source lineage missing origin');
  }
  const cleanOrigin = validateSlackSourceRef(record.origin);

  if (!Object.hasOwn(record, 'policyRef')) {
    throw new TypeError('Slack source lineage missing policyRef');
  }
  const cleanPolicyRef = validateSlackPolicyReference(record.policyRef);

  if (!sameSlackBinding(cleanOrigin.binding, cleanPolicyRef.binding)) {
    throw new TypeError('Origin binding must match policyRef binding');
  }

  const expectedOwnerKey = formatSlackOwnerSourceKey(cleanOrigin);
  if (!Object.hasOwn(record, 'ownerSourceKey') || record.ownerSourceKey !== expectedOwnerKey) {
    throw new TypeError('Lineage ownerSourceKey must match formatSlackOwnerSourceKey(origin)');
  }

  if (!Object.hasOwn(record, 'derivedCopies') || !Array.isArray(record.derivedCopies)) {
    throw new TypeError('Slack source lineage derivedCopies must be an array');
  }

  const cleanDerivedCopies = record.derivedCopies.map(copy => {
    const cleanCopy = validateSlackDerivedCopyRef(copy);

    // Each attached copy must include exact origin key/resource/revision in its sourceRefs
    const hasExactOrigin = cleanCopy.sourceRefs.some(ref =>
      ref.resourceType === cleanOrigin.resourceType &&
      ref.resourceId === cleanOrigin.resourceId &&
      ref.revision === cleanOrigin.revision &&
      sameSlackBinding(ref.binding, cleanOrigin.binding)
    );
    if (!hasExactOrigin) {
      throw new TypeError('Derived copy sourceRefs must include lineage origin');
    }

    // Match immutable authorization identity between lineage origin policyRef and copy policyRef
    if (
      !sameSlackBinding(cleanCopy.policyRef.binding, cleanPolicyRef.binding) ||
      cleanCopy.policyRef.providerProfileId !== cleanPolicyRef.providerProfileId ||
      cleanCopy.policyRef.configFingerprint !== cleanPolicyRef.configFingerprint ||
      cleanCopy.policyRef.policyVersion !== cleanPolicyRef.policyVersion ||
      cleanCopy.policyRef.consentRevision !== cleanPolicyRef.consentRevision ||
      cleanCopy.policyRef.providerRevision !== cleanPolicyRef.providerRevision
    ) {
      throw new TypeError('Derived copy authorization identity must match lineage origin policyRef');
    }

    return cleanCopy;
  });

  return {
    ownerSourceKey: expectedOwnerKey,
    origin: cleanOrigin,
    policyRef: cleanPolicyRef,
    derivedCopies: cleanDerivedCopies,
  };
}

export type SlackTombstoneReason =
  | 'source_deleted'
  | 'source_edited'
  | 'channel_membership_lost'
  | 'connection_disconnected'
  | 'app_reinstalled'
  | 'consent_revoked'
  | 'retention_expired'
  | 'policy_changed';

export const SLACK_TOMBSTONE_REASONS: readonly SlackTombstoneReason[] = [
  'source_deleted',
  'source_edited',
  'channel_membership_lost',
  'connection_disconnected',
  'app_reinstalled',
  'consent_revoked',
  'retention_expired',
  'policy_changed',
] as const;

export interface SlackTombstoneRecord {
  sourceRef: SlackSourceRef;
  reason: SlackTombstoneReason;
  tombstonedAt: string;
  purgedAt: string | null;
}

export function validateSlackTombstoneRecord(input: unknown): SlackTombstoneRecord {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Invalid Slack tombstone record');
  }
  const record = input as Record<string, unknown>;

  if (!Object.hasOwn(record, 'sourceRef')) {
    throw new TypeError('Slack tombstone record missing sourceRef');
  }
  const cleanSourceRef = validateSlackSourceRef(record.sourceRef);

  if (
    !Object.hasOwn(record, 'reason') ||
    typeof record.reason !== 'string' ||
    !SLACK_TOMBSTONE_REASONS.includes(record.reason as SlackTombstoneReason)
  ) {
    throw new TypeError('Invalid Slack tombstone record reason');
  }

  if (!Object.hasOwn(record, 'tombstonedAt') || !isValidIsoUtcTimestamp(record.tombstonedAt)) {
    throw new TypeError('Invalid Slack tombstone record tombstonedAt');
  }

  let purgedAt: string | null = null;
  if (Object.hasOwn(record, 'purgedAt') && record.purgedAt !== null) {
    if (!isValidIsoUtcTimestamp(record.purgedAt)) {
      throw new TypeError('Invalid Slack tombstone record purgedAt');
    }
    purgedAt = record.purgedAt as string;
  }

  return {
    sourceRef: cleanSourceRef,
    reason: record.reason as SlackTombstoneReason,
    tombstonedAt: record.tombstonedAt as string,
    purgedAt,
  };
}

export type SlackPurgeTarget =
  | {
      scope: 'owner_retention';
      binding: SlackBinding;
      resourceType: SlackResourceType;
      resourceId: string;
      revision?: string;
      policyRef: SlackPolicyReference;
      cascadeTargetKinds: SlackDerivedTargetKind[];
      tombstoneReason: 'retention_expired';
    }
  | {
      scope: 'channel_membership_lost';
      binding: SlackBinding;
      channelId: string;
      cascadeTargetKinds: SlackDerivedTargetKind[];
      tombstoneReason: 'channel_membership_lost';
    }
  | {
      scope: 'authorization_disconnect';
      binding: SlackBinding;
      cascadeTargetKinds: SlackDerivedTargetKind[];
      tombstoneReason: 'connection_disconnected' | 'app_reinstalled';
    }
  | {
      scope: 'resource_lifecycle';
      workspaceId: string;
      resourceType: SlackResourceType;
      resourceId: string;
      revision?: string;
      /** Edit invalidation: erase only revisions strictly below this exact decimal watermark.
       * Every raw/derived consumer must preserve equal/newer revisions. Opaque revisions
       * cannot prove freshness and must fail closed. Mutually exclusive with revision.
       */
      beforeRevision?: string;
      cascadeTargetKinds: SlackDerivedTargetKind[];
      tombstoneReason: 'source_deleted' | 'source_edited';
    }
  | {
      scope: 'workspace_consent_revocation';
      workspaceId: string;
      policyVersion: string;
      providerProfileId: string;
      consentRevision: string;
      cascadeTargetKinds: SlackDerivedTargetKind[];
      tombstoneReason: 'consent_revoked';
    }
  | {
      scope: 'policy_epoch_invalidated';
      epoch: SlackPolicyEpoch;
      cascadeTargetKinds: SlackDerivedTargetKind[];
      tombstoneReason: 'policy_changed';
    };

const CANONICAL_CONSENT_REVISION = /^[1-9][0-9]*$/;

export function validateSlackPurgeTarget(input: unknown): SlackPurgeTarget {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Invalid Slack purge target: must be an object');
  }
  const record = input as Record<string, unknown>;

  if (!Object.hasOwn(record, 'scope') || typeof record.scope !== 'string') {
    throw new TypeError('Slack purge target missing scope');
  }

  if (
    !Object.hasOwn(record, 'cascadeTargetKinds') ||
    !Array.isArray(record.cascadeTargetKinds) ||
    !record.cascadeTargetKinds.every(k => SLACK_DERIVED_TARGET_KINDS.includes(k as SlackDerivedTargetKind))
  ) {
    throw new TypeError('Invalid Slack purge target cascadeTargetKinds');
  }
  const cascadeTargetKinds = [...record.cascadeTargetKinds] as SlackDerivedTargetKind[];

  switch (record.scope) {
    case 'owner_retention': {
      if (!Object.hasOwn(record, 'binding')) throw new TypeError('owner_retention requires binding');
      const cleanBinding = validateSlackBinding(record.binding);

      if (
        !Object.hasOwn(record, 'resourceType') ||
        typeof record.resourceType !== 'string' ||
        !SLACK_RESOURCE_TYPES.includes(record.resourceType as SlackResourceType)
      ) {
        throw new TypeError('Invalid owner_retention resourceType');
      }

      if (!Object.hasOwn(record, 'resourceId') || typeof record.resourceId !== 'string' || !record.resourceId.trim()) {
        throw new TypeError('Invalid owner_retention resourceId');
      }

      let revision: string | undefined;
      if (Object.hasOwn(record, 'revision') && record.revision !== undefined) {
        if (typeof record.revision !== 'string' || !record.revision.trim()) {
          throw new TypeError('Invalid owner_retention revision');
        }
        revision = record.revision.trim();
      }

      if (!Object.hasOwn(record, 'policyRef')) throw new TypeError('owner_retention requires policyRef');
      const cleanPolicyRef = validateSlackPolicyReference(record.policyRef);

      if (!sameSlackBinding(cleanBinding, cleanPolicyRef.binding)) {
        throw new TypeError('owner_retention binding must match policyRef binding');
      }

      if (record.tombstoneReason !== 'retention_expired') {
        throw new TypeError('owner_retention requires tombstoneReason retention_expired');
      }

      return {
        scope: 'owner_retention',
        binding: cleanBinding,
        resourceType: record.resourceType as SlackResourceType,
        resourceId: record.resourceId.trim(),
        ...(revision ? { revision } : {}),
        policyRef: cleanPolicyRef,
        cascadeTargetKinds,
        tombstoneReason: 'retention_expired',
      };
    }

    case 'channel_membership_lost': {
      if (!Object.hasOwn(record, 'binding')) throw new TypeError('channel_membership_lost requires binding');
      const cleanBinding = validateSlackBinding(record.binding);

      if (!Object.hasOwn(record, 'channelId') || typeof record.channelId !== 'string' || !record.channelId.trim()) {
        throw new TypeError('channel_membership_lost requires valid channelId');
      }

      if (record.tombstoneReason !== 'channel_membership_lost') {
        throw new TypeError('channel_membership_lost requires tombstoneReason channel_membership_lost');
      }

      return {
        scope: 'channel_membership_lost',
        binding: cleanBinding,
        channelId: record.channelId.trim(),
        cascadeTargetKinds,
        tombstoneReason: 'channel_membership_lost',
      };
    }

    case 'authorization_disconnect': {
      if (!Object.hasOwn(record, 'binding')) throw new TypeError('authorization_disconnect requires binding');
      const cleanBinding = validateSlackBinding(record.binding);

      if (record.tombstoneReason !== 'connection_disconnected' && record.tombstoneReason !== 'app_reinstalled') {
        throw new TypeError('authorization_disconnect requires tombstoneReason connection_disconnected or app_reinstalled');
      }

      return {
        scope: 'authorization_disconnect',
        binding: cleanBinding,
        cascadeTargetKinds,
        tombstoneReason: record.tombstoneReason,
      };
    }

    case 'resource_lifecycle': {
      if (!Object.hasOwn(record, 'workspaceId') || typeof record.workspaceId !== 'string' || !record.workspaceId.trim()) {
        throw new TypeError('resource_lifecycle requires valid workspaceId');
      }

      if (
        !Object.hasOwn(record, 'resourceType') ||
        typeof record.resourceType !== 'string' ||
        !SLACK_RESOURCE_TYPES.includes(record.resourceType as SlackResourceType)
      ) {
        throw new TypeError('Invalid resource_lifecycle resourceType');
      }

      if (!Object.hasOwn(record, 'resourceId') || typeof record.resourceId !== 'string' || !record.resourceId.trim()) {
        throw new TypeError('Invalid resource_lifecycle resourceId');
      }

      let revision: string | undefined;
      if (Object.hasOwn(record, 'revision') && record.revision !== undefined) {
        if (typeof record.revision !== 'string' || !record.revision.trim()) {
          throw new TypeError('Invalid resource_lifecycle revision');
        }
        revision = record.revision.trim();
      }

      if (record.tombstoneReason !== 'source_deleted' && record.tombstoneReason !== 'source_edited') {
        throw new TypeError('resource_lifecycle requires tombstoneReason source_deleted or source_edited');
      }

      let beforeRevision: string | undefined;
      if (record.tombstoneReason === 'source_edited') {
        if (revision !== undefined || typeof record.beforeRevision !== 'string' ||
            record.beforeRevision.length > 256 || !/^[0-9]+(?:\.[0-9]+)?$/.test(record.beforeRevision)) {
          throw new TypeError('source_edited requires decimal beforeRevision and no exact revision');
        }
        beforeRevision = record.beforeRevision;
      } else if (record.beforeRevision !== undefined) {
        throw new TypeError('beforeRevision is only valid for source_edited');
      }

      return {
        scope: 'resource_lifecycle',
        workspaceId: record.workspaceId.trim(),
        resourceType: record.resourceType as SlackResourceType,
        resourceId: record.resourceId.trim(),
        ...(revision ? { revision } : {}),
        ...(beforeRevision ? { beforeRevision } : {}),
        cascadeTargetKinds,
        tombstoneReason: record.tombstoneReason,
      };
    }

    case 'workspace_consent_revocation': {
      if (!Object.hasOwn(record, 'workspaceId') || typeof record.workspaceId !== 'string' || !record.workspaceId.trim()) {
        throw new TypeError('workspace_consent_revocation requires valid workspaceId');
      }

      if (!Object.hasOwn(record, 'policyVersion') || typeof record.policyVersion !== 'string' || !record.policyVersion.trim()) {
        throw new TypeError('workspace_consent_revocation requires valid policyVersion');
      }

      if (
        !Object.hasOwn(record, 'providerProfileId') ||
        typeof record.providerProfileId !== 'string' ||
        !record.providerProfileId.trim()
      ) {
        throw new TypeError('workspace_consent_revocation requires valid providerProfileId');
      }

      if (
        !Object.hasOwn(record, 'consentRevision') ||
        typeof record.consentRevision !== 'string' ||
        !CANONICAL_CONSENT_REVISION.test(record.consentRevision)
      ) {
        throw new TypeError('workspace_consent_revocation requires canonical decimal string consentRevision');
      }

      if (record.tombstoneReason !== 'consent_revoked') {
        throw new TypeError('workspace_consent_revocation requires tombstoneReason consent_revoked');
      }

      return {
        scope: 'workspace_consent_revocation',
        workspaceId: record.workspaceId.trim(),
        policyVersion: record.policyVersion.trim(),
        providerProfileId: record.providerProfileId.trim(),
        consentRevision: record.consentRevision,
        cascadeTargetKinds,
        tombstoneReason: 'consent_revoked',
      };
    }

    case 'policy_epoch_invalidated': {
      if (!Object.hasOwn(record, 'epoch')) throw new TypeError('policy_epoch_invalidated requires epoch');
      const cleanEpoch = validateSlackPolicyEpoch(record.epoch);

      if (record.tombstoneReason !== 'policy_changed') {
        throw new TypeError('policy_epoch_invalidated requires tombstoneReason "policy_changed"');
      }

      return {
        scope: 'policy_epoch_invalidated',
        epoch: cleanEpoch,
        cascadeTargetKinds,
        tombstoneReason: 'policy_changed',
      };
    }

    default:
      throw new TypeError(`Unknown Slack purge scope: ${(record as any).scope}`);
  }
}
