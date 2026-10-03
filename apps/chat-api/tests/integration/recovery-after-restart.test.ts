import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import request from 'supertest';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PlanStep } from '@wap/tool-schemas';
import { UserRepo } from '../../src/db/repositories/user-repo.js';
import { ConversationRepo } from '../../src/db/repositories/conversation-repo.js';
import { PlanRepo } from '../../src/db/repositories/plan-repo.js';
import { StepRepo } from '../../src/db/repositories/step-repo.js';
import { ExecutionService } from '../../src/services/execution-service.js';
import { reconcileInterruptedExecutions } from '../../src/services/startup-reconciliation.js';
import { createApp } from '../../src/app.js';
import { generateTokens } from '../../src/auth/jwt.js';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const databaseUrl = process.env.DATABASE_URL || 'postgresql://wap:wap@127.0.0.1:55532/ati_v3';
const schema = `w2_recovery_${randomUUID().replaceAll('-', '')}`;
const scopedUrl = new URL(databaseUrl);
scopedUrl.searchParams.set('options', `-c search_path=${schema}`);
scopedUrl.searchParams.set('application_name', schema);
const secret = 'recovery-http-test-secret-at-least-32-bytes';
const children = new Set<ChildProcess>();
const steps: PlanStep[] = [
  { id: 'step_1', tool: 'trello.create_card', description: 'Preserved card', args: { listId: 'fixture-list', title: 'Fixture' }, dependsOn: [] },
  { id: 'step_2', tool: 'slack.send_message', description: 'Paused notification', args: { channel: 'fixture-channel', text: 'Before crash' }, dependsOn: ['step_1'] },
  { id: 'step_3', tool: 'slack.send_message', description: 'Continue after recovery', args: {
    channel: 'fixture-channel', text: { $template: 'Card ${step_1.output.id}' },
  }, dependsOn: ['step_1', 'step_2'] },
];

async function stopProcess(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  await exited;
}

async function waitUntil(check: () => Promise<boolean>, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for real recovery SQL locks');
}

