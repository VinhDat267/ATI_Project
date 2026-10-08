import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { UserRepo, hashPassword, verifyPassword } from '../../src/db/repositories/user-repo.js';
import { ConversationRepo } from '../../src/db/repositories/conversation-repo.js';
import { PlanRepo } from '../../src/db/repositories/plan-repo.js';
import { StepRepo } from '../../src/db/repositories/step-repo.js';

const PG_URL = process.env.DATABASE_URL || 'postgresql://ati_v3:ati_v3_local_only@127.0.0.1:55533/ati_v3';

describe('Real PostgreSQL Docker Container Integration (ati_v3)', () => {
  let pool: pg.Pool;
  let userRepo: UserRepo;
  let convRepo: ConversationRepo;
  let planRepo: PlanRepo;
  let stepRepo: StepRepo;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: PG_URL, max: 10 });
    // Verify connection
    const res = await pool.query('SELECT current_database() as db');
    expect(res.rows[0].db).toBe('ati_v3');

    userRepo = new UserRepo(pool);
    convRepo = new ConversationRepo(pool);
    planRepo = new PlanRepo(pool);
    stepRepo = new StepRepo(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('verifies UserRepo password hashing, PBKDF2 salt generation and verification', async () => {
    const testEmail = `docker_test_${Date.now()}@wap.local`;
    const password = 'StrongPassword!2026';
    const hash = hashPassword(password);

    const user = await userRepo.createUser({
      email: testEmail,
      name: 'Docker Integration Tester',
      password: password,
    });

    expect(user.id).toBeDefined();
    expect(user.email).toBe(testEmail);

    // Verify correct password
    const verifiedUser = await userRepo.findByEmail(testEmail);
    expect(verifiedUser).not.toBeNull();
    expect(verifyPassword(password, verifiedUser!.password)).toBe(true);

    // Verify wrong password fails
    expect(verifyPassword('WrongPassword', verifiedUser!.password)).toBe(false);
  });

  it('enforces conversation isolation between different users in PostgreSQL', async () => {
    // Create two users
    const u1 = await userRepo.createUser({
      email: `u1_${Date.now()}@wap.local`,
      name: 'User One',
      password: 'pass1',
    });
    const u2 = await userRepo.createUser({
      email: `u2_${Date.now()}@wap.local`,
      name: 'User Two',
      password: 'pass2',
    });

    // Each user creates conversations
    const conv1 = await convRepo.createConversation(u1.id);
    const conv2 = await convRepo.createConversation(u2.id);

    // List conversations for User 1
    const u1Convs = await convRepo.listConversations(u1.id);
    const u1ConvIds = u1Convs.map((c) => c.id);
    expect(u1ConvIds).toContain(conv1.id);
    expect(u1ConvIds).not.toContain(conv2.id);

    // List conversations for User 2
    const u2Convs = await convRepo.listConversations(u2.id);
    const u2ConvIds = u2Convs.map((c) => c.id);
    expect(u2ConvIds).toContain(conv2.id);
    expect(u2ConvIds).not.toContain(conv1.id);
  });

  it('automatically supersedes older pending plans when a new plan is proposed', async () => {
    const user = await userRepo.createUser({
      email: `supersede_${Date.now()}@wap.local`,
      name: 'Supersede Test User',
      password: 'pass',
    });
    const conv = await convRepo.createConversation(user.id);

    // Create plan 1
    const p1 = await planRepo.createPlan({
      convId: conv.id,
      planJson: { steps: [{ id: 's1', tool: 'trello.create_card' }] },
      planHash: 'hash-v1',
      expiresAt: new Date(Date.now() + 60000),
    });
    expect(p1.status).toBe('pending');

    // Create plan 2 in the same conversation
    const p2 = await planRepo.createPlan({
      convId: conv.id,
      planJson: { steps: [{ id: 's2', tool: 'trello.update_card' }] },
      planHash: 'hash-v2',
      expiresAt: new Date(Date.now() + 60000),
    });
    expect(p2.status).toBe('pending');

    // Check plan 1 in DB - should be superseded
    const refreshedP1 = await planRepo.getPlan(p1.id);
    expect(refreshedP1?.status).toBe('superseded');

    // Check getPendingPlan - only returns P2
    const pending = await planRepo.getPendingPlan(conv.id);
    expect(pending?.id).toBe(p2.id);
  });

  it('prevents double-approval under real PostgreSQL concurrency using optimistic lock', async () => {
    const user = await userRepo.createUser({
      email: `concurrency_${Date.now()}@wap.local`,
      name: 'Concurrency Tester',
      password: 'pass',
    });
    const conv = await convRepo.createConversation(user.id);

    const plan = await planRepo.createPlan({
      convId: conv.id,
      planJson: { steps: [{ id: 's1', tool: 'slack.send_message' }] },
      planHash: 'hash-race-1',
      expiresAt: new Date(Date.now() + 60000),
    });

    // Fire 5 concurrent approval attempts simultaneously
    const results = await Promise.all([
      planRepo.approvePlan(plan.id, plan.plan_hash, user.id),
      planRepo.approvePlan(plan.id, plan.plan_hash, user.id),
      planRepo.approvePlan(plan.id, plan.plan_hash, user.id),
      planRepo.approvePlan(plan.id, plan.plan_hash, user.id),
      planRepo.approvePlan(plan.id, plan.plan_hash, user.id),
    ]);

    // Exactly one must return true, the rest false
    const successCount = results.filter((r) => r === true).length;
    const failureCount = results.filter((r) => r === false).length;
    expect(successCount).toBe(1);
    expect(failureCount).toBe(4);

    const approvedPlan = await planRepo.getPlan(plan.id);
    expect(approvedPlan?.status).toBe('approved');
    expect(approvedPlan?.decided_at).not.toBeNull();
  });

  it('rejects approval of expired plans directly in SQL condition', async () => {
    const user = await userRepo.createUser({
      email: `expired_${Date.now()}@wap.local`,
      name: 'Expiry Tester',
      password: 'pass',
    });
    const conv = await convRepo.createConversation(user.id);

    // Create a plan that already expired 10 seconds ago
    const expiredPlan = await planRepo.createPlan({
      convId: conv.id,
      planJson: { steps: [{ id: 's1', tool: 'trello.create_card' }] },
      planHash: 'hash-expired',
      expiresAt: new Date(Date.now() - 10000),
    });

    // Attempt to approve
    const approved = await planRepo.approvePlan(expiredPlan.id, expiredPlan.plan_hash, user.id);
    expect(approved).toBe(false);

    // Verify plan remains pending (not approved)
    const check = await planRepo.getPlan(expiredPlan.id);
    expect(check?.status).toBe('pending');
  });

  it('persists execution steps and updates plan status to completed in PostgreSQL', async () => {
    const user = await userRepo.createUser({
      email: `exec_${Date.now()}@wap.local`,
      name: 'Exec Tester',
      password: 'pass',
    });
    const conv = await convRepo.createConversation(user.id);

    const plan = await planRepo.createPlan({
      convId: conv.id,
      planJson: { steps: [{ id: 's1', tool: 'trello.create_card' }] },
      planHash: 'hash-exec',
      expiresAt: new Date(Date.now() + 60000),
    });

    await planRepo.approvePlan(plan.id, plan.plan_hash, user.id);

    // Create execution step
    const stepRow = await stepRepo.createStep({
      planId: plan.id,
      stepId: 's1',
      tool: 'trello.create_card',
    });
    expect(stepRow.id).toBeDefined();
    expect(stepRow.status).toBe('pending');

    // Update step status to succeeded
    const updatedStep = await stepRepo.updateStepStatus(
      stepRow.id,
      'succeeded',
      { cardId: 'c_test_123', url: 'https://trello.com/c/c_test_123' }
    );
    expect(updatedStep.status).toBe('succeeded');
    expect(updatedStep.output_json.cardId).toBe('c_test_123');

    // Update plan status to completed
    await planRepo.updatePlanStatus(plan.id, 'completed');
    const finalPlan = await planRepo.getPlan(plan.id);
    expect(finalPlan?.status).toBe('completed');
  });

  it("records when each step started and finished and how long it ran", async () => {
    const user = await userRepo.createUser({ email: `timing_${Date.now()}@wap.local`, name: "Timing Tester", password: "pass" });
    const conv = await convRepo.createConversation(user.id);
    const plan = await planRepo.createPlan({
      convId: conv.id, planJson: { steps: [] }, planHash: "hash-timing", expiresAt: new Date(Date.now() + 60000),
    });
    const step = await stepRepo.createStep({ planId: plan.id, stepId: "s1", tool: "trello.create_card" });
    const skipped = await stepRepo.createStep({ planId: plan.id, stepId: "s2", tool: "slack.send_message" });

    const running = await stepRepo.updateStepStatus(step.id, "running");
    expect(running.started_at).toBeInstanceOf(Date);
    expect(running.completed_at).toBeNull();
    await new Promise((done) => setTimeout(done, 60));
    const failed = await stepRepo.updateStepStatus(step.id, "failed", undefined, { message: "boom" });
    expect(failed.completed_at).toBeInstanceOf(Date);
    expect(failed.duration_ms).toBeGreaterThanOrEqual(50);

    // A retry runs the step again: the earlier finish time and duration no longer describe it.
    const retried = await stepRepo.updateStepStatus(step.id, "running");
    expect(retried.completed_at).toBeNull();
    expect(retried.duration_ms).toBeNull();
    expect(retried.started_at!.getTime()).toBeGreaterThanOrEqual(failed.completed_at!.getTime());
    const done = await stepRepo.updateStepStatus(step.id, "succeeded", { id: "card_1" });
    expect(done.duration_ms).toBeGreaterThanOrEqual(0);
    expect(done.duration_ms).toBeLessThan(failed.duration_ms!);

    const never = await stepRepo.updateStepStatus(skipped.id, "skipped");
    expect(never.started_at).toBeNull();
    expect(never.duration_ms).toBeNull();
    expect(never.completed_at).toBeInstanceOf(Date);
  });
});
