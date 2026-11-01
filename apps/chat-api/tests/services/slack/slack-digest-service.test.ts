import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createHash, randomUUID } from 'node:crypto';
import { defaultSlackAssistantConfig, SLACK_DERIVED_TARGET_KINDS } from '@wap/tool-schemas';
import { createSlackReadEnvironment, TEST_KEY } from '../../helpers/slack-private-read-fixture.js';
import { SlackDerivedLineageRepo } from '../../../src/db/repositories/slack-derived-lineage-repo.js';
import { SlackAssistantRepo } from '../../../src/db/repositories/slack-assistant-repo.js';
import { SlackAssistantArtifactRepo } from '../../../src/db/repositories/slack-assistant-artifact-repo.js';
import { PlanRepo } from '../../../src/db/repositories/plan-repo.js';
import { StepRepo } from '../../../src/db/repositories/step-repo.js';
import { MessageRepo } from '../../../src/db/repositories/message-repo.js';
import { registerScheduleFields } from '../../../src/services/slack/slack-schedule-lineage.js';
import { SlackProposalService } from '../../../src/services/slack/slack-proposal-service.js';
import { SlackDigestService } from '../../../src/services/slack/slack-digest-service.js';
import { SlackMessagePurgeConsumer } from '../../../src/services/slack/slack-message-purge-consumer.js';
import { createApp } from '../../../src/app.js';
import { generateAccessToken } from '../../../src/auth/jwt.js';

const secret = 'm4-digest-and-7kind-secret-at-least32chars';
let env: Awaited<ReturnType<typeof createSlackReadEnvironment>>;

beforeAll(async () => {
  env = await createSlackReadEnvironment('slack_digest_7kind');
}, 30000);

afterAll(async () => {
  await env?.close();
});