describe('recovering a stopped executor with real PostgreSQL and HTTP', () => {
  let adminPool: pg.Pool;
  let pool: pg.Pool;
  let planRepo: PlanRepo;
  let stepRepo: StepRepo;
  let convRepo: ConversationRepo;
  let ownerId: string;
  let ownerToken: string;
  let otherToken: string;

  beforeAll(async () => {
    adminPool = new pg.Pool({ connectionString: databaseUrl });
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    pool = new pg.Pool({ connectionString: scopedUrl.href });
    for (const migration of ['0001_v3_core.sql', '0002_v3_invariants.sql', '0003_conversation_visibility.sql']) {
      await pool.query(await readFile(resolve(root, 'db/v3', migration), 'utf8'));
    }
    planRepo = new PlanRepo(pool); stepRepo = new StepRepo(pool); convRepo = new ConversationRepo(pool);
    const users = new UserRepo(pool);
    const owner = await users.createUser({ email: 'owner@recovery.test', name: 'Owner', password: 'Fixture-password' });
    const other = await users.createUser({ email: 'other@recovery.test', name: 'Other', password: 'Fixture-password' });
    ownerId = owner.id;
    ownerToken = generateTokens(owner, secret).accessToken;
    otherToken = generateTokens(other, secret).accessToken;
  });

  afterEach(async () => { await Promise.all([...children].map(stopProcess)); children.clear(); });
  afterAll(async () => {
    await pool?.end();
    await adminPool?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await adminPool?.end();
  });

  async function fixture(status: string, states: string[], planSteps = steps) {
    const conv = await convRepo.createConversation(ownerId);
    const planJson = { kind: 'plan', steps: planSteps, warnings: [] };
    const text = JSON.stringify(planJson);
    const plan = await planRepo.createPlan({ convId: conv.id, planJson, planText: text,
      planHash: createHash('sha256').update(text).digest('hex'), expiresAt: new Date(Date.now() + 60_000) });
    if (status !== 'pending') {
      expect(await planRepo.approvePlan(plan.id, plan.plan_hash, ownerId)).toBe(true);
      await planRepo.updatePlanStatus(plan.id, status);
    }
    for (const [index, state] of states.entries()) {
      const step = planSteps[index]!;
      const row = await stepRepo.createStep({ planId: plan.id, stepId: step.id, tool: step.tool, argsJson: step.args, requestedBy: ownerId });
      if (state !== 'pending') await stepRepo.updateStepStatus(row.id, state,
        state === 'succeeded' ? { id: 'preserved-card', name: 'Saved' } : undefined,
        ['failed', 'unknown'].includes(state) ? { category: state === 'unknown' ? 'UNKNOWN' : 'NOT_FOUND', message: 'Saved error' } : undefined);
    }
    return plan;
  }

  function freshService(execute?: (tool: string, args: any, signal?: AbortSignal) => Promise<any>) {
    const calls: { tool: string; args: any }[] = [];
    const events: { event: string; data: any }[] = [];
    const service = new ExecutionService({ planRepo, stepRepo, convRepo,
      adapterFactory: { getAdapterForService: () => ({ execute: async (tool: string, args: any, options?: { signal?: AbortSignal }) => {
        calls.push({ tool, args });
        return execute ? execute(tool, args, options?.signal) : { ok: true };
      } }) },
      sseManager: { emitEvent: (_convId, event, data) => { events.push({ event, data }); } },
    });
    const app = createApp({ jwtSecret: secret, executionService: service });
    const post = (planId: string, suffix: string, token = ownerToken) => request(app)
      .post(`/api/executions/${planId}/${suffix}`).set('Authorization', `Bearer ${token}`);
    return { service, app, calls, events, post };
  }

  async function latest(recovered: ReturnType<typeof freshService>, convId: string) {
    return request(recovered.app).get(`/api/conversations/${convId}/executions/latest`).set('Authorization', `Bearer ${ownerToken}`);
  }

  it.each(['approved', 'executing', 'stopping', 'unknown'])('completes fully persisted success after restart from %s without dispatch', async status => {
    const plan = await fixture(status, ['succeeded', 'succeeded', 'succeeded']);
    const before = await stepRepo.listSteps(plan.id);
    await reconcileInterruptedExecutions(pool);
    await reconcileInterruptedExecutions(pool);
    const recovered = freshService();
    expect((await planRepo.getPlan(plan.id))!.status).toBe('completed');
    expect((await latest(recovered, plan.conv_id)).body.recoveryActions).toEqual([]);
    expect(await stepRepo.listSteps(plan.id)).toEqual(before);
    expect(recovered.calls).toEqual([]);
  });

  it('completes mixed success/skipped, but never incomplete or duplicate success snapshots', async () => {
    const complete = await fixture('approved', ['succeeded', 'skipped', 'succeeded']);
    const missing = await fixture('approved', ['succeeded', 'succeeded']);
    const duplicate = await fixture('approved', ['succeeded', 'succeeded']);
    await stepRepo.createStep({ planId: duplicate.id, stepId: 'step_1', tool: steps[0]!.tool, requestedBy: ownerId });
    await pool.query("UPDATE execution_steps SET status = 'succeeded' WHERE plan_id = $1", [duplicate.id]);
    await reconcileInterruptedExecutions(pool);
    expect((await planRepo.getPlan(complete.id))!.status).toBe('completed');
    expect((await planRepo.getPlan(missing.id))!.status).toBe('reconciliation_required');
    expect((await planRepo.getPlan(duplicate.id))!.status).toBe('reconciliation_required');
  });

  it('offers Continue after restart and dispatches only pending with saved refs exactly once', async () => {
    const refSteps = structuredClone(steps);
    refSteps[2]!.args.channel = { $ref: 'step_1.output.id' };
    const plan = await fixture('approved', ['succeeded', 'pending', 'pending'], refSteps);
    const saved = (await stepRepo.listSteps(plan.id))[0];
    await reconcileInterruptedExecutions(pool);
    const recovered = freshService();
    expect((await latest(recovered, plan.conv_id)).body.recoveryActions).toEqual(['continue', 'stop']);
    const response = await recovered.post(plan.id, 'continue');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('completed');
    expect(recovered.calls).toEqual([
      { tool: 'slack.send_message', args: { channel: 'fixture-channel', text: 'Before crash' } },
      { tool: 'slack.send_message', args: { channel: 'preserved-card', text: 'Card preserved-card' } },
    ]);
    expect((await stepRepo.listSteps(plan.id))[0]).toEqual(saved);
    expect((await planRepo.getPlan(plan.id))!.status).toBe('completed');
    expect((await recovered.post(plan.id, 'continue')).status).toBe(409);
    expect(recovered.calls).toHaveLength(2);
  });

  it.each([
    { status: 'reconciliation_required', states: ['succeeded', 'unknown', 'pending'] },
    { status: 'reconciliation_required', states: ['succeeded', 'failed', 'pending'] },
    { status: 'reconciliation_required', states: ['succeeded', 'running', 'pending'] },
    { status: 'reconciliation_required', states: [] },
    { status: 'reconciliation_required', states: ['succeeded', 'pending'] },
    { status: 'reconciliation_required', states: ['succeeded', 'skipped', 'succeeded'] },
    { status: 'partial', states: ['succeeded', 'pending', 'pending'] },
    { status: 'approved', states: ['succeeded', 'pending', 'pending'] },
  ])('rejects unsafe Continue $status / $states before dispatch', async ({ status, states }) => {
    const plan = await fixture(status, states);
    const before = await stepRepo.listSteps(plan.id);
    const recovered = freshService();
    expect((await recovered.post(plan.id, 'continue')).status).toBe(409);
    expect(await stepRepo.listSteps(plan.id)).toEqual(before);
    expect(recovered.calls).toEqual([]);
    expect((await planRepo.getPlan(plan.id))!.status).toBe(status);
    expect((await latest(recovered, plan.conv_id)).body.recoveryActions).not.toContain('continue');
  });

  it('rejects Continue for duplicate, changed tool and corrupt approved hash; owner check is 403', async () => {
    for (const corruption of ['duplicate', 'tool', 'hash']) {
      const plan = await fixture('reconciliation_required', ['succeeded', 'pending', 'pending']);
      if (corruption === 'duplicate') await stepRepo.createStep({ planId: plan.id, stepId: 'step_1', tool: steps[0]!.tool, requestedBy: ownerId });
      if (corruption === 'tool') await pool.query("UPDATE execution_steps SET tool = 'trello.archive_card' WHERE plan_id = $1 AND step_id = 'step_2'", [plan.id]);
      if (corruption === 'hash') await pool.query("UPDATE plans SET plan_hash = 'wrong-hash' WHERE id = $1", [plan.id]);
      const recovered = freshService();
      expect((await recovered.post(plan.id, 'continue', otherToken)).status).toBe(403);
      expect((await recovered.post(plan.id, 'continue')).status).toBe(409);
      expect((await latest(recovered, plan.conv_id)).body.recoveryActions).toEqual(['stop']);
      expect(recovered.calls).toEqual([]);
    }
  });

  it('claims two concurrent Continue requests using real SQL CAS, so only one dispatches', async () => {
    const plan = await fixture('reconciliation_required', ['succeeded', 'pending', 'pending']);
    const first = freshService(); const second = freshService();
    const lock = await pool.connect();
    await lock.query('BEGIN');
    await lock.query('SELECT id FROM plans WHERE id = $1 FOR UPDATE', [plan.id]);
    const requests = [first.post(plan.id, 'continue').then(r => r), second.post(plan.id, 'continue').then(r => r)];
    try {
      await waitUntil(async () => {
        const waiting = await pool.query("SELECT count(*)::integer AS count FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock' AND state = 'active'", [schema]);
        return waiting.rows[0].count >= 2;
      });
    } finally { await lock.query('ROLLBACK'); lock.release(); }
    expect((await Promise.all(requests)).map(r => r.status).sort()).toEqual([200, 409]);
    expect([...first.calls, ...second.calls].map(call => call.args.text)).toEqual(['Before crash', 'Card preserved-card']);
    expect((await planRepo.getPlan(plan.id))!.status).toBe('completed');
  }, 15_000);

  it('kills executor A, reconciles, then skips through B without replaying success and resolves saved output', async () => {
    const plan = await fixture('pending', []);
    const worker = spawn(process.execPath, ['--import', 'tsx', 'apps/chat-api/tests/integration/fixtures/recoverable-execution-worker.ts'], {
      cwd: root, env: { ...process.env, DATABASE_URL: scopedUrl.href, TEST_PLAN_ID: plan.id, TEST_USER_ID: ownerId },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    children.add(worker);
    const [message] = await once(worker, 'message');
    expect(message).toEqual({ event: 'write-started', calls: ['trello.create_card', 'slack.send_message'] });
    await stopProcess(worker);
    const succeeded = (await stepRepo.listSteps(plan.id))[0];
    await reconcileInterruptedExecutions(pool);
    const recovered = freshService();
    const response = await recovered.post(plan.id, 'steps/step_2/skip');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('completed');
    expect(recovered.calls).toEqual([{ tool: 'slack.send_message', args: { channel: 'fixture-channel', text: 'Card created-before-crash' } }]);
    const rows = await stepRepo.listSteps(plan.id);
    expect(rows.map(row => row.status)).toEqual(['succeeded', 'skipped', 'succeeded']);
    expect(rows[0]).toEqual(succeeded);
    expect((await planRepo.getPlan(plan.id))!.status).toBe('completed');
    expect(recovered.events.some(event => event.event === 'exec_step' && event.data.stepId === 'step_3')).toBe(true);
  }, 15_000);

  it('rejects retry of UNKNOWN with 409 and no mutation or adapter call', async () => {
    const plan = await fixture('reconciliation_required', ['succeeded', 'unknown', 'pending']);
    const before = await stepRepo.listSteps(plan.id);
    const recovered = freshService();
    expect((await recovered.post(plan.id, 'steps/step_2/retry')).status).toBe(409);
    expect(recovered.calls).toEqual([]);
    expect(await stepRepo.listSteps(plan.id)).toEqual(before);
    expect((await planRepo.getPlan(plan.id))!.status).toBe('reconciliation_required');
  });

  it('stops a reconciled plan and preserves uncertain evidence and pending rows', async () => {
    const plan = await fixture('reconciliation_required', ['succeeded', 'unknown', 'pending']);
    const before = await stepRepo.listSteps(plan.id);
    const recovered = freshService();
    const response = await recovered.post(plan.id, 'stop');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('stopped');
    expect((await planRepo.getPlan(plan.id))!.status).toBe('stopped');
    expect(await stepRepo.listSteps(plan.id)).toEqual(before);
    expect(recovered.calls).toEqual([]);
  });

  it('retries a saved known failure exactly once, clears its old error, then continues', async () => {
    const plan = await fixture('partial', ['succeeded', 'failed', 'pending']);
    const saved = (await stepRepo.listSteps(plan.id))[0];
    const recovered = freshService();
    const response = await recovered.post(plan.id, 'steps/step_2/retry');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('completed');
    expect(recovered.calls.map(call => call.args.text)).toEqual(['Before crash', 'Card preserved-card']);
    const rows = await stepRepo.listSteps(plan.id);
    expect(rows[0]).toEqual(saved);
    expect(rows[1]!.status).toBe('succeeded');
    expect(rows[1]!.error_json).toBeNull();
    expect((await recovered.post(plan.id, 'steps/step_2/retry')).status).toBe(409);
    expect(recovered.calls).toHaveLength(2);
  });

  it('skips a known failed partial step after restart without running that step', async () => {
    const plan = await fixture('partial', ['succeeded', 'failed', 'pending']);
    const recovered = freshService();
    expect((await recovered.post(plan.id, 'steps/step_2/skip')).status).toBe(200);
    expect(recovered.calls.map(call => call.args.text)).toEqual(['Card preserved-card']);
  });

  it.each([{ states: [] }, { states: ['pending', 'pending', 'pending'] }, { states: ['succeeded', 'failed', 'pending'] }])
    ('allows only Stop for reconciliation without UNKNOWN: $states', async ({ states }) => {
      const plan = await fixture('reconciliation_required', states);
      const before = await stepRepo.listSteps(plan.id);
      const recovered = freshService();
      expect((await recovered.post(plan.id, 'steps/step_2/skip')).status).toBe(409);
      expect((await recovered.post(plan.id, 'steps/step_2/retry')).status).toBe(409);
      expect((await recovered.post(plan.id, 'stop')).status).toBe(200);
      expect(await stepRepo.listSteps(plan.id)).toEqual(before);
      expect(recovered.calls).toEqual([]);
    });

  it('pauses at another UNKNOWN instead of automatically dispatching it', async () => {
    const plan = await fixture('reconciliation_required', ['succeeded', 'unknown', 'unknown']);
    const recovered = freshService();
    const response = await recovered.post(plan.id, 'steps/step_2/skip');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'reconciliation_required', pausedAtStepId: 'step_3' });
    expect(recovered.calls).toEqual([]);
    expect((await recovered.post(plan.id, 'steps/step_3/retry')).status).toBe(409);
    expect((await recovered.post(plan.id, 'stop')).status).toBe(200);
    expect((await stepRepo.listSteps(plan.id))[2]!.status).toBe('unknown');
  });

  it('rejects incomplete or duplicate durable snapshots before dispatch', async () => {
    for (const duplicate of [false, true]) {
      const plan = await fixture('partial', ['succeeded', 'failed']);
      if (duplicate) await stepRepo.createStep({ planId: plan.id, stepId: 'step_1', tool: steps[0]!.tool, requestedBy: ownerId });
      const recovered = freshService();
      expect((await recovered.post(plan.id, 'steps/step_2/retry')).status).toBe(409);
      expect(recovered.calls).toEqual([]);
      expect((await planRepo.getPlan(plan.id))!.status).toBe('partial');
    }
  });

  it('rejects modified plan JSON before continuation while still allowing safe Stop', async () => {
    const plan = await fixture('partial', ['succeeded', 'failed', 'pending']);
    await pool.query("UPDATE plans SET plan_json = jsonb_set(plan_json, '{steps,2,args,channel}', '\"changed-channel\"') WHERE id = $1", [plan.id]);
    const recovered = freshService();
    expect((await recovered.post(plan.id, 'steps/step_2/retry')).status).toBe(409);
    expect(recovered.calls).toEqual([]);
    expect((await recovered.post(plan.id, 'stop')).status).toBe(200);
  });

  it('serializes two independent restorations with a real PostgreSQL row lock and one dispatch', async () => {
    const plan = await fixture('reconciliation_required', ['succeeded', 'unknown', 'pending']);
    const first = freshService(); const second = freshService();
    const lock = await pool.connect();
    await lock.query('BEGIN');
    await lock.query('SELECT id FROM plans WHERE id = $1 FOR UPDATE', [plan.id]);
    const requests = [first.post(plan.id, 'steps/step_2/skip').then(response => response), second.post(plan.id, 'steps/step_2/skip').then(response => response)];
    try {
      await waitUntil(async () => {
        const waiting = await pool.query("SELECT count(*)::integer AS count FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock' AND state = 'active'", [schema]);
        return waiting.rows[0].count >= 2;
      });
    } finally { await lock.query('ROLLBACK'); lock.release(); }
    const responses = await Promise.all(requests);
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    expect([...first.calls, ...second.calls]).toHaveLength(1);
    expect((await stepRepo.listSteps(plan.id)).map(row => row.status)).toEqual(['succeeded', 'skipped', 'succeeded']);
  }, 15_000);

  it('stops before an external call when restored step persistence fails', async () => {
    const plan = await fixture('partial', ['succeeded', 'failed', 'pending']);
    await pool.query(`ALTER TABLE execution_steps ADD CONSTRAINT reject_recovery_running CHECK (plan_id <> '${plan.id}'::uuid OR status <> 'running')`);
    try {
      const recovered = freshService();
      expect((await recovered.post(plan.id, 'steps/step_2/retry')).status).toBe(500);
      expect(recovered.calls).toEqual([]);
      expect((await stepRepo.listSteps(plan.id))[2]!.status).toBe('pending');
    } finally { await pool.query('ALTER TABLE execution_steps DROP CONSTRAINT reject_recovery_running'); }
  });

  it('returns an owner-scoped latest execution snapshot with output/timing and safe recovery actions', async () => {
    const plan = await fixture('reconciliation_required', ['succeeded', 'unknown', 'pending']);
    const recovered = freshService();
    const endpoint = `/api/conversations/${plan.conv_id}/executions/latest`;
    const response = await request(recovered.app).get(endpoint).set('Authorization', `Bearer ${ownerToken}`);
    expect(response.status).toBe(200);
    expect(response.body.plan).toMatchObject({ id: plan.id, convId: plan.conv_id });
    expect(response.body.execution).toEqual({ status: 'reconciliation_required', pausedStepId: 'step_2' });
    expect(response.body.steps.map((step: any) => step.status)).toEqual(['succeeded', 'unknown', 'pending']);
    expect(response.body.steps[0]).toMatchObject({ stepId: 'step_1', output: { id: 'preserved-card' }, completedAt: expect.any(String) });
    expect(response.body.recoveryActions).toEqual(['skip', 'stop']);
    expect((await request(recovered.app).get(endpoint).set('Authorization', `Bearer ${otherToken}`)).status).toBe(403);
    expect((await recovered.post(plan.id, 'steps/step_2/skip', otherToken)).status).toBe(403);
    expect((await recovered.post(plan.id, 'stop', otherToken)).status).toBe(403);
    expect(recovered.calls).toEqual([]);
  });

  it('reports Stop-only snapshot for an unstarted reconciled plan', async () => {
    const plan = await fixture('reconciliation_required', []);
    const recovered = freshService();
    const response = await request(recovered.app).get(`/api/conversations/${plan.conv_id}/executions/latest`).set('Authorization', `Bearer ${ownerToken}`);
    expect(response.status).toBe(200);
    expect(response.body.steps).toEqual([]);
    expect(response.body.recoveryActions).toEqual(['stop']);
  });

  it.each([
    { value: { steps: { invalid: true } }, corruptText: false },
    { value: 'not-valid-plan-json', corruptText: false },
    { value: null, corruptText: false },
    { value: 'not-valid-plan-json', corruptText: true },
  ])('loads evidence and Stop-only actions for malformed stored plan $value / text=$corruptText', async ({ value, corruptText }) => {
    const plan = await fixture('reconciliation_required', ['succeeded', 'unknown', 'pending']);
    const before = await stepRepo.listSteps(plan.id);
    await pool.query('UPDATE plans SET plan_json = $2::jsonb, plan_text = CASE WHEN $3 THEN $4 ELSE plan_text END WHERE id = $1',
      [plan.id, JSON.stringify(value), corruptText, 'invalid-plan-text']);
    const recovered = freshService();
    const response = await request(recovered.app).get(`/api/conversations/${plan.conv_id}/executions/latest`).set('Authorization', `Bearer ${ownerToken}`);
    expect(response.status).toBe(200);
    expect(response.body.plan.id).toBe(plan.id);
    expect(response.body.steps.map((step: any) => step.status)).toEqual(['succeeded', 'unknown', 'pending']);
    expect(response.body.steps[0].output).toEqual(before[0]!.output_json);
    expect(response.body.recoveryActions).toEqual(['stop']);
    const status = await request(recovered.app).get(`/api/executions/${plan.id}/status`).set('Authorization', `Bearer ${ownerToken}`);
    expect(status.status).toBe(200);
    expect(status.body).toEqual({ status: 'reconciliation_required', pausedStepId: 'step_2' });
    expect((await recovered.post(plan.id, 'steps/step_2/skip')).status).toBe(409);
    expect((await recovered.post(plan.id, 'stop')).status).toBe(200);
    expect(await stepRepo.listSteps(plan.id)).toEqual(before);
    expect(recovered.calls).toEqual([]);
  });
});
