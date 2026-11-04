import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import type pg from 'pg';
import { createIsolatedTestSchema, createSyntheticUser, type IsolatedTestContext } from '../helpers/jira-test-db.js';
import { PlanRepo } from '../../src/db/repositories/plan-repo.js';
import { ConversationRepo } from '../../src/db/repositories/conversation-repo.js';
import type { PlanResponse, ReportEvidence } from '@wap/tool-schemas';
import { validateReportEvidenceBinding } from '../../src/services/report-evidence-guard.js';

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
    status: 'pending' | 'approved' = 'pending'
  ) {
    const convId = randomUUID();
    await pool.query(
      "INSERT INTO conversations(id, user_id, status) VALUES($1, $2, 'chatting')",
      [convId, userId]
    );

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
});
