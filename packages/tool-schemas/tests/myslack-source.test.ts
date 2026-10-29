import { describe, expect, it } from 'vitest';
import {
  validateSlackSourceMetadata,
  validateSlackSourceEntity,
  validateSlackDerivedCopyRef,
  validateSlackSourceLineage,
  validateSlackTombstoneRecord,
  validateSlackPurgeTarget,
  formatSlackOwnerSourceKey,
  type SlackBinding,
  type SlackSourceRef,
  type SlackPolicyReference,
  type SlackPolicyEpoch,
  type SlackSourceEntity,
  type SlackPurgeTarget,
} from '../src/index.js';

const binding: SlackBinding = {
  atiUserId: 'ati-user-1',
  connectionId: 'conn-1',
  workspaceId: 'T123',
  slackUserId: 'U123',
  identityVersion: 1,
};

const sourceRef: SlackSourceRef = {
  binding,
  resourceType: 'message',
  resourceId: 'msg-001',
  revision: '1729000000.000100',
};

const policyRef: SlackPolicyReference = {
  binding,
  purpose: 'storage',
  requestedRetentionDays: 7,
  providerProfileId: 'verified-provider',
  configFingerprint: 'cfg-hash-123',
  policyVersion: 'policy-v1',
  consentRevision: '1',
  providerRevision: '1',
};

