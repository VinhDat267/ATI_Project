import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import type pg from 'pg';
import { createIsolatedTestSchema, createSyntheticUser, type IsolatedTestContext } from '../helpers/jira-test-db.js';
import { PlanRepo } from '../../src/db/repositories/plan-repo.js';
import { ConversationRepo } from '../../src/db/repositories/conversation-repo.js';
import type { PlanResponse, ReportEvidence } from '@wap/tool-schemas';
import { ReportArtifactStore } from '@wap/planner';
import { validateReportEvidenceBinding } from '../../src/services/report-evidence-guard.js';
import { ExecutionService } from '../../src/services/execution-service.js';
import { MessageRepo } from '../../src/db/repositories/message-repo.js';

describe('Report Evidence Integration & Dispatch Guard (FLOW-01, F1)', () => {
  let ctx: IsolatedTestContext;
  let pool: pg.Pool;
  let planRepo: PlanRepo;
  let convRepo: ConversationRepo;

  beforeAll(async () => {
    ctx = await createIsolatedTestSchema();
    await ctx.runAllMigrations();
    pool = ctx.pool;
    planRepo = new PlanRepo(pool);
    convRepo = new ConversationRepo(pool);
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 100));
    await ctx.cleanup();
  });

  async function createTestPlan(
    userId: string,
    planJson: PlanResponse,
    status: 'pending' | 'approved' = 'pending',
    request?: string,
  ) {
    const convId = randomUUID();
    await pool.query(
      "INSERT INTO conversations(id, user_id, status) VALUES($1, $2, 'chatting')",
      [convId, userId]
    );

    if (request) await new MessageRepo(pool).createMessage(convId, 'user', request);
    const planText = JSON.stringify(planJson);
    const planHash = createHash('sha256').update(planText).digest('hex');
    const plan = await planRepo.createPlan({
      convId,
      planJson,
      planText,
      planHash,
      expiresAt: new Date(Date.now() + 60000),
    });

    if (status === 'approved') {
      await pool.query("UPDATE plans SET status = 'approved' WHERE id = $1", [plan.id]);
    }

    return { convId, planId: plan.id, planHash, planText };
  }

  it.each([
    'Cho tôi danh sách PR đang mở trên GitHub acme/web rồi nhắn kết quả vào Slack #dev',
    'Summarize open pull requests on GitHub acme/web and send the report to Slack #dev',
  ])('uses the persisted user request before approval, not model summary: %s', async (request) => {
    const userId = await createSyntheticUser(pool, 'Natural report', 'natural');
    const plan: PlanResponse = { kind: 'plan', summary: 'Gửi cập nhật PR', thinking: 'Notify dev', warnings: [], steps: [
      { id: 'post', tool: 'slack.send_message', description: 'Notify', args: { channel: 'C_DEV', text: '999 open PRs: #999' }, dependsOn: [] },
    ] };
    const saved = await createTestPlan(userId, plan, 'pending', request);
    // A later request cannot retroactively change the request bound to this preview.
    await new MessageRepo(pool).createMessage(saved.convId, 'user', 'Gửi Slack nguyên văn "Chào team"');
    const service = new ExecutionService({ planRepo, convRepo, pool, enforceReportGrounding: true,
      adapterFactory: { getAdapterForService: () => ({ execute: async () => ({ ok: true }) }) } });
    const result = await service.approveAndStart(saved.planId, userId);
    expect(result).toMatchObject({ success: false, status: 409 });
    expect((await pool.query('SELECT status FROM plans WHERE id=$1', [saved.planId])).rows[0].status).toBe('pending');
  });

  it('rejects an earlier unverified report even if the final destination has valid evidence', async () => {
    const userId = await createSyntheticUser(pool, 'Multiple destinations', 'multi');
    const store = new ReportArtifactStore();
    const art = store.createArtifact({ kind: 'github_prs', sourceTool: 'github.list_pull_requests', sourceLabel: 'acme/web', items: [{ number: 41 }], renderedText: '1 PR: #41', actor: { userId } });
    const plan: PlanResponse = { kind: 'plan', thinking: 'Báo cáo PR', summary: 'Báo cáo PR', warnings: [], steps: [
      { id: 'first', tool: 'slack.send_message', description: 'First', args: { channel: 'C_DEV', text: '999 PRs: #999' }, dependsOn: [] },
      { id: 'last', tool: 'slack.send_message', description: 'Last', args: { channel: 'C_OPS', text: art.renderedText }, dependsOn: [] },
    ], reportEvidence: { artifactId: art.id, kind: art.kind, stepId: 'last', argument: 'text', sourceTool: art.sourceTool, sourceLabel: art.sourceLabel, readAt: art.createdAt, itemCount: 1, coverage: 'complete', contentHash: art.contentHash } };
    const saved = await createTestPlan(userId, plan);
    const service = new ExecutionService({ planRepo, convRepo, pool, enforceReportGrounding: true, reportEvidenceStore: store,
      adapterFactory: { getAdapterForService: () => ({ execute: async () => ({ ok: true }) }) } });
    expect(await service.approveAndStart(saved.planId, userId)).toMatchObject({ success: false, status: 409 });
    expect((await pool.query('SELECT status FROM plans WHERE id=$1', [saved.planId])).rows[0].status).toBe('pending');
  });

  it('keeps request timestamps at PostgreSQL precision when binding approval', async () => {
    const userId = await createSyntheticUser(pool, 'Precise report', 'precise');
    const plan: PlanResponse = { kind: 'plan', summary: 'Notify dev', thinking: 'Send update', warnings: [], steps: [
      { id: 'post', tool: 'slack.send_message', description: 'Notify', args: { channel: 'C_DEV', text: '999 PRs: #999' }, dependsOn: [] },
    ] };
    const saved = await createTestPlan(userId, plan, 'pending', 'Cho tôi danh sách PR đang mở rồi gửi Slack');
    await pool.query("UPDATE messages SET created_at='2026-11-04 10:00:00.000200+00' WHERE conv_id=$1", [saved.convId]);
    await pool.query("UPDATE plans SET created_at='2026-11-04 10:00:00.000800+00' WHERE id=$1", [saved.planId]);
    const service = new ExecutionService({ planRepo, convRepo, pool, enforceReportGrounding: true,
      adapterFactory: { getAdapterForService: () => ({ execute: async () => ({ ok: true }) }) } });
    expect(await service.approveAndStart(saved.planId, userId)).toMatchObject({ success: false, status: 409 });
  });

  it('uses the exact correlated request when another turn arrives before preview persistence', async () => {
    const userId = await createSyntheticUser(pool, 'Overlapping report', 'overlap');
    const plan: PlanResponse = { kind: 'plan', summary: 'Notify dev', thinking: 'Send update', warnings: [], steps: [
      { id: 'post', tool: 'slack.send_message', description: 'Notify', args: { channel: 'C_DEV', text: '999 PRs: #999' }, dependsOn: [] },
    ] };
    const saved = await createTestPlan(userId, plan, 'pending', 'Cho tôi danh sách PR đang mở rồi gửi Slack');
    const original = (await pool.query("SELECT id FROM messages WHERE conv_id=$1 AND role='user'", [saved.convId])).rows[0].id;
    const messages = new MessageRepo(pool);
    const other = await messages.createMessage(saved.convId, 'user', 'Gửi Slack nguyên văn "Chào team"');
    await pool.query("UPDATE messages SET created_at=(SELECT created_at FROM plans WHERE id=$1)-interval '1 microsecond' WHERE id=$2", [saved.planId, other.id]);
    await messages.createMessage(saved.convId, 'assistant', 'Kế hoạch', { type: 'plan', planId: saved.planId, replyToMessageId: original });
    const service = new ExecutionService({ planRepo, convRepo, pool, enforceReportGrounding: true,
      adapterFactory: { getAdapterForService: () => ({ execute: async () => ({ ok: true }) }) } });
    expect(await service.approveAndStart(saved.planId, userId)).toMatchObject({ success: false, status: 409 });
  });

  it('does not inherit an earlier completed report when approving a new ordinary notification', async () => {
    const userId = await createSyntheticUser(pool, 'New notification', 'newnotice');
    const convId = randomUUID();
    await pool.query("INSERT INTO conversations(id,user_id,status) VALUES($1,$2,'chatting')", [convId,userId]);
    const messages = new MessageRepo(pool);
    await messages.createMessage(convId, 'user', 'Báo cáo PR đang mở trên GitHub vào Slack');
    await messages.createMessage(convId, 'assistant', 'Đã gửi báo cáo PR', { type: 'answer' });
    const original = await messages.createMessage(convId, 'user', 'Gửi tin nhắn chào team trên Slack');
    const plan: PlanResponse = { kind: 'plan', summary: 'Chào team', thinking: 'Send notice', warnings: [], steps: [
      { id: 'post', tool: 'slack.send_message', description: 'Notify', args: { channel: 'C_DEV', text: 'Chào team' }, dependsOn: [] },
    ] };
    const text = JSON.stringify(plan);
    const saved = await planRepo.createPlan({ convId, planJson: plan, planText: text, planHash: createHash('sha256').update(text).digest('hex'), expiresAt: new Date(Date.now()+60000) });
    await messages.createMessage(convId, 'assistant', 'Kế hoạch', { type: 'plan', planId: saved.id, replyToMessageId: original.id });
    const service = new ExecutionService({ planRepo, convRepo, pool, enforceReportGrounding: true,
      adapterFactory: { getAdapterForService: () => ({ execute: async () => ({ ok: true }) }) } });
    expect(await service.approveAndStart(saved.id, userId)).toMatchObject({ success: true, status: 200 });
  });

  it('rejects self-declared or fabricated client evidence without server observation', async () => {
    const userId = await createSyntheticUser(pool, 'User Evidence 1', 'ev1');
    const text = 'Báo cáo 3 PR: #128, #131, #134';
    const fakeEvidence: ReportEvidence = {
      artifactId: 'art_fake_123',
      kind: 'github_prs',
      stepId: 'step_post',
      argument: 'text',
      sourceTool: 'github.list_pull_requests',
      sourceLabel: 'acme/web',
      readAt: new Date().toISOString(),
      itemCount: 3,
      coverage: 'complete',
      contentHash: createHash('sha256').update(text).digest('hex'),
    };

    const plan: PlanResponse = {
      kind: 'plan',
      thinking: 'Báo cáo PR',
      summary: 'Gửi PR',
      warnings: [],
      steps: [
        {
          id: 'step_post',
          tool: 'slack.chat_postMessage',
          description: 'Gửi tin nhắn',
          args: { channel: 'C_DEV', text },
          dependsOn: [],
        },
      ],
      reportEvidence: fakeEvidence,
    };

    // Validation must fail when checking against real observations because art_fake_123 does not exist
    const check = await validateReportEvidenceBinding(plan, {
      userId,
      workspaceId: 'ws_test',
    });

    expect(check.valid).toBe(false);
    expect(check.error).toMatch(/unverified|observation not found|invalid artifact/i);
  });

  it('rejects evidence when bound to a different actor or workspace', async () => {
    const userA = await createSyntheticUser(pool, 'User Evidence A', 'evA');
    const userB = await createSyntheticUser(pool, 'User Evidence B', 'evB');

    // Simulate an observation created for userA
    const evidenceForA: ReportEvidence = {
      artifactId: `art_${randomUUID()}`,
      kind: 'github_prs',
      stepId: 'step_post',
      argument: 'text',
      sourceTool: 'github.list_pull_requests',
      sourceLabel: 'acme/web',
      readAt: new Date().toISOString(),
      itemCount: 1,
      coverage: 'complete',
      contentHash: createHash('sha256').update('PR #42').digest('hex'),
    };

    const planForB: PlanResponse = {
      kind: 'plan',
      thinking: 'Plan for B',
      summary: 'Gửi PR',
      warnings: [],
      steps: [
        {
          id: 'step_post',
          tool: 'slack.chat_postMessage',
          description: 'Post',
          args: { channel: 'C_DEV', text: 'PR #42' },
          dependsOn: [],
        },
      ],
      reportEvidence: evidenceForA,
    };

    // User B tries to use evidence created by User A
    const check = await validateReportEvidenceBinding(planForB, {
      userId: userB,
      workspaceId: 'ws_b',
      observedArtifact: {
        id: evidenceForA.artifactId,
        ownerUserId: userA,
        workspaceId: 'ws_a',
        contentHash: evidenceForA.contentHash,
      },
    });

    expect(check.valid).toBe(false);
    expect(check.error).toMatch(/ownership mismatch|unauthorized artifact|workspace mismatch/i);
  });

  it('blocks dispatch when plan content is tampered after canonical planHash was computed', async () => {
    const userId = await createSyntheticUser(pool, 'User Tamper', 'tamper');
    const validEvidence: ReportEvidence = {
      artifactId: `art_${randomUUID()}`,
      kind: 'github_prs',
      stepId: 'step_post',
      argument: 'text',
      sourceTool: 'github.list_pull_requests',
      sourceLabel: 'acme/web',
      readAt: new Date().toISOString(),
      itemCount: 1,
      coverage: 'complete',
      contentHash: createHash('sha256').update('Original verified text').digest('hex'),
    };

    const plan: PlanResponse = {
      kind: 'plan',
      thinking: 'Report',
      summary: 'Gửi PR',
      warnings: [],
      steps: [
        {
          id: 'step_post',
          tool: 'slack.chat_postMessage',
          description: 'Post',
          args: { channel: 'C_DEV', text: 'Original verified text' },
          dependsOn: [],
        },
      ],
      reportEvidence: validEvidence,
    };

    const created = await createTestPlan(userId, plan, 'approved');

    // Simulate tampering: malicious update in DB
    const tamperedPlan: PlanResponse = {
      ...plan,
      steps: [
        {
          id: plan.steps[0]!.id,
          tool: plan.steps[0]!.tool,
          description: plan.steps[0]!.description,
          dependsOn: plan.steps[0]!.dependsOn,
          args: { channel: 'C_DEV', text: 'Tampered unverified text: #999' },
        },
      ],
    };
    await pool.query('UPDATE plans SET plan_json = $2 WHERE id = $1', [
      created.planId,
      JSON.stringify(tamperedPlan),
    ]);

    // Validation before dispatch must catch the hash & content mismatch
    const check = await validateReportEvidenceBinding(tamperedPlan, {
      userId,
      workspaceId: 'ws_tamper',
      expectedPlanHash: created.planHash,
      observedArtifact: {
        id: validEvidence.artifactId,
        ownerUserId: userId,
        workspaceId: 'ws_tamper',
        contentHash: validEvidence.contentHash,
      },
    });

    expect(check.valid).toBe(false);
    expect(check.error).toMatch(/hash mismatch|content altered|tampered/i);
  });

  it('rejects approval of legacy report plans lacking reportEvidence binding', async () => {
    const userId = await createSyntheticUser(pool, 'User Legacy', 'legacy');
    const legacyReportPlan: PlanResponse = {
      kind: 'plan',
      thinking: 'Legacy report plan',
      summary: 'Gửi báo cáo PR cũ',
      warnings: [],
      steps: [
        {
          id: 'step_post',
          tool: 'slack.chat_postMessage',
          description: 'Báo cáo PR',
          args: { channel: 'C_DEV', text: 'Báo cáo cũ có PR #128, #131 không rõ nguồn' },
          dependsOn: [],
        },
      ],
    };

    const check = await validateReportEvidenceBinding(legacyReportPlan, {
      userId,
      workspaceId: 'ws_legacy',
      enforceReportGrounding: true,
    });

    expect(check.valid).toBe(false);
    expect(check.error).toMatch(/missing report evidence|unverified report plan/i);
  });

  it('ExecutionService.approveAndStart blocks unverified report plans and allows verified report plans with ReportArtifactStore', async () => {
    const userId = await createSyntheticUser(pool, 'User Exec Guard', 'execguard');
    const reportEvidenceStore = new ReportArtifactStore();

    const execService = new ExecutionService({
      planRepo,
      convRepo,
      pool,
      adapterFactory: {
        getAdapterForService: () => ({
          execute: async () => ({ status: 'success', data: { ok: true } }),
        }),
      },
      reportEvidenceStore,
      enforceReportGrounding: true,
    });

    const unverifiedPlan: PlanResponse = {
      kind: 'plan',
      thinking: 'Gửi báo cáo PR',
      summary: 'Gửi báo cáo PR',
      warnings: [],
      steps: [
        {
          id: 'step_post',
          tool: 'slack.chat_postMessage',
          description: 'Gửi báo cáo PR',
          args: { channel: 'C_DEV', text: 'Báo cáo PR #128 tự bịa không có nguồn' },
          dependsOn: [],
        },
      ],
    };

    const createdUnverified = await createTestPlan(userId, unverifiedPlan, 'pending');
    const blockedRes = await execService.approveAndStart(createdUnverified.planId, userId);
    expect(blockedRes.success).toBe(false);
    expect(blockedRes.status).toBe(409);
    expect(blockedRes.error).toMatch(/missing report evidence|unverified report plan/i);

    const verifiedText = '📊 **Báo cáo Pull Requests — acme/web**\nTổng số: 1 PR (#128)';
    const artifact = reportEvidenceStore.createArtifact({
      kind: 'github_prs',
      sourceTool: 'github.list_pull_requests',
      sourceLabel: 'acme/web',
      items: [{ number: 128, title: 'Fix oauth' }],
      renderedText: verifiedText,
      actor: { userId, workspaceId: null },
    });

    const verifiedPlan: PlanResponse = {
      kind: 'plan',
      thinking: 'Gửi báo cáo PR đã kiểm chứng',
      summary: 'Gửi báo cáo PR',
      warnings: [],
      steps: [
        {
          id: 'step_post',
          tool: 'slack.chat_postMessage',
          description: 'Gửi báo cáo PR',
          args: { channel: 'C_DEV', text: verifiedText },
          dependsOn: [],
        },
      ],
      reportEvidence: {
        artifactId: artifact.id,
        kind: artifact.kind,
        stepId: 'step_post',
        argument: 'text',
        sourceTool: artifact.sourceTool,
        sourceLabel: artifact.sourceLabel,
        readAt: artifact.createdAt,
        itemCount: 1,
        coverage: 'complete',
        contentHash: artifact.contentHash,
      },
    };

    const createdVerified = await createTestPlan(userId, verifiedPlan, 'pending');
    const allowedRes = await execService.approveAndStart(createdVerified.planId, userId);
    expect(allowedRes.success).toBe(true);
    expect(allowedRes.status).toBe(200);
  });
});
