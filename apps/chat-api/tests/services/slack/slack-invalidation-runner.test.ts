import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createMigratedSchema } from '../../helpers/gmail-test-db.js';
import {
  SlackInvalidationRunner,
  sanitizeSlackInvalidationError,
} from '../../../src/services/slack/slack-invalidation-runner.js';
import { SlackInvalidationService } from '../../../src/services/slack/slack-invalidation-service.js';
import { SlackPolicyEventConsumer } from '../../../src/services/slack/slack-policy-event-consumer.js';
import { SlackSourceRepo } from '../../../src/db/repositories/slack-source-repo.js';
import { SlackConsentRepo } from '../../../src/db/repositories/slack-consent-repo.js';
import type { SlackBinding, SlackPolicyReference, SlackSourceRef } from '@wap/tool-schemas';

describe('SlackInvalidationRunner on PostgreSQL (03B1)', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  let runner: SlackInvalidationRunner;
  let invalidationService: SlackInvalidationService;
  let sourceRepo: SlackSourceRepo;
  let consentRepo: SlackConsentRepo;
  let policyEventConsumer: SlackPolicyEventConsumer;

  beforeAll(async () => {
    db = await createMigratedSchema('slack_invalidation_runner');
    invalidationService = new SlackInvalidationService(db.pool);
    sourceRepo = new SlackSourceRepo(db.pool);
    consentRepo = new SlackConsentRepo(db.pool);
    policyEventConsumer = new SlackPolicyEventConsumer(db.pool, invalidationService, sourceRepo);
    runner = new SlackInvalidationRunner(sourceRepo, invalidationService, policyEventConsumer, {
      sweepIntervalMs: 50,
      batchSize: 50,
      leaseSeconds: 10,
    });
  });

  afterAll(async () => {
    await runner?.stop();
    await db?.close();
  });

  async function seedEnv(workspaceId = 'T_RUNNER_1') {
    const person = await db.person('Eve');
    const connectionId = randomUUID();
    await db.pool.query(
      `INSERT INTO slack_connections (
        id, user_id, app_id, workspace_id, workspace_name, actor_id,
        identity_version, status, config, scopes, connected_at, last_state_order
      ) VALUES ($1, $2, 'A_APP', $3, 'Test Workspace', 'U_EVE', 1, 'active', 'ENCRYPTED_CONFIG', ARRAY['channels:history'], now(), '0001')`,
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
      slackUserId: 'U_EVE',
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

  it('T6.1: Expiry worker erases expired raw source content without live Slack token', async () => {
    const env = await seedEnv('T_EXPIRY_RUNNER');
    const sourceRef: SlackSourceRef = {
      binding: env.binding,
      resourceType: 'message',
      resourceId: 'MSG_EXPIRED_1',
      revision: '1.0',
    };

    // Save source
    const saved = await sourceRepo.saveSourceAtomic({
      sourceRef,
      policyRef: env.policyRef,
      untrustedContent: 'Secret Raw Message that must expire',
      metadata: { channelId: 'C_SECRET' },
    });

    // Manually force captured_at and expires_at into the past to simulate TTL passage while satisfying check constraint
    await db.pool.query(
      `UPDATE slack_sources
       SET captured_at = now() - interval '2 days',
           expires_at = now() - interval '1 day'
       WHERE id = $1`,
      [saved.id]
    );

    // Verify before tick
    const beforeCheck = await db.pool.query('SELECT * FROM slack_sources WHERE id = $1', [saved.id]);
    expect(beforeCheck.rows[0].untrusted_content).toBe('Secret Raw Message that must expire');
    expect(beforeCheck.rows[0].purged_at).toBeNull();

    // Run runner tick
    const stats = await runner.tick();
    expect(stats.expiredSourcesPurged).toBeGreaterThanOrEqual(1);

    // Verify after tick: content erased, metadata empty, purged_at set, tombstone_reason set
    const afterCheck = await db.pool.query('SELECT * FROM slack_sources WHERE id = $1', [saved.id]);
    const row = afterCheck.rows[0];
    expect(row.untrusted_content).toBe('');
    expect(row.metadata).toEqual({});
    expect(row.purged_at).not.toBeNull();
    expect(row.tombstone_reason).toBe('retention_expired');
  });

  it('T6.2: Raw-only purge leaves derived target kinds pending for 03B2', async () => {
    const env = await seedEnv('T_RAW_ONLY_RUNNER');
    const sourceRef: SlackSourceRef = {
      binding: env.binding,
      resourceType: 'message',
      resourceId: 'MSG_PURGE_INTENT_1',
      revision: '1.0',
    };

    // Save source
    const saved = await sourceRepo.saveSourceAtomic({
      sourceRef,
      policyRef: env.policyRef,
      untrustedContent: 'Message to be purged via intent',
      metadata: { channelId: 'C_CH1' },
    });

    // Stage invalidation effect with raw target + 7 cascade targets
    const client = await db.pool.connect();
    let receiptRes: any;
    try {
      await client.query('BEGIN');
      receiptRes = await invalidationService.stageInTransaction(client, {
        sourceEventKey: 'runner_test:event_1',
        effects: [
          {
            effectKey: 'runner_test:effect_1',
            barrier: {
              barrierType: 'channel',
              binding: env.binding,
              channelId: 'C_CH1',
              reason: 'channel_membership_lost',
            },
            purgeTarget: {
              scope: 'channel_membership_lost',
              binding: env.binding,
              channelId: 'C_CH1',
              cascadeTargetKinds: [
                'chat_history_message',
                'working_memory_entity',
                'plan_step_arg',
                'proposal_excerpt',
                'daily_digest_entry',
                'scheduled_workflow_arg',
                'audit_log_entry',
              ],
              tombstoneReason: 'channel_membership_lost',
            },
          },
        ],
      });
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    // Verify 8 intents were created: 1 slack_source_raw + 7 derived cascade targets
    const initialIntents = await db.pool.query(
      `SELECT target_kind, status FROM slack_invalidation_intents WHERE source_event_key = 'runner_test:event_1'`
    );
    expect(initialIntents.rows).toHaveLength(8);
    const rawIntentBefore = initialIntents.rows.find(r => r.target_kind === 'slack_source_raw');
    expect(rawIntentBefore?.status).toBe('pending');

    // Run runner tick
    const stats = await runner.tick();
    expect(stats.rawIntentsProcessed).toBeGreaterThanOrEqual(1);

    // Verify: slack_source_raw intent is completed
    const finalIntents = await db.pool.query(
      `SELECT target_kind, status, completed_at FROM slack_invalidation_intents WHERE source_event_key = 'runner_test:event_1'`
    );
    const rawIntentAfter = finalIntents.rows.find(r => r.target_kind === 'slack_source_raw');
    expect(rawIntentAfter?.status).toBe('completed');
    expect(rawIntentAfter?.completed_at).not.toBeNull();

    // Verify: All 7 derived cascade targets remain PENDING with completed_at null
    const derivedIntents = finalIntents.rows.filter(r => r.target_kind !== 'slack_source_raw');
    expect(derivedIntents).toHaveLength(7);
    for (const derived of derivedIntents) {
      expect(derived.status).toBe('pending');
      expect(derived.completed_at).toBeNull();
    }

    // Verify source record was erased
    const sourceCheck = await db.pool.query('SELECT * FROM slack_sources WHERE id = $1', [saved.id]);
    expect(sourceCheck.rows[0].untrusted_content).toBe('');
    expect(sourceCheck.rows[0].purged_at).not.toBeNull();
    expect(sourceCheck.rows[0].tombstone_reason).toBe('channel_membership_lost');
  });

  it('T6.3: Lifecycle start and stop cleanly manages timers', async () => {
    expect(runner.isRunning()).toBe(false);
    runner.start();
    expect(runner.isRunning()).toBe(true);

    // Calling start again is idempotent
    runner.start();
    expect(runner.isRunning()).toBe(true);

    await runner.stop();
    expect(runner.isRunning()).toBe(false);
  });

  it('T6.4: failed intents persist only a coarse error code, never raw body or token text', async () => {
    const sentinel = 'RAW_BODY_SECRET_TOKEN_abc123';
    expect(sanitizeSlackInvalidationError(new Error(`${sentinel} at /slack/raw`))).toBe(
      'code:INVALIDATION_ERROR'
    );
    expect(
      sanitizeSlackInvalidationError(
        Object.assign(new Error(`failed while handling ${sentinel}`), { code: 'PURGE_FAILED' })
      )
    ).toBe('code:PURGE_FAILED');

    const inserted = await db.pool.query(
      `INSERT INTO slack_invalidation_intents (
         source_event_key, effect_key, target_kind, purge_target, status
       ) VALUES ($1, $2, 'slack_source_raw', $3::jsonb, 'pending')
       RETURNING id`,
      [
        `runner_test:bad_intent_${randomUUID()}`,
        'runner_test:bad_effect',
        JSON.stringify({
          scope: 'resource_lifecycle',
          workspaceId: 'T_BAD_INTENT',
          resourceType: 'message',
          resourceId: sentinel,
          cascadeTargetKinds: [],
          tombstoneReason: 'not_a_reason',
          note: sentinel,
        }),
      ]
    );

    const stats = await runner.tick();
    expect(stats.rawIntentsFailed).toBeGreaterThanOrEqual(1);

    const rows = await db.pool.query(
      'SELECT status, last_error, attempts FROM slack_invalidation_intents WHERE id = $1',
      [inserted.rows[0].id]
    );
    expect(rows.rows[0].status).toBe('failed');
    expect(rows.rows[0].last_error).toBe('code:INVALIDATION_ERROR');
    expect(rows.rows[0].last_error).not.toContain(sentinel);
    expect(rows.rows[0].attempts).toBeGreaterThanOrEqual(1);
  });
});
