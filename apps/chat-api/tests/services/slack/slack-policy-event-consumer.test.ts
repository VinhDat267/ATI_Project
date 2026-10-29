import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createMigratedSchema } from '../../helpers/gmail-test-db.js';
import { SlackPolicyEventConsumer } from '../../../src/services/slack/slack-policy-event-consumer.js';
import { SlackInvalidationService } from '../../../src/services/slack/slack-invalidation-service.js';
import { SlackSourceRepo } from '../../../src/db/repositories/slack-source-repo.js';
import { SlackConsentRepo } from '../../../src/db/repositories/slack-consent-repo.js';
import {
  slackPolicyRefToEpoch,
  type SlackBinding,
  type SlackPolicyReference,
  type SlackPurgeTarget,
  type SlackSourceRef,
} from '@wap/tool-schemas';

describe('SlackPolicyEventConsumer on PostgreSQL (03B1)', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  let consumer: SlackPolicyEventConsumer;
  let invalidationService: SlackInvalidationService;
  let sourceRepo: SlackSourceRepo;
  let consentRepo: SlackConsentRepo;

  beforeAll(async () => {
    db = await createMigratedSchema('slack_policy_consumer');
    invalidationService = new SlackInvalidationService(db.pool);
    sourceRepo = new SlackSourceRepo(db.pool);
    consentRepo = new SlackConsentRepo(db.pool);
    consumer = new SlackPolicyEventConsumer(db.pool, invalidationService, sourceRepo);
  });

  afterAll(async () => {
    await db?.close();
  });

  async function seedEnv(workspaceId = 'T_CONSUMER_1') {
    const person = await db.person('Dave');
    const connectionId = randomUUID();
    await db.pool.query(
      `INSERT INTO slack_connections (
        id, user_id, app_id, workspace_id, workspace_name, actor_id,
        identity_version, status, config, scopes, connected_at, last_state_order
      ) VALUES ($1, $2, 'A_APP', $3, 'Test Workspace', 'U_DAVE', 1, 'active', 'ENCRYPTED_CONFIG', ARRAY['channels:history'], now(), '0001')`,
      [connectionId, person.id, workspaceId]
    );

    const existingProvider = await consentRepo.getTrustedProvider('provider-1');
    const provider = existingProvider ?? await consentRepo.attestProvider({
      id: 'provider-1',
      name: 'AI Provider 1',
      verified: true,
      noTraining: true,
      maxRetentionDays: 30,
      configurationFingerprint: 'fp_prov_1',
      evidenceRef: 'SOC2-1',
      verifiedBy: 'auditor@example.com',
      verifiedAt: new Date(),
    });

    const consent = await consentRepo.grantConsent({
      workspaceId,
      providerId: 'provider-1',
      policyVersion: '2026-10-28',
      purposes: ['storage', 'manual_lookup', 'triage'],
      retentionDays: 30,
      organizationRepresentative: 'admin@example.com',
      evidenceRef: 'CONSENT-1',
      recordedBy: 'operator@example.com',
    });

    const binding: SlackBinding = {
      atiUserId: person.id,
      connectionId,
      workspaceId,
      slackUserId: 'U_DAVE',
      identityVersion: 1,
    };

    const policyRef: SlackPolicyReference = {
      binding,
      purpose: 'storage',
      requestedRetentionDays: 30,
      providerProfileId: 'provider-1',
      configFingerprint: provider.configurationFingerprint,
      policyVersion: '2026-10-28',
      consentRevision: String(consent.revision),
      providerRevision: String(provider.revision),
    };

    return { person, connectionId, workspaceId, binding, policyRef, consent, provider };
  }

  it('T5.1: processes 4 event kinds idempotently via receipt table and anti-join', async () => {
    const env = await seedEnv('T_ALL_4_EVENTS');

    // 1. Initial consent_granted and provider_attested are already recorded in slack_policy_events by seedEnv
    // 2. Add provider_updated
    await consentRepo.attestProvider({
      id: 'provider-1',
      name: 'AI Provider 1 (Updated)',
      verified: true,
      noTraining: true,
      maxRetentionDays: 30,
      configurationFingerprint: 'fp_prov_1_v2',
      evidenceRef: 'SOC2-2',
      verifiedBy: 'auditor@example.com',
      verifiedAt: new Date(),
      expectedRevision: 1n,
    });

    // 3. Add consent_revoked
    await consentRepo.revokeConsent({
      workspaceId: env.workspaceId,
      providerId: 'provider-1',
      recordedBy: 'operator@example.com',
      reason: 'testing revocation',
      expectedRevision: BigInt(env.consent.revision),
    });

    // Verify 4 events exist in slack_policy_events
    const allEvents = await db.pool.query('SELECT * FROM slack_policy_events ORDER BY occurred_at, id');
    expect(allEvents.rows.length).toBeGreaterThanOrEqual(4);

    // Run consumer
    const result = await consumer.consumePendingPolicyEvents(50);
    expect(result.processedCount).toBeGreaterThanOrEqual(4);

    // Second run: All receipts exist -> 0 events to process!
    const secondResult = await consumer.consumePendingPolicyEvents(50);
    expect(secondResult.processedCount).toBe(0);
  });

  it('T5.2: Grant 1 -> Revoke 2 -> Regrant 3 expands to exact old epoch and preserves fresh regrant', async () => {
    const env = await seedEnv('T_REGRANT_PRESERVE');
    const sourceRef: SlackSourceRef = {
      binding: env.binding,
      resourceType: 'message',
      resourceId: 'MSG_EPOCH_1',
      revision: '1.0',
    };

    // Save source under Epoch 1
    const cap1 = await sourceRepo.saveSourceAtomic({
      sourceRef,
      policyRef: env.policyRef,
      untrustedContent: 'Content Epoch 1',
    });
    expect(cap1.id).toBeDefined();

    // Revoke consent -> creates consent_revoked event
    await consentRepo.revokeConsent({
      workspaceId: env.workspaceId,
      providerId: 'provider-1',
      recordedBy: 'admin@example.com',
      reason: 'security update',
      expectedRevision: BigInt(env.policyRef.consentRevision),
    });

    // Process policy event
    const runResult = await consumer.consumePendingPolicyEvents(50);
    expect(runResult.processedCount).toBeGreaterThan(0);

    // Verify barrier exists for Epoch 1
    const epoch1Check = await invalidationService.checkBarriers({
      epoch: slackPolicyRefToEpoch(env.policyRef),
    });
    expect(epoch1Check.blocked).toBe(true);
    expect(epoch1Check.reason).toBe('consent_revoked');

    // Regrant consent -> revision 3
    const newConsent = await consentRepo.grantConsent({
      workspaceId: env.workspaceId,
      providerId: 'provider-1',
      policyVersion: '2026-10-28',
      purposes: ['storage', 'manual_lookup'],
      retentionDays: 30,
      organizationRepresentative: 'admin@example.com',
      evidenceRef: 'CONSENT-NEW',
      recordedBy: 'admin@example.com',
      expectedRevision: 2n, // after revoke, revision is 2
    });

    // Check barrier for Epoch 3
    const epoch3Check = await invalidationService.checkBarriers({
      epoch: {
        ...slackPolicyRefToEpoch(env.policyRef),
        consentRevision: String(newConsent.revision),
      },
    });
    // Fresh regrant Epoch 3 MUST NOT be blocked!
    expect(epoch3Check.blocked).toBe(false);
  });

  it('T5.3: anti-join prevents starvation across batches (> 50 events)', async () => {
    // Insert 60 policy events directly
    const person = await db.person('BatchUser');
    for (let i = 0; i < 60; i++) {
      await db.pool.query(
        `INSERT INTO slack_policy_events (
          workspace_id, provider_id, event_type, policy_version,
          consent_revision, provider_revision, reason, occurred_at
        ) VALUES ($1, 'batch-provider', 'consent_granted', '2026-10-28', $2, 1, 'batch_test', now() - make_interval(secs => $3))`,
        [`T_BATCH_${i}`, i + 1, 60 - i]
      );
    }

    // Batch 1: Limit 40
    const batch1 = await consumer.consumePendingPolicyEvents(40);
    expect(batch1.processedCount).toBe(40);

    // Batch 2: Next batch processes the remaining without starvation
    const batch2 = await consumer.consumePendingPolicyEvents(40);
    expect(batch2.processedCount).toBeGreaterThanOrEqual(20);

    // Batch 3: Zero remaining
    const batch3 = await consumer.consumePendingPolicyEvents(40);
    expect(batch3.processedCount).toBe(0);
  });

  it('T5.4: consent_granted invalidates only epochs older than the new revision, leaving the regrant untouched', async () => {
    const env = await seedEnv('T_CONSENT_GRANTED_EPOCH');
    const sourceRef: SlackSourceRef = {
      binding: env.binding,
      resourceType: 'message',
      resourceId: 'MSG_GRANT_EPOCH',
      revision: '1.1',
    };

    const capOld = await sourceRepo.saveSourceAtomic({
      sourceRef,
      policyRef: env.policyRef,
      untrustedContent: 'Captured under revision 1',
      metadata: { channelId: 'C_GRANT' },
    });

    const newConsent = await consentRepo.grantConsent({
      workspaceId: env.workspaceId,
      providerId: 'provider-1',
      policyVersion: '2026-10-28',
      purposes: ['storage', 'manual_lookup'],
      retentionDays: 30,
      organizationRepresentative: 'admin@example.com',
      evidenceRef: 'CONSENT-REGRANT',
      recordedBy: 'operator@example.com',
      expectedRevision: BigInt(env.consent.revision),
    });

    await consumer.consumePendingPolicyEvents(100);

    const oldEpochCheck = await invalidationService.checkBarriers({
      epoch: slackPolicyRefToEpoch(env.policyRef),
    });
    expect(oldEpochCheck.blocked).toBe(true);
    expect(oldEpochCheck.reason).toBe('policy_changed');

    const newPolicyRef: SlackPolicyReference = {
      ...env.policyRef,
      consentRevision: String(newConsent.revision),
    };
    const newEpochCheck = await invalidationService.checkBarriers({
      epoch: slackPolicyRefToEpoch(newPolicyRef),
    });
    expect(newEpochCheck.blocked).toBe(false);

    const capNew = await sourceRepo.saveSourceAtomic({
      sourceRef: { ...sourceRef, resourceId: 'MSG_GRANT_EPOCH_NEW' },
      policyRef: newPolicyRef,
      untrustedContent: 'Captured under the fresh regrant',
      metadata: { channelId: 'C_GRANT' },
    });

    const purgeTarget: SlackPurgeTarget = {
      scope: 'policy_epoch_invalidated',
      epoch: slackPolicyRefToEpoch(env.policyRef),
      cascadeTargetKinds: [],
      tombstoneReason: 'policy_changed',
    };
    const purged = await sourceRepo.purgeSourcesByTarget(purgeTarget);
    expect(purged.purgedCount).toBe(1);

    const oldAfter = await sourceRepo.getSourceById(capOld.id);
    expect(oldAfter!.purgedAt).not.toBeNull();
    expect(oldAfter!.untrustedContent).toBe('');
    const newAfter = await sourceRepo.getSourceById(capNew.id);
    expect(newAfter!.purgedAt).toBeNull();
    expect(newAfter!.untrustedContent).toBe('Captured under the fresh regrant');

    // Replaying the same grant event is idempotent and adds no barrier for the fresh epoch.
    const replay = await consumer.consumePendingPolicyEvents(100);
    expect(replay.processedCount).toBe(0);
    expect(
      (await invalidationService.checkBarriers({ epoch: slackPolicyRefToEpoch(newPolicyRef) })).blocked
    ).toBe(false);
  });

  it('T5.5: provider_updated invalidates exact old provider epochs and leaves the new provider epoch unblocked', async () => {
    const env = await seedEnv('T_PROVIDER_UPDATED_EPOCH');
    const before = await consentRepo.getTrustedProvider('provider-1');
    expect(before).not.toBeNull();

    const oldPolicyRef: SlackPolicyReference = {
      ...env.policyRef,
      configFingerprint: before!.configurationFingerprint,
      providerRevision: String(before!.revision),
    };
    const capOld = await sourceRepo.saveSourceAtomic({
      sourceRef: {
        binding: env.binding,
        resourceType: 'message',
        resourceId: 'MSG_PROVIDER_UPDATED',
        revision: '2.1',
      },
      policyRef: oldPolicyRef,
      untrustedContent: 'Captured under the old provider attestation',
      metadata: { channelId: 'C_PROVIDER' },
    });

    const updated = await consentRepo.attestProvider({
      id: 'provider-1',
      name: 'AI Provider 1 (Updated fingerprint)',
      verified: true,
      noTraining: true,
      maxRetentionDays: 30,
      configurationFingerprint: 'fp_prov_1_rotated',
      evidenceRef: 'SOC2-ROTATED',
      verifiedBy: 'auditor@example.com',
      verifiedAt: new Date(),
      expectedRevision: BigInt(before!.revision),
    });

    await consumer.consumePendingPolicyEvents(100);

    const oldEpochCheck = await invalidationService.checkBarriers({
      epoch: slackPolicyRefToEpoch(oldPolicyRef),
    });
    expect(oldEpochCheck.blocked).toBe(true);
    expect(oldEpochCheck.reason).toBe('policy_changed');

    const newPolicyRef: SlackPolicyReference = {
      ...env.policyRef,
      configFingerprint: updated.configurationFingerprint,
      providerRevision: String(updated.revision),
    };
    expect(
      (await invalidationService.checkBarriers({ epoch: slackPolicyRefToEpoch(newPolicyRef) })).blocked
    ).toBe(false);

    const capNew = await sourceRepo.saveSourceAtomic({
      sourceRef: {
        binding: env.binding,
        resourceType: 'message',
        resourceId: 'MSG_PROVIDER_UPDATED_NEW',
        revision: '2.2',
      },
      policyRef: newPolicyRef,
      untrustedContent: 'Captured under the new provider attestation',
      metadata: { channelId: 'C_PROVIDER' },
    });

    const purged = await sourceRepo.purgeSourcesByTarget({
      scope: 'policy_epoch_invalidated',
      epoch: slackPolicyRefToEpoch(oldPolicyRef),
      cascadeTargetKinds: [],
      tombstoneReason: 'policy_changed',
    });
    expect(purged.purgedCount).toBe(1);
    expect((await sourceRepo.getSourceById(capOld.id))!.purgedAt).not.toBeNull();
    expect((await sourceRepo.getSourceById(capNew.id))!.purgedAt).toBeNull();
  });

  it('T5.6: revocation with no stored source creates a receipt but no wildcard barrier; a fresh regrant saves and stays unblocked', async () => {
    const env = await seedEnv('T_NO_SOURCE_REVOKE');
    const revoke = await consentRepo.revokeConsent({
      workspaceId: env.workspaceId,
      providerId: 'provider-1',
      recordedBy: 'operator@example.com',
      reason: 'no source stored yet',
      expectedRevision: BigInt(env.consent.revision),
    });
    expect(revoke).not.toBeNull();

    await consumer.consumePendingPolicyEvents(100);

    const revokeEvent = await db.pool.query(
      `SELECT id FROM slack_policy_events
       WHERE workspace_id = $1 AND event_type = 'consent_revoked'
       ORDER BY occurred_at DESC, id DESC LIMIT 1`,
      [env.workspaceId]
    );
    expect(revokeEvent.rows).toHaveLength(1);
    const receipts = await db.pool.query(
      'SELECT id FROM slack_invalidation_receipts WHERE source_event_key = $1',
      [`policy:${revokeEvent.rows[0].id}`]
    );
    expect(receipts.rows).toHaveLength(1);

    // No empty-source fallback barrier (in particular no conversation:* wildcard) exists.
    const barriers = await db.pool.query(
      'SELECT channel_id, effect_key FROM slack_invalidation_barriers WHERE workspace_id = $1',
      [env.workspaceId]
    );
    expect(barriers.rows).toHaveLength(0);

    // The durable policy event + receipt remains the explicit 03B2 seam: a receipt with no
    // derived intents can be expanded later without a barrier that would block a regrant.
    const noSourceIntents = await db.pool.query(
      'SELECT id FROM slack_invalidation_intents WHERE source_event_key = $1',
      [`policy:${revokeEvent.rows[0].id}`]
    );
    expect(noSourceIntents.rows).toHaveLength(0);

    const fresh = await consentRepo.grantConsent({
      workspaceId: env.workspaceId,
      providerId: 'provider-1',
      policyVersion: '2026-10-28',
      purposes: ['storage', 'manual_lookup'],
      retentionDays: 30,
      organizationRepresentative: 'admin@example.com',
      evidenceRef: 'CONSENT-FRESH',
      recordedBy: 'operator@example.com',
      expectedRevision: BigInt(revoke!.revision),
    });
    const freshPolicyRef: SlackPolicyReference = {
      ...env.policyRef,
      consentRevision: String(fresh.revision),
    };

    const saved = await sourceRepo.saveSourceAtomic({
      sourceRef: {
        binding: env.binding,
        resourceType: 'message',
        resourceId: 'MSG_FRESH_REGRANT',
        revision: '3.1',
      },
      policyRef: freshPolicyRef,
      untrustedContent: 'Fresh regrant content',
      metadata: { channelId: 'C_FRESH' },
    });

    // The fresh consent_granted event is consumed without barriering the new epoch.
    await consumer.consumePendingPolicyEvents(100);
    expect(
      (await invalidationService.checkBarriers({ epoch: slackPolicyRefToEpoch(freshPolicyRef) })).blocked
    ).toBe(false);

    const purged = await sourceRepo.purgeSourcesByTarget({
      scope: 'workspace_consent_revocation',
      workspaceId: env.workspaceId,
      policyVersion: '2026-10-28',
      providerProfileId: 'provider-1',
      consentRevision: String(fresh.revision),
      cascadeTargetKinds: [],
      tombstoneReason: 'consent_revoked',
    });
    expect(purged.purgedCount).toBe(0);
    expect((await sourceRepo.getSourceById(saved.id))!.purgedAt).toBeNull();
    expect((await sourceRepo.getSourceById(saved.id))!.untrustedContent).toBe('Fresh regrant content');
  });
});
