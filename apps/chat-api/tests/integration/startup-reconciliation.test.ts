import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, type AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UserRepo } from '../../src/db/repositories/user-repo.js';
import { ConversationRepo } from '../../src/db/repositories/conversation-repo.js';
import { PlanRepo } from '../../src/db/repositories/plan-repo.js';
import { StepRepo } from '../../src/db/repositories/step-repo.js';
import { generateAccessToken } from '../../src/auth/jwt.js';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const databaseUrl = process.env.DATABASE_URL || 'postgresql://ati_v3:ati_v3_local_only@127.0.0.1:55533/ati_v3';
const schema = `w2_reconcile_${randomUUID().replaceAll('-', '')}`;
const scopedUrl = new URL(databaseUrl);
scopedUrl.searchParams.set('options', `-c search_path=${schema}`);
const secret = 'startup-reconciliation-test-secret-at-least-32-bytes';
const privateMarker = 'PRIVATE_RECONCILIATION_ARGUMENT';
const children = new Set<ChildProcess>();

// Each case spawns the API with tsx; on a loaded machine startup alone can take well over 10 s.
const PROCESS_START_MS = 30_000;
const API_TEST_TIMEOUT_MS = 45_000;

async function waitUntil(check: () => Promise<boolean>, timeoutMs = PROCESS_START_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for the execution fixture');
}

async function stopProcess(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  await exited;
}

async function unusedPort() {
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = (socket.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  return port;
}

async function launchApi() {
  const port = await unusedPort();
  const child = spawn(process.execPath, ['--import', 'tsx', 'apps/chat-api/src/server.ts'], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: scopedUrl.href, RUNTIME_MODE: 'sandbox', NODE_ENV: 'development',
      LLM_PROVIDER: 'gemini', JWT_SECRET: secret, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  let output = '';
  child.stdout!.on('data', chunk => { output += chunk; });
  child.stderr!.on('data', chunk => { output += chunk; });
  const baseUrl = `http://127.0.0.1:${port}`;
  const waitForHealth = () => waitUntil(async () => {
    if (child.exitCode !== null) throw new Error(`API exited during startup: ${output}`);
    try { return (await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(300) })).ok; }
    catch { return false; }
  });
  return { child, baseUrl, output: () => output, waitForHealth };
}