describe('Slack Source Lifecycle, Lineage & Purge Contracts (F1, F2, F3)', () => {
  describe('SlackSourceMetadata', () => {
    it('whitelists and bounds permitted metadata fields while stripping unknown ones', () => {
      const input = {
        channelId: 'C123',
        channelName: 'general',
        threadTs: '1729000000.000001',
        authorSlackUserId: 'U456',
        authorName: 'Alice',
        fileName: 'report.pdf',
        fileMimeType: 'application/pdf',
        fileSizeBytes: 1024,
        isBotMessage: false,
        extraSecret: 'confidential-token',
        maliciousPayload: '<script>',
      };
      const clean = validateSlackSourceMetadata(input);
      expect(clean).toEqual({
        channelId: 'C123',
        channelName: 'general',
        threadTs: '1729000000.000001',
        authorSlackUserId: 'U456',
        authorName: 'Alice',
        fileName: 'report.pdf',
        fileMimeType: 'application/pdf',
        fileSizeBytes: 1024,
        isBotMessage: false,
      });
      expect((clean as any).extraSecret).toBeUndefined();
      expect((clean as any).maliciousPayload).toBeUndefined();
    });

    it('handles empty or undefined input gracefully', () => {
      expect(validateSlackSourceMetadata(undefined)).toEqual({});
      expect(validateSlackSourceMetadata({})).toEqual({});
    });

    it('rejects invalid types for metadata fields', () => {
      expect(() => validateSlackSourceMetadata({ fileSizeBytes: -1 })).toThrow(TypeError);
      expect(() => validateSlackSourceMetadata({ fileSizeBytes: 1.5 })).toThrow(TypeError);
      expect(() => validateSlackSourceMetadata({ isBotMessage: 'false' as any })).toThrow(TypeError);
    });
  });

  describe('SlackSourceEntity', () => {
    const validEntity: SlackSourceEntity = {
      id: 'src-entity-1',
      sourceRef,
      policyRef,
      untrustedContent: 'Hello world from Slack message',
      metadata: { channelId: 'C123' },
      observedRevision: '1729000000.000100',
      retentionDays: 7,
      capturedAt: '2026-10-29T20:00:00.000Z',
      expiresAt: '2026-11-05T20:00:00.000Z',
      tombstonedAt: null,
      purgedAt: null,
    };

    it('validates a complete, consistent SlackSourceEntity and returns detached copy', () => {
      const clean = validateSlackSourceEntity(validEntity);
      expect(clean).toEqual(validEntity);
      expect(clean).not.toBe(validEntity);
    });

    it('rejects SlackSourceEntity if sourceRef binding does not match policyRef binding', () => {
      const mismatch = {
        ...validEntity,
        policyRef: {
          ...policyRef,
          binding: { ...binding, atiUserId: 'another-ati-user' },
        },
      };
      expect(() => validateSlackSourceEntity(mismatch)).toThrow(TypeError);
    });

    it('rejects SlackSourceEntity if observedRevision does not equal sourceRef revision', () => {
      const mismatch = {
        ...validEntity,
        observedRevision: 'different-revision',
      };
      expect(() => validateSlackSourceEntity(mismatch)).toThrow(TypeError);
    });

    it('rejects SlackSourceEntity with zero or negative retentionDays', () => {
      expect(() => validateSlackSourceEntity({ ...validEntity, retentionDays: 0 })).toThrow(TypeError);
      expect(() => validateSlackSourceEntity({ ...validEntity, retentionDays: -5 })).toThrow(TypeError);
    });

    it('rejects SlackSourceEntity with invalid dates', () => {
      expect(() => validateSlackSourceEntity({ ...validEntity, capturedAt: 'invalid-date' })).toThrow(TypeError);
      expect(() => validateSlackSourceEntity({ ...validEntity, expiresAt: '2026-10-01T00:00:00.000Z' })).toThrow(TypeError);
    });

    it('stored source rejects a zero-retention policy reference', () => {
      expect(() =>
        validateSlackSourceEntity({
          ...validEntity,
          policyRef: { ...policyRef, requestedRetentionDays: 0 },
        })
      ).toThrow(TypeError);
    });

    it('raw source ceiling remains seven days even when provider consent allows more', () => {
      expect(() =>
        validateSlackSourceEntity({
          ...validEntity,
          retentionDays: 14,
          policyRef: { ...policyRef, requestedRetentionDays: 14 },
          expiresAt: '2026-11-12T00:00:00.000Z',
        })
      ).toThrow(TypeError);
    });

    it('expiry cannot exceed the declared source TTL', () => {
      expect(() =>
        validateSlackSourceEntity({
          ...validEntity,
          retentionDays: 1,
          expiresAt: '2027-10-29T00:00:00.000Z',
        })
      ).toThrow(TypeError);
    });

    it('source timestamps must be ISO UTC timestamps, not Date.parse coercions', () => {
      expect(() =>
        validateSlackSourceEntity({
          ...validEntity,
          capturedAt: '0',
          expiresAt: '2000-01-02T00:00:00.000Z',
        })
      ).toThrow(TypeError);
    });
  });

  describe('SlackDerivedCopyRef & Lineage', () => {
    it('validates derived copy references retaining policyRef', () => {
      const derivedCopy = {
        targetKind: 'chat_history_message' as const,
        targetId: 'chat-msg-123',
        sourceRefs: [sourceRef],
        policyRef,
        createdAt: '2026-10-29T20:05:00.000Z',
      };
      const clean = validateSlackDerivedCopyRef(derivedCopy);
      expect(clean).toEqual(derivedCopy);
    });

    it('rejects derived copy if sourceRef binding mismatches policyRef binding', () => {
      const badRef: SlackSourceRef = {
        ...sourceRef,
        binding: { ...binding, atiUserId: 'other-user' },
      };
      expect(() =>
        validateSlackDerivedCopyRef({
          targetKind: 'working_memory_entity',
          targetId: 'mem-1',
          sourceRefs: [badRef],
          policyRef,
          createdAt: '2026-10-29T20:05:00.000Z',
        })
      ).toThrow(TypeError);
    });

    it('validates full lineage and consistency of ownerSourceKey', () => {
      const ownerKey = formatSlackOwnerSourceKey(sourceRef);
      const lineage = {
        ownerSourceKey: ownerKey,
        origin: sourceRef,
        policyRef,
        derivedCopies: [
          {
            targetKind: 'chat_history_message' as const,
            targetId: 'chat-msg-123',
            sourceRefs: [sourceRef],
            policyRef,
            createdAt: '2026-10-29T20:05:00.000Z',
          },
        ],
      };
      const clean = validateSlackSourceLineage(lineage);
      expect(clean).toEqual(lineage);
    });

    it('rejects lineage when ownerSourceKey does not match origin ref', () => {
      expect(() =>
        validateSlackSourceLineage({
          ownerSourceKey: 'bogus-key',
          origin: sourceRef,
          policyRef,
          derivedCopies: [],
        })
      ).toThrow(TypeError);
    });

    it('lineage cannot attach an unrelated resource copy with the same binding', () => {
      const ownerKey = formatSlackOwnerSourceKey(sourceRef);
      expect(() =>
        validateSlackSourceLineage({
          ownerSourceKey: ownerKey,
          origin: sourceRef,
          policyRef,
          derivedCopies: [
            {
              targetKind: 'plan_step_arg' as const,
              targetId: 'plan-1:step-1',
              sourceRefs: [{ ...sourceRef, resourceId: 'OTHER_MESSAGE' }],
              policyRef,
              createdAt: '2026-10-29T20:05:00.000Z',
            },
          ],
        })
      ).toThrow(TypeError);
    });

    it('lineage cannot silently adopt a derived copy from another consent epoch', () => {
      const ownerKey = formatSlackOwnerSourceKey(sourceRef);
      expect(() =>
        validateSlackSourceLineage({
          ownerSourceKey: ownerKey,
          origin: sourceRef,
          policyRef,
          derivedCopies: [
            {
              targetKind: 'plan_step_arg' as const,
              targetId: 'plan-1:step-1',
              sourceRefs: [sourceRef],
              policyRef: { ...policyRef, consentRevision: '2' },
              createdAt: '2026-10-29T20:05:00.000Z',
            },
          ],
        })
      ).toThrow(TypeError);
    });
  });

  describe('SlackTombstoneRecord', () => {
    it('validates a tombstone record', () => {
      const tombstone = {
        sourceRef,
        reason: 'source_deleted' as const,
        tombstonedAt: '2026-10-29T21:00:00.000Z',
        purgedAt: null,
      };
      expect(validateSlackTombstoneRecord(tombstone)).toEqual(tombstone);

      const policyChangedTombstone = {
        ...tombstone,
        reason: 'policy_changed' as const,
      };
      expect(validateSlackTombstoneRecord(policyChangedTombstone)).toEqual(policyChangedTombstone);
    });

    it('rejects tombstone record with invalid reason', () => {
      expect(() =>
        validateSlackTombstoneRecord({
          sourceRef,
          reason: 'unauthorized_reason' as any,
          tombstonedAt: '2026-10-29T21:00:00.000Z',
          purgedAt: null,
        })
      ).toThrow(TypeError);
    });
  });

  describe('SlackPurgeTarget (6 Tagged Scopes)', () => {
    it('validates scope: owner_retention with full binding, policyRef, and retention_expired reason', () => {
      const target: SlackPurgeTarget = {
        scope: 'owner_retention',
        binding,
        resourceType: 'message',
        resourceId: 'msg-001',
        revision: '1729000000.000100',
        policyRef,
        cascadeTargetKinds: ['chat_history_message', 'working_memory_entity'],
        tombstoneReason: 'retention_expired',
      };
      expect(validateSlackPurgeTarget(target)).toEqual(target);
    });

    it('rejects scope: owner_retention with wrong tombstoneReason or binding mismatch', () => {
      const wrongReason = {
        scope: 'owner_retention',
        binding,
        resourceType: 'message' as const,
        resourceId: 'msg-001',
        policyRef,
        cascadeTargetKinds: ['chat_history_message' as const],
        tombstoneReason: 'consent_revoked' as any,
      };
      expect(() => validateSlackPurgeTarget(wrongReason)).toThrow(TypeError);

      const bindingMismatch = {
        scope: 'owner_retention',
        binding,
        resourceType: 'message' as const,
        resourceId: 'msg-001',
        policyRef: { ...policyRef, binding: { ...binding, atiUserId: 'user-2' } },
        cascadeTargetKinds: ['chat_history_message' as const],
        tombstoneReason: 'retention_expired' as const,
      };
      expect(() => validateSlackPurgeTarget(bindingMismatch)).toThrow(TypeError);
    });

    it('validates scope: channel_membership_lost requiring specific channelId', () => {
      const target: SlackPurgeTarget = {
        scope: 'channel_membership_lost',
        binding,
        channelId: 'C_LOST_CHANNEL',
        cascadeTargetKinds: ['chat_history_message'],
        tombstoneReason: 'channel_membership_lost',
      };
      expect(validateSlackPurgeTarget(target)).toEqual(target);

      // Rejects if channelId is missing or empty
      expect(() =>
        validateSlackPurgeTarget({
          ...target,
          channelId: '',
        })
      ).toThrow(TypeError);
    });

    it('validates scope: authorization_disconnect requiring full binding and valid disconnect reason', () => {
      const target: SlackPurgeTarget = {
        scope: 'authorization_disconnect',
        binding,
        cascadeTargetKinds: ['chat_history_message', 'plan_step_arg'],
        tombstoneReason: 'connection_disconnected',
      };
      expect(validateSlackPurgeTarget(target)).toEqual(target);

      const reinstalled: SlackPurgeTarget = {
        ...target,
        tombstoneReason: 'app_reinstalled',
      };
      expect(validateSlackPurgeTarget(reinstalled)).toEqual(reinstalled);

      expect(() =>
        validateSlackPurgeTarget({
          ...target,
          tombstoneReason: 'source_deleted' as any,
        })
      ).toThrow(TypeError);
    });

    it('validates scope: resource_lifecycle with workspaceId and source edit/delete reason', () => {
      const target: SlackPurgeTarget = {
        scope: 'resource_lifecycle',
        workspaceId: 'T123',
        resourceType: 'message',
        resourceId: 'msg-123',
        revision: '1',
        cascadeTargetKinds: ['chat_history_message'],
        tombstoneReason: 'source_deleted',
      };
      expect(validateSlackPurgeTarget(target)).toEqual(target);

      const edited: SlackPurgeTarget = {
        ...target,
        tombstoneReason: 'source_edited',
      };
      expect(validateSlackPurgeTarget(edited)).toEqual(edited);
    });

    it('validates scope: workspace_consent_revocation requiring all 4 matching fields and consent_revoked reason', () => {
      const target: SlackPurgeTarget = {
        scope: 'workspace_consent_revocation',
        workspaceId: 'T123',
        policyVersion: 'policy-v1',
        providerProfileId: 'verified-provider',
        consentRevision: '1',
        cascadeTargetKinds: ['chat_history_message', 'working_memory_entity'],
        tombstoneReason: 'consent_revoked',
      };
      expect(validateSlackPurgeTarget(target)).toEqual(target);

      // Rejects non-canonical consentRevision (e.g., "0", "01", number)
      expect(() =>
        validateSlackPurgeTarget({
          ...target,
          consentRevision: '0',
        })
      ).toThrow(TypeError);

      expect(() =>
        validateSlackPurgeTarget({
          ...target,
          consentRevision: '01',
        })
      ).toThrow(TypeError);

      expect(() =>
        validateSlackPurgeTarget({
          ...target,
          consentRevision: 1 as any,
        })
      ).toThrow(TypeError);
    });

    it('validates scope: policy_epoch_invalidated requiring exact epoch and policy_changed reason', () => {
      const epoch: SlackPolicyEpoch = {
        binding,
        providerProfileId: 'verified-provider',
        configFingerprint: 'a'.repeat(64),
        policyVersion: 'policy-v1',
        consentRevision: '1',
        providerRevision: '1',
      };

      const target: SlackPurgeTarget = {
        scope: 'policy_epoch_invalidated',
        epoch,
        cascadeTargetKinds: ['chat_history_message', 'working_memory_entity'],
        tombstoneReason: 'policy_changed',
      };
      expect(validateSlackPurgeTarget(target)).toEqual(target);

      // Rejects if tombstoneReason is not 'policy_changed'
      expect(() =>
        validateSlackPurgeTarget({
          ...target,
          tombstoneReason: 'consent_revoked' as any,
        })
      ).toThrow(TypeError);

      // Rejects if epoch is missing or has invalid revision
      expect(() =>
        validateSlackPurgeTarget({
          ...target,
          epoch: { ...epoch, providerRevision: '0' },
        })
      ).toThrow(TypeError);

      expect(() =>
        validateSlackPurgeTarget({
          ...target,
          epoch: undefined as any,
        })
      ).toThrow(TypeError);
    });

    it('fails closed on unknown purge scope or invalid combinations', () => {
      expect(() =>
        validateSlackPurgeTarget({
          scope: 'unknown_scope' as any,
        })
      ).toThrow(TypeError);
    });
  });
});
