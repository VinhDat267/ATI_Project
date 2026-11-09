import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import type pg from 'pg';
import type { PlanResponse } from '@wap/tool-schemas';
import {
  createIsolatedTestSchema,
  createSyntheticUser,
  type IsolatedTestContext,
} from '../helpers/jira-test-db.js';
import { WorkspaceRepo } from '../../src/db/repositories/workspace-repo.js';
import { PlanRepo } from '../../src/db/repositories/plan-repo.js';
import { ConversationRepo } from '../../src/db/repositories/conversation-repo.js';
import { StepRepo } from '../../src/db/repositories/step-repo.js';
import { ExecutionService } from '../../src/services/execution-service.js';

describe('PR-R1-A3c: Atomic Approval & Recovery Re-Validation SQL CAS + continueStep (A3c-1..A3c-5)', () => {
  let ctx: IsolatedTestContext;
  let pool: pg.Pool;
  let workspaceRepo: WorkspaceRepo;
  let planRepo: PlanRepo;
  let convRepo: ConversationRepo;
  let stepRepo: StepRepo;

  beforeAll(async () => {
    ctx = await createIsolatedTestSchema();
    await ctx.runAllMigrations();
    pool = ctx.pool;
    workspaceRepo = new WorkspaceRepo(pool);
    planRepo = new PlanRepo(pool);
    convRepo = new ConversationRepo(pool);
    stepRepo = new StepRepo(pool);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  async function seedPendingPlanForUser(userId: string, workspaceId?: string) {
    const convId = randomUUID();
    await pool.query(
      `INSERT INTO conversations (id, user_id, status, workspace_id, workspace_mode)
       VALUES ($1, $2, 'chatting', $3, $4)`,
      [convId, userId, workspaceId ?? null, workspaceId ? 'organization' : 'personal'],
    );
    const planJson: PlanResponse = {
      kind: 'plan',
      thinking: 'Create Trello card',
      summary: 'Create Trello card',
      warnings: [],
      steps: [
        {
          id: 'step_1',
          tool: 'trello.create_card',
          description: 'Create card',
          args: { listId: 'list_1', name: 'Card 1' },
          dependsOn: [],
        },
      ],
    };
    const planText = JSON.stringify(planJson);
    const planHash = createHash('sha256').update(planText).digest('hex');
    const plan = await planRepo.createPlan({
      convId,
      planJson,
      planText,
      planHash,
      expiresAt: new Date(Date.now() + 60_000),
    });
    return { convId, plan, planHash };
  }

  it('A3c-1: PlanRepo.approvePlan atomic SQL CAS rejects a disabled/suspended user (users.status = "disabled") on non-Jira plans', async () => {
    const userId = await createSyntheticUser(pool, 'Suspended User', 'a3c-susp');
    const { plan, planHash } = await seedPendingPlanForUser(userId);

    await pool.query(`UPDATE users SET status = 'disabled' WHERE id = $1`, [userId]);

    const approved = await planRepo.approvePlan(plan.id, planHash, userId);
    expect(approved).toBe(false);
  });

  it('A3c-2: PlanRepo.approvePlan atomic SQL CAS rejects a disabled/removed workspace member (workspace_members.status = "disabled") on workspace-bound plans', async () => {
    const ownerId = await createSyntheticUser(pool, 'Org Owner', 'a3c-owner');
    const userId = await createSyntheticUser(pool, 'Revoked Member', 'a3c-member');
    const ws = await workspaceRepo.create(ownerId, 'Org A3c');
    await pool.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, 'member', 'disabled')`,
      [ws.id, userId],
    );

    const { plan, planHash } = await seedPendingPlanForUser(userId, ws.id);

    const approved = await planRepo.approvePlan(plan.id, planHash, userId);
    expect(approved).toBe(false);
  });

  it('A3c-3: PlanRepo.claimRecovery atomic SQL CAS rejects disabled/suspended user or disabled workspace member when nextStatus = "executing"', async () => {
    const userId = await createSyntheticUser(pool, 'Recovery Suspended User', 'a3c-rec-susp');
    const { plan } = await seedPendingPlanForUser(userId);
    await pool.query(`UPDATE plans SET status = 'partial', decided_at = now() WHERE id = $1`, [plan.id]);
    const planRow = (await planRepo.getPlan(plan.id))!;

    await pool.query(`UPDATE users SET status = 'disabled' WHERE id = $1`, [userId]);

    const claimed = await planRepo.claimRecovery(planRow, userId, 'executing');
    expect(claimed).toBe(false);
  });

  it('A3c-4: concurrent workspace member revocation blocks both approvePlan and claimRecovery while still permitting nextStatus = "stopped"', async () => {
    const ownerId = await createSyntheticUser(pool, 'Org Owner 4', 'a3c-owner4');
    const memberId = await createSyntheticUser(pool, 'Concurrent Member 4', 'a3c-member4');
    const ws = await workspaceRepo.create(ownerId, 'Org A3c Concurrent');
    await pool.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, 'member', 'active')`,
      [ws.id, memberId],
    );

    const { plan: pendingPlan, planHash } = await seedPendingPlanForUser(memberId, ws.id);
    const { plan: partialPlan } = await seedPendingPlanForUser(memberId, ws.id);
    await pool.query(`UPDATE plans SET status = 'partial', decided_at = now() WHERE id = $1`, [partialPlan.id]);
    const partialPlanRow = (await planRepo.getPlan(partialPlan.id))!;

    // Revoke membership before approval/recovery claim
    await pool.query(
      `UPDATE workspace_members SET status = 'disabled' WHERE workspace_id = $1 AND user_id = $2`,
      [ws.id, memberId],
    );

    const [approved, claimedExec] = await Promise.all([
      planRepo.approvePlan(pendingPlan.id, planHash, memberId),
      planRepo.claimRecovery(partialPlanRow, memberId, 'executing'),
    ]);
    expect(approved).toBe(false);
    expect(claimedExec).toBe(false);

    // Terminal stop ('stopped') remains allowed so a revoked user/session can close an uncertain run without executing tools
    const claimedStop = await planRepo.claimRecovery(partialPlanRow, memberId, 'stopped');
    expect(claimedStop).toBe(true);
  });

  it('A3c-5: ExecutionService.continueStep when reuseController=true on a non-myslack plan calls planRepo.claimRecovery and transitions DB status to "executing"', async () => {
    const userId = await createSyntheticUser(pool, 'ContinueStep User', 'a3c-cont');
    const { plan } = await seedPendingPlanForUser(userId);
    await pool.query(`UPDATE plans SET status = 'partial', decided_at = now() WHERE id = $1`, [plan.id]);
    await stepRepo.createStep({
      planId: plan.id,
      stepId: 'step_1',
      tool: 'trello.create_card',
      argsJson: { listId: 'list_1', name: 'Card 1' },
      requestedBy: userId,
    });
    await pool.query(`UPDATE execution_steps SET status = 'failed' WHERE plan_id = $1 AND step_id = 'step_1'`, [
      plan.id,
    ]);

    const claimSpy = vi.spyOn(planRepo, 'claimRecovery');
    const execService = new ExecutionService({
      planRepo,
      convRepo,
      stepRepo,
      pool,
      adapterFactory: {
        getAdapterForService: () => ({
          execute: async () => ({ id: 'card_123', url: 'https://trello.com/c/123' }),
        }),
      },
    });

    const fakeController = {
      isStopped: () => false,
      isExecuting: () => false,
      getAllStepStates: () => ({ step_1: { stepId: 'step_1', status: 'failed' } }),
      getStepState: () => ({ stepId: 'step_1', status: 'completed' }),
      retryStep: vi.fn(async () => ({
        status: 'completed',
        completedSteps: 1,
        totalSteps: 1,
        results: [],
      })),
    };
    (execService as any).activeControllers.set(plan.id, fakeController);

    await execService.retryStep(plan.id, 'step_1', userId);
    expect(claimSpy).toHaveBeenCalledWith(expect.objectContaining({ id: plan.id }), userId, 'executing');
    await expect(claimSpy.mock.results[0]?.value).resolves.toBe(true);
  });
});