describe('SLACK-06B daily digest service, routes, and 7-kind physical erasure chain', () => {
  it('generates at most one digest per connection/local day at configured local time with zero external writes, and refreshes live proposal status', async () => {
    env.fixture.clearHandlers();
    env.fixture.reset();
    const owner = await env.addUser({
      name: 'Digest Owner',
      workspaceId: 'T_DIG_' + randomUUID().replaceAll('-', ''),
      actorId: 'U_DIG',
    });
    const consent1 = (await env.consentRepo.getConsent(owner.binding.workspaceId, env.runtimeIdentity.providerId))!;
    await env.consentRepo.grantConsent({
      workspaceId: owner.binding.workspaceId,
      providerId: env.runtimeIdentity.providerId,
      expectedRevision: consent1.revision,
      policyVersion: 'v1.0.0',
      purposes: ['triage', 'storage', 'planning', 'manual_lookup', 'digest'],
      retentionDays: 7,
      organizationRepresentative: 'fixture',
      evidenceRef: 'fixture',
      recordedBy: 'fixture',
    });
    const foreign = await env.db.person('Foreign Digest User');

    const artifacts = new SlackAssistantArtifactRepo(env.db.pool, env.policyService);
    const repo = new SlackAssistantRepo(
      env.db.pool,
      env.policyService,
      { appId: owner.row.app_id, automationEnabled: true, timezone: 'Asia/Ho_Chi_Minh' },
      artifacts,
    );
    const lineage = new SlackDerivedLineageRepo(env.db.pool, env.policyService);
    const plans = new PlanRepo(env.db.pool, lineage);
    const messages = new MessageRepo(env.db.pool, lineage);
    const proposals = new SlackProposalService({
      pool: env.db.pool,
      repo,
      artifacts,
      plans,
      messages,
      policy: env.policyService,
      invalidation: env.invalidationService,
    });
    const digests = new SlackDigestService({
      pool: env.db.pool,
      repo,
      artifacts,
      policy: env.policyService,
    });

    const cfg = defaultSlackAssistantConfig('Asia/Ho_Chi_Minh');
    cfg.enabled = true;
    cfg.digest = { enabled: true, time: '09:00' };
    const initial = await repo.getConfig(owner.person.id, owner.row.id);
    await repo.updateConfig(owner.person.id, owner.row.id, initial.configVersion, cfg);

    // Seed an active proposal
    const ts = '1730001111.000001';
    const text = '<@U_DIG> chuẩn bị báo cáo tuần cho khách hàng';
    const acqRef = await env.canonicalRef(owner.binding, 'triage');
    const storageRef = { ...acqRef, purpose: 'storage' as const, requestedRetentionDays: 1 };
    const currentCfg = await repo.getConfig(owner.person.id, owner.row.id);
    const decision: any = {
      kind: 'proposal',
      title: 'Chuẩn bị báo cáo tuần',
      rationale: 'Được nhắc trực tiếp trong kênh',
      sourceIndices: [0],
      relevance: { kind: 'mention', sourceIndex: 0, evidence: '<@U_DIG>' },
      intents: [{ action: 'task', service: 'trello', summary: 'Chuẩn bị báo cáo tuần cho khách hàng' }],
    };
    const lease: any = {
      binding: owner.binding,
      config: currentCfg.config,
      configVersion: currentCfg.configVersion,
      triggers: [{ channelId: 'C_DIG', messageTs: ts, threadTs: ts }],
    };
    const c = await env.db.pool.connect();
    let proposalId = '';
    try {
      await c.query('BEGIN');
      await artifacts.prepareProposalInTransaction(c, lease, decision, [
        { channelId: 'C_DIG', ts, threadTs: ts, user: 'U_OTHER', text, conversationType: 'public' },
      ]);
      proposalId = await artifacts.publishProposalInTransaction(
        c,
        lease,
        decision,
        [
          {
            sourceRef: {
              binding: owner.binding,
              resourceType: 'message',
              resourceId: JSON.stringify(['C_DIG', ts]),
              revision: ts,
            },
            acquisitionPolicyRef: acqRef,
            storagePolicyRef: storageRef,
            captureHash: createHash('sha256').update(text).digest('hex'),
            capturedAt: new Date().toISOString(),
            channelId: 'C_DIG',
          },
        ],
        [{ channelId: 'C_DIG', ts, threadTs: ts, user: 'U_OTHER', text, conversationType: 'public' }],
        false,
      );
      await c.query('COMMIT');
    } finally {
      c.release();
    }

    // 08:50 in Asia/Ho_Chi_Minh (01:50 UTC) -> before 09:00, should not generate
    const beforeNine = new Date('2026-11-02T01:50:00.000Z');
    const earlyRun = await digests.runDueDigests(beforeNine);
    expect(earlyRun.generated).toBe(0);

    // 09:05 in Asia/Ho_Chi_Minh (02:05 UTC) -> generates 1 digest
    const afterNine = new Date('2026-11-02T02:05:00.000Z');
    const dueRun = await digests.runDueDigests(afterNine);
    expect(dueRun.generated).toBe(1);
    expect(env.fixture.requests).toHaveLength(0); // zero external writes or network calls

    // Second run on the same local day is a no-op
    const duplicateRun = await digests.runDueDigests(new Date('2026-11-02T03:00:00.000Z'));
    expect(duplicateRun.generated).toBe(0);

    const app = createApp({
      jwtSecret: secret,
      userRepo: env.db.users,
      slackAssistant: { repo, artifacts, proposals, digests },
    });
    const ownerToken = 'Bearer ' + generateAccessToken(owner.person, secret, owner.person.sid).accessToken;
    const foreignToken = 'Bearer ' + generateAccessToken(foreign, secret, foreign.sid).accessToken;

    // Foreign user isolation
    expect(
      (await request(app).get('/api/slack/digests?connectionId=' + owner.row.id).set('Authorization', foreignToken)).body
        .digests,
    ).toEqual([]);

    const listRes = await request(app)
      .get('/api/slack/digests?connectionId=' + owner.row.id)
      .set('Authorization', ownerToken);
    expect(listRes.status).toBe(200);
    expect(listRes.body.digests).toHaveLength(1);
    const digest = listRes.body.digests[0];
    expect(digest.localDate).toBe('2026-11-02');
    expect(digest.body.entries).toHaveLength(1);
    expect(digest.body.entries[0]).toMatchObject({
      proposalId,
      title: 'Chuẩn bị báo cáo tuần',
      status: 'pending',
    });

    expect(
      (await request(app).post(`/api/slack/digests/${digest.id}/refresh-status`).set('Authorization', foreignToken))
        .status,
    ).toBe(404);

    // Reject the proposal, then refresh digest status
    await proposals.reject(owner.person.id, proposalId, { expectedRevision: 1 });
    const refreshed = await request(app)
      .post(`/api/slack/digests/${digest.id}/refresh-status`)
      .set('Authorization', ownerToken);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.digest.revision).toBe('2');
    expect(refreshed.body.digest.body.entries[0].status).toBe('rejected');
  }, 30000);

  it('physically purges all 7 derived artifact kinds (including proposal_excerpt and daily_digest_entry) when source message is deleted even with runtime flags off', async () => {
    const owner = await env.addUser({
      name: 'Seven Kind Owner',
      workspaceId: 'T_7KIND_' + randomUUID().replaceAll('-', ''),
      actorId: 'U_7KIND',
    });
    const consent2 = (await env.consentRepo.getConsent(owner.binding.workspaceId, env.runtimeIdentity.providerId))!;
    await env.consentRepo.grantConsent({
      workspaceId: owner.binding.workspaceId,
      providerId: env.runtimeIdentity.providerId,
      expectedRevision: consent2.revision,
      policyVersion: 'v1.0.0',
      purposes: ['triage', 'storage', 'planning', 'manual_lookup', 'digest'],
      retentionDays: 7,
      organizationRepresentative: 'fixture',
      evidenceRef: 'fixture',
      recordedBy: 'fixture',
    });
    const lineage = new SlackDerivedLineageRepo(env.db.pool, env.policyService);
    const artifacts = new SlackAssistantArtifactRepo(env.db.pool, env.policyService);
    const repo = new SlackAssistantRepo(
      env.db.pool,
      env.policyService,
      { appId: owner.row.app_id, automationEnabled: true, timezone: 'Asia/Ho_Chi_Minh' },
      artifacts,
    );
    const plans = new PlanRepo(env.db.pool, lineage);
    const steps = new StepRepo(env.db.pool, lineage);
    const messages = new MessageRepo(env.db.pool, lineage);
    const digests = new SlackDigestService({
      pool: env.db.pool,
      repo,
      artifacts,
      policy: env.policyService,
    });

    const cfg = defaultSlackAssistantConfig('Asia/Ho_Chi_Minh');
    cfg.enabled = true;
    cfg.digest = { enabled: true, time: '09:00' };
    const initial = await repo.getConfig(owner.person.id, owner.row.id);
    await repo.updateConfig(owner.person.id, owner.row.id, initial.configVersion, cfg);

    const ts = '1730002222.000002';
    const text = '<@U_7KIND> bí mật nội bộ cần xóa khi nguồn bị xóa';
    const acqRef = await env.canonicalRef(owner.binding, 'triage');
    const storageRef = { ...acqRef, purpose: 'storage' as const, requestedRetentionDays: 1 };
    const segment = {
      sourceRef: {
        binding: owner.binding,
        resourceType: 'message' as const,
        resourceId: JSON.stringify(['C_7KIND', ts]),
        revision: ts,
      },
      acquisitionPolicyRef: acqRef,
      storagePolicyRef: storageRef,
      captureHash: createHash('sha256').update(text).digest('hex'),
      capturedAt: new Date().toISOString(),
      channelId: 'C_7KIND',
    };

    // 1. Create proposal_excerpt (Kind 6) + conversation
    const currentCfg = await repo.getConfig(owner.person.id, owner.row.id);
    const decision: any = {
      kind: 'proposal',
      title: 'Bí mật nội bộ',
      rationale: 'Được nhắc trực tiếp',
      sourceIndices: [0],
      relevance: { kind: 'mention', sourceIndex: 0, evidence: '<@U_7KIND>' },
      intents: [{ action: 'task', service: 'trello', summary: text }],
    };
    const lease: any = {
      binding: owner.binding,
      config: currentCfg.config,
      configVersion: currentCfg.configVersion,
      triggers: [{ channelId: 'C_7KIND', messageTs: ts, threadTs: ts }],
    };
    const c = await env.db.pool.connect();
    let proposalId = '';
    try {
      await c.query('BEGIN');
      await artifacts.prepareProposalInTransaction(c, lease, decision, [
        { channelId: 'C_7KIND', ts, threadTs: ts, user: 'U_SRC', text, conversationType: 'public' },
      ]);
      proposalId = await artifacts.publishProposalInTransaction(
        c,
        lease,
        decision,
        [segment],
        [{ channelId: 'C_7KIND', ts, threadTs: ts, user: 'U_SRC', text, conversationType: 'public' }],
        false,
      );
      await c.query('COMMIT');
    } finally {
      c.release();
    }
    const proposalView = await artifacts.get(owner.person.id, proposalId, 'triage');
    const convId = proposalView.convId;

    // 2. Create chat_history_message (Kind 1) & working_memory_entity (Kind 2)
    await messages.createSlackMessage(
      convId,
      'assistant',
      text,
      { type: 'working_memory', state: { __gatherIntent: text } },
      { segments: [segment], selectors: ['content', 'state:/__gatherIntent'] },
    );

    // 3. Create plan_step_arg (Kind 3) & audit_log_entry (Kind 4)
    const planJson = {
      kind: 'plan',
      thinking: text,
      summary: text,
      warnings: [],
      steps: [{ id: 'step_1', tool: 'trello.create_card', description: 'Tạo thẻ', args: { listId: 'L1', title: text }, dependsOn: [] }],
    };
    const planText = JSON.stringify(planJson);
    const planHash = createHash('sha256').update(planText).digest('hex');
    const savedPlan = await plans.createSlackPlan(
      { convId, planJson, planText, planHash, expiresAt: new Date(Date.now() + 600000) },
      { segments: [segment] },
    );
    const createdStep = await steps.createStep({
      planId: savedPlan.id,
      stepId: 'step_1',
      tool: 'trello.create_card',
      argsJson: { listId: 'L1', title: text },
      requestedBy: owner.person.id,
    });
    await steps.updateStepStatus(createdStep.id, 'succeeded', { secretOut: text });

    // 4. Create scheduled_workflow_arg (Kind 5)
    const schedClient = await env.db.pool.connect();
    try {
      await schedClient.query('BEGIN');
      await lineage.prepareConversationWriteInTransaction(schedClient, convId, owner.person.id, [segment], 'planning');
      const schedRow = (
        await schedClient.query(
          `INSERT INTO schedules(user_id, conv_id, name, request, recurrence, services, status, next_run_at)
           VALUES($1, $2, $3, $4, $5, $6, 'active', clock_timestamp() + interval '1 hour')
           RETURNING id`,
          [
            owner.person.id,
            convId,
            text,
            text,
            JSON.stringify({ kind: 'daily', time: '09:00', timezone: 'Asia/Ho_Chi_Minh' }),
            ['trello'],
          ],
        )
      ).rows[0];
      await registerScheduleFields(schedClient, lineage, 'schedules', schedRow.id, owner.person.id, [segment], [
        'name',
        'request',
        'recurrence',
      ]);
      await schedClient.query('COMMIT');
    } finally {
      schedClient.release();
    }

    // 5. Create daily_digest_entry (Kind 7)
    const digestRun = await digests.runDueDigests(new Date('2026-11-02T02:10:00.000Z'));
    expect(digestRun.generated).toBeGreaterThanOrEqual(1);

    // Verify all 7 kinds have active copies before deletion
    const activeBefore = (
      await env.db.pool.query(
        "SELECT DISTINCT target_kind FROM slack_derived_copies WHERE ati_user_id=$1 AND status='active' ORDER BY target_kind",
        [owner.person.id],
      )
    ).rows.map((r) => r.target_kind);
    expect(activeBefore).toEqual([
      'audit_log_entry',
      'chat_history_message',
      'daily_digest_entry',
      'plan_step_arg',
      'proposal_excerpt',
      'scheduled_workflow_arg',
      'working_memory_entity',
    ]);

    // Stage deletion barrier and run invalidation runner (works even when runtime flags are off)
    await env.stageBarriers(
      [
        {
          effectKey: 'delete-7kind',
          barrier: {
            barrierType: 'resource',
            workspaceId: owner.binding.workspaceId,
            resourceType: 'message',
            resourceId: JSON.stringify(['C_7KIND', ts]),
            deleted: true,
            reason: 'source_deleted',
          },
          purgeTarget: {
            scope: 'resource_lifecycle',
            workspaceId: owner.binding.workspaceId,
            resourceType: 'message',
            resourceId: JSON.stringify(['C_7KIND', ts]),
            cascadeTargetKinds: [...SLACK_DERIVED_TARGET_KINDS],
            tombstoneReason: 'source_deleted',
          },
        },
      ],
      'evt-delete-7kind',
    );
    for (const targetKind of [
      'chat_history_message',
      'working_memory_entity',
      'plan_step_arg',
      'audit_log_entry',
      'scheduled_workflow_arg',
      'proposal_excerpt',
      'daily_digest_entry',
    ] as const) {
      await new SlackMessagePurgeConsumer(env.db.pool, { targetKind }).runOnce();
    }

    // Verify 0 active copies remain and all 7 kinds are physically erased in SQL
    const activeAfter = (
      await env.db.pool.query(
        "SELECT count(*)::int AS n FROM slack_derived_copies WHERE ati_user_id=$1 AND status='active'",
        [owner.person.id],
      )
    ).rows[0].n;
    expect(activeAfter).toBe(0);

    const unerased = (
      await env.db.pool.query(
        `SELECT c.target_kind, c.target_sub_id
           FROM slack_derived_copies c
           JOIN slack_derived_artifact_payloads p ON p.copy_id = c.id
          WHERE c.ati_user_id = $1
            AND NOT slack_artifact_erased(c.target_kind, c.target_sub_id, p.payload)`,
        [owner.person.id],
      )
    ).rows;
    expect(unerased).toEqual([]);

    // Both proposal and digest views return stale with null body
    expect(await artifacts.get(owner.person.id, proposalId, 'triage')).toMatchObject({ status: 'stale', body: null });
    const digestViews = await digests.list(owner.person.id, owner.row.id);
    expect(digestViews[0]).toMatchObject({ status: 'stale', body: null });
  }, 30000);
});
