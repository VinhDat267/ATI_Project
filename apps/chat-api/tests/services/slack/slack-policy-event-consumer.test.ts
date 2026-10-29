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
});