describe('startup execution reconciliation on real PostgreSQL', () => {
  let adminPool: pg.Pool;
  let pool: pg.Pool;
  let planRepo: PlanRepo;
  let stepRepo: StepRepo;
  let convRepo: ConversationRepo;
  let userId: string;
  let token: string;

  beforeAll(async () => {
    adminPool = new pg.Pool({ connectionString: databaseUrl });
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    pool = new pg.Pool({ connectionString: scopedUrl.href });
    for (const migration of ['0001_v3_core.sql', '0002_v3_invariants.sql', '0006_fe03_resource_labels.sql']) {
      await pool.query(await readFile(resolve(root, 'db/v3', migration), 'utf8'));
    }
    planRepo = new PlanRepo(pool);
    stepRepo = new StepRepo(pool);
    convRepo = new ConversationRepo(pool);
    const users = new UserRepo(pool);
    const user = await users.createUser({ email: 'reconciliation@localhost.test', name: 'Fixture', password: 'Fixture-test-password' });
    await pool.query(await readFile(resolve(root, 'db/v3/0003_auth_sessions.sql'), 'utf8'));
    userId = user.id;
    const session = await users.sessions.create(user.id, 'Startup reconciliation fixture');
    token = generateAccessToken(user, secret, session.sessionId).accessToken;
  });

  afterEach(async () => {
    await Promise.all([...children].map(stopProcess));
    children.clear();
  });

  afterAll(async () => {
    await pool?.end();
    // This randomly named schema is created by this suite, not application data.
    await adminPool?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await adminPool?.end();
  });

  async function fixture(status: string, states: string[], tools?: string[]) {
    const conv = await convRepo.createConversation(userId);
    const steps = states.map((_state, index) => ({
      id: `step_${index + 1}`, tool: tools?.[index] || 'trello.create_card', description: 'Fixture step',
      args: { listId: 'test-list', title: privateMarker }, dependsOn: index ? [`step_${index}`] : [],
    }));
    const planJson = { kind: 'plan', thinking: 'Fixture', steps, warnings: [] };
    const planText = JSON.stringify(planJson);
    const plan = await planRepo.createPlan({ convId: conv.id, planJson, planText,
      planHash: createHash('sha256').update(planText).digest('hex'), expiresAt: new Date(Date.now() + 60_000) });
    await planRepo.updatePlanStatus(plan.id, status);
    for (const [index, state] of states.entries()) {
      const step = steps[index]!;
      const row = await stepRepo.createStep({ planId: plan.id, stepId: step.id, tool: step.tool,
        argsJson: step.args, requestedBy: userId });
      if (state !== 'pending') await stepRepo.updateStepStatus(row.id, state,
        state === 'succeeded' ? { id: 'preserved-output', title: privateMarker } : undefined,
        state === 'failed' ? { category: 'VALIDATION', message: 'Known failure' } : undefined);
    }
    return plan;
  }

  async function executionStatus(api: Awaited<ReturnType<typeof launchApi>>, planId: string) {
    const response = await fetch(`${api.baseUrl}/api/executions/${planId}/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    return response.json();
  }

  it('waits for database reconciliation before accepting HTTP and preserves completed/pending steps', async () => {
    const plan = await fixture('approved', ['succeeded', 'running', 'pending']);
    const before = await stepRepo.listSteps(plan.id);
    const lock = await pool.connect();
    await lock.query('BEGIN');
    await lock.query('SELECT id FROM plans WHERE id = $1 FOR UPDATE', [plan.id]);
    const api = await launchApi();
    try {
      await waitUntil(async () => api.output().includes('Đã kết nối thành công'));
      let listening = false;
      try { listening = (await fetch(`${api.baseUrl}/api/health`, { signal: AbortSignal.timeout(300) })).ok; }
      catch { /* Reconciliation is blocked on the real row lock. */ }
      expect(listening).toBe(false);
    } finally {
      await lock.query('ROLLBACK');
      lock.release();
    }
    await api.waitForHealth();
    expect((await planRepo.getPlan(plan.id))!.status).toBe('reconciliation_required');
    const after = await stepRepo.listSteps(plan.id);
    expect(after[0]).toEqual(before[0]);
    expect(after[2]).toEqual(before[2]);
    expect(after[1]).toMatchObject({ status: 'unknown', error_json: { category: 'UNKNOWN' } });
    expect(after[1]!.completed_at).toBeInstanceOf(Date);
    expect(after[1]!.duration_ms).toBeGreaterThanOrEqual(0);
    expect(await executionStatus(api, plan.id)).toEqual({ status: 'reconciliation_required', pausedStepId: 'step_2' });
    const lines = api.output().split('\n').filter(line => line.includes('[execution-reconciliation]'));
    expect(lines.some(line => line.includes(plan.id) && line.includes('unknown_steps=1'))).toBe(true);
    expect(lines.join('\n')).not.toContain(privateMarker);
  }, API_TEST_TIMEOUT_MS);

  it.each(['completed', 'rejected', 'pending', 'expired', 'superseded', 'stopped', 'failed'])
    ('does not change a %s plan or any of its steps', async status => {
      const plan = await fixture(status, ['running']);
      const beforePlan = await planRepo.getPlan(plan.id);
      const beforeSteps = await stepRepo.listSteps(plan.id);
      const api = await launchApi();
      await api.waitForHealth();
      expect(await planRepo.getPlan(plan.id)).toEqual(beforePlan);
      expect(await stepRepo.listSteps(plan.id)).toEqual(beforeSteps);
    }, API_TEST_TIMEOUT_MS);

  it.each([{ states: [] }, { states: ['pending', 'pending'] }])('quarantines an approved plan with unstarted steps $states without inventing UNKNOWN steps', async ({ states }) => {
    const plan = await fixture('approved', states);
    const before = await stepRepo.listSteps(plan.id);
    const api = await launchApi();
    await api.waitForHealth();
    expect((await planRepo.getPlan(plan.id))!.status).toBe('reconciliation_required');
    expect(await stepRepo.listSteps(plan.id)).toEqual(before);
    expect(await executionStatus(api, plan.id)).toEqual({ status: 'reconciliation_required' });
  }, API_TEST_TIMEOUT_MS);

  it('keeps a known failed partial plan partial and reports its failed step over HTTP', async () => {
    const plan = await fixture('partial', ['succeeded', 'failed', 'pending']);
    const before = await stepRepo.listSteps(plan.id);
    const api = await launchApi();
    await api.waitForHealth();
    expect((await planRepo.getPlan(plan.id))!.status).toBe('partial');
    expect(await stepRepo.listSteps(plan.id)).toEqual(before);
    expect(await executionStatus(api, plan.id)).toEqual({ status: 'partial', pausedStepId: 'step_2' });
  }, API_TEST_TIMEOUT_MS);

  it('quarantines an interrupted read without automatically re-running it', async () => {
    const plan = await fixture('executing', ['running', 'pending'], ['trello.search_boards', 'trello.create_card']);
    const api = await launchApi();
    await api.waitForHealth();
    expect((await planRepo.getPlan(plan.id))!.status).toBe('reconciliation_required');
    expect((await stepRepo.listSteps(plan.id)).map(step => step.status)).toEqual(['unknown', 'pending']);
    expect(api.output()).not.toContain('[Sandbox Execution]');
  }, API_TEST_TIMEOUT_MS);

  it('returns the first unknown step in plan order, ahead of known failures', async () => {
    const states = ['failed', 'unknown', ...Array<string>(7).fill('succeeded'), 'unknown'];
    const plan = await fixture('partial', states);
    const api = await launchApi();
    await api.waitForHealth();
    expect(await executionStatus(api, plan.id)).toEqual({ status: 'reconciliation_required', pausedStepId: 'step_2' });
  }, API_TEST_TIMEOUT_MS);

  it('is idempotent across a second server start, including timestamps and sanitized logs', async () => {
    const plan = await fixture('approved', ['running', 'pending']);
    const first = await launchApi();
    await first.waitForHealth();
    const before = await stepRepo.listSteps(plan.id);
    await stopProcess(first.child);
    const second = await launchApi();
    await second.waitForHealth();
    expect(before[0]!.status).toBe('unknown');
    expect(await stepRepo.listSteps(plan.id)).toEqual(before);
    expect((await planRepo.getPlan(plan.id))!.status).toBe('reconciliation_required');
    expect(second.output()).not.toContain('[execution-reconciliation]');
  }, API_TEST_TIMEOUT_MS);

  it('rolls back step changes and refuses to listen if reconciliation fails', async () => {
    const plan = await fixture('approved', ['running']);
    const before = await stepRepo.listSteps(plan.id);
    await pool.query(`ALTER TABLE plans ADD CONSTRAINT reject_reconciliation CHECK (id <> '${plan.id}'::uuid OR status <> 'reconciliation_required')`);
    try {
      const api = await launchApi();
      await waitUntil(async () => api.child.exitCode !== null || api.child.signalCode !== null, PROCESS_START_MS);
      expect(api.child.exitCode).toBe(1);
      expect((await planRepo.getPlan(plan.id))!.status).toBe('approved');
      expect(await stepRepo.listSteps(plan.id)).toEqual(before);
      expect(api.output()).not.toContain(privateMarker);
      await expect(fetch(`${api.baseUrl}/api/health`, { signal: AbortSignal.timeout(300) })).rejects.toThrow();
    } finally {
      await pool.query('ALTER TABLE plans DROP CONSTRAINT reject_reconciliation');
    }
  }, API_TEST_TIMEOUT_MS);

  it('reconciles persisted progress after killing the actual execution process mid-write', async () => {
    const plan = await fixture('pending', []);
    const planJson = { steps: [
      { id: 'step_1', tool: 'trello.create_card', description: 'Complete before crash', args: { listId: 'test-list', title: 'Fixture' }, dependsOn: [] },
      { id: 'step_2', tool: 'slack.send_message', description: 'Interrupted write', args: { channel: 'test-channel', text: 'Fixture' }, dependsOn: ['step_1'] },
      { id: 'step_3', tool: 'trello.create_card', description: 'Never started', args: { listId: 'test-list', title: 'Pending' }, dependsOn: ['step_2'] },
    ] };
    const text = JSON.stringify(planJson);
    await pool.query('UPDATE plans SET plan_json = $2, plan_text = $3, plan_hash = $4 WHERE id = $1',
      [plan.id, planJson, text, createHash('sha256').update(text).digest('hex')]);
    const worker = spawn(process.execPath, ['--import', 'tsx', 'apps/chat-api/tests/integration/fixtures/interrupted-execution-worker.ts'], {
      cwd: root, env: { ...process.env, DATABASE_URL: scopedUrl.href, TEST_PLAN_ID: plan.id, TEST_USER_ID: userId },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    children.add(worker);
    await once(worker, 'message');
    await stopProcess(worker);
    expect((await stepRepo.listSteps(plan.id)).map(step => step.status)).toEqual(['succeeded', 'running', 'pending']);
    const api = await launchApi();
    await api.waitForHealth();
    const steps = await stepRepo.listSteps(plan.id);
    expect(steps.map(step => step.status)).toEqual(['succeeded', 'unknown', 'pending']);
    expect(steps[0]!.output_json.id).toBe('completed-before-crash');
    expect((await planRepo.getPlan(plan.id))!.status).toBe('reconciliation_required');
    expect(api.output()).not.toContain('[Sandbox Execution]');
  }, API_TEST_TIMEOUT_MS);
});
