import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { generateTokens } from '../../src/auth/jwt.js';
import { ExecutionService } from '../../src/services/execution-service.js';
import { createHash } from 'node:crypto';
import { ExecutionController } from '@wap/executor';

const secret = 'execution-security-secret-at-least-32-chars';
const token = generateTokens({ id: 'user-a', email: 'a@example.test', name: 'A' }, secret).accessToken;

describe('execution ownership', () => {
  it('rejects stop after completion without overwriting the durable status', async () => {
    const updatePlanStatus = vi.fn();
    const controller = new ExecutionController({
      runner: { executeStep: async () => ({ status: 'succeeded', output: { id: 'written' } }) },
      steps: [{ id: 's1', tool: 'trello.create_card', description: 'Write', args: {}, dependsOn: [] }],
    });
    await controller.runUntilPause();
    const service = new ExecutionService({
      planRepo: { getPlan: async () => ({ id: 'p', conv_id: 'c', status: 'completed' }), updatePlanStatus } as any,
      convRepo: { getConversation: async () => ({ id: 'c', user_id: 'user-a' }) },
      adapterFactory: { getAdapterForService: async () => ({ execute: async () => ({}) }) },
    });
    (service as any).activeControllers.set('p', controller);
    await expect(service.stop('p', 'user-a')).rejects.toMatchObject({ status: 409 });
    expect(updatePlanStatus).not.toHaveBeenCalled();
  });

  it('reports a durable approved plan as needing reconciliation after controller loss', async () => {
    const service = new ExecutionService({
      planRepo: { getPlan: async () => ({ id: 'p', conv_id: 'c', status: 'approved' }) } as any,
      convRepo: { getConversation: async () => ({ id: 'c', user_id: 'user-a' }) },
      adapterFactory: { getAdapterForService: async () => ({ execute: async () => ({}) }) },
    });
    const app = createApp({ jwtSecret: secret, executionService: service });
    const response = await request(app).get('/api/executions/p/status').set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('reconciliation_required');
  });

  it('persists reconciliation_required when stop aborts an uncertain external write', async () => {
    const plan = { steps: [{ id: 's1', tool: 'trello.create_card', description: 'Write', args: {}, dependsOn: [] }] };
    let status = 'pending';
    let started!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const updateStepStatus = vi.fn().mockResolvedValue({});
    const service = new ExecutionService({
      planRepo: {
        getPlan: async () => ({ id: 'p', conv_id: 'c', status, plan_json: plan, plan_hash: createHash('sha256').update(JSON.stringify(plan)).digest('hex') }),
        approvePlan: async () => { status = 'approved'; return true; },
        updatePlanStatus: async (_id: string, next: string) => { status = next; },
      } as any,
      convRepo: { getConversation: async () => ({ id: 'c', user_id: 'user-a' }) },
      stepRepo: {
        createStep: async () => ({ id: 'db-s1' }),
        updateStepStatus,
      } as any,
      adapterFactory: { getAdapterForService: async () => ({
        execute: async (_tool: string, _args: unknown, options: { signal: AbortSignal }) => {
          started();
          await new Promise<void>((resolve) => options.signal.addEventListener('abort', () => resolve(), { once: true }));
          throw new Error('connection lost after write may have committed');
        },
      }) },
    });
    expect((await service.approveAndStart('p', 'user-a')).status).toBe(200);
    await entered;
    const stopped = await service.stop('p', 'user-a');
    expect(stopped.status).toBe('reconciliation_required');
    expect(status).toBe('reconciliation_required');
    expect(updateStepStatus).toHaveBeenCalledWith('db-s1', 'unknown', undefined, expect.any(Object));
    await expect(service.stop('p', 'user-a')).rejects.toMatchObject({ status: 409 });
    await expect(service.retryStep('p', 's1', 'user-a')).rejects.toMatchObject({ status: 409 });
    expect(status).toBe('reconciliation_required');
  });

  it('cancels a queued execution before its controller exists and prevents the write', async () => {
    const plan = { steps: [{ id: 's1', tool: 'trello.create_card', description: 'Write', args: {}, dependsOn: [] }] };
    let status = 'pending';
    let entered!: () => void;
    let release!: () => void;
    const creating = new Promise<void>((resolve) => { entered = resolve; });
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const adapterCalls = vi.fn().mockResolvedValue({ id: 'written' });
    const service = new ExecutionService({
      planRepo: {
        getPlan: async () => ({ id: 'p', conv_id: 'c', status, plan_json: plan, plan_hash: createHash('sha256').update(JSON.stringify(plan)).digest('hex') }),
        approvePlan: async () => { status = 'approved'; return true; },
        updatePlanStatus: async (_id: string, next: string) => { status = next; },
      } as any,
      convRepo: { getConversation: async () => ({ id: 'c', user_id: 'user-a' }) },
      stepRepo: {
        createStep: async () => { entered(); await hold; return { id: 'db-s1' }; },
        updateStepStatus: async () => ({}),
      } as any,
      adapterFactory: { getAdapterForService: async () => ({ execute: adapterCalls }) },
    });
    expect((await service.approveAndStart('p', 'user-a')).status).toBe(200);
    await creating;
    expect((await service.stop('p', 'user-a')).status).toBe('stopped');
    release();
    await vi.waitFor(() => expect(service.getExecutionStatus('p')?.status).toBe('stopped'));
    expect(adapterCalls).not.toHaveBeenCalled();
  });

  it('waits for an in-flight retry before settling a stop request', async () => {
    const plan = { steps: [{ id: 's1', tool: 'trello.create_card', description: 'Write', args: {}, dependsOn: [] }] };
    let status = 'pending';
    let calls = 0;
    let entered!: () => void;
    const retryStarted = new Promise<void>((resolve) => { entered = resolve; });
    const service = new ExecutionService({
      planRepo: {
        getPlan: async () => ({ id: 'p', conv_id: 'c', status, plan_json: plan, plan_hash: createHash('sha256').update(JSON.stringify(plan)).digest('hex') }),
        approvePlan: async () => { status = 'approved'; return true; },
        updatePlanStatus: async (_id: string, next: string) => { status = next; },
      } as any,
      convRepo: { getConversation: async () => ({ id: 'c', user_id: 'user-a' }) },
      stepRepo: { createStep: async () => ({ id: 'db-s1' }), updateStepStatus: async () => ({}) } as any,
      adapterFactory: { getAdapterForService: async () => ({
        execute: async (_tool: string, _args: unknown, options: { signal: AbortSignal }) => {
          calls++;
          if (calls === 1) throw Object.assign(new Error('not found'), { status: 404 });
          entered();
          await new Promise<void>((resolve) => options.signal.addEventListener('abort', () => resolve(), { once: true }));
          throw new Error('write outcome unknown');
        },
      }) },
    });
    expect((await service.approveAndStart('p', 'user-a')).status).toBe(200);
    await vi.waitFor(() => expect(service.getExecutionStatus('p')?.status).toBe('partial'));
    const retry = service.retryStep('p', 's1', 'user-a');
    await retryStarted;
    const stopped = await service.stop('p', 'user-a');
    expect(stopped.status).toBe('reconciliation_required');
    expect((await retry).status).toBe('reconciliation_required');
    expect(status).toBe('reconciliation_required');
  });

  it('waits for the prior plan status write before retrying a failed step', async () => {
    const plan = { steps: [{ id: 's1', tool: 'trello.create_card', description: 'Write', args: {}, dependsOn: [] }] };
    let status = 'pending';
    let entered!: () => void;
    let release!: () => void;
    const partialWriteStarted = new Promise<void>((resolve) => { entered = resolve; });
    const holdPartialWrite = new Promise<void>((resolve) => { release = resolve; });
    let adapterCalls = 0;
    const service = new ExecutionService({
      planRepo: {
        getPlan: async () => ({ id: 'p', conv_id: 'c', status, plan_json: plan, plan_hash: createHash('sha256').update(JSON.stringify(plan)).digest('hex') }),
        approvePlan: async () => { status = 'approved'; return true; },
        updatePlanStatus: async (_id: string, next: string) => {
          if (next === 'partial') {
            entered();
            await holdPartialWrite;
          }
          status = next;
        },
      } as any,
      convRepo: { getConversation: async () => ({ id: 'c', user_id: 'user-a' }) },
      stepRepo: { createStep: async () => ({ id: 'db-s1' }), updateStepStatus: async () => ({}) } as any,
      adapterFactory: { getAdapterForService: async () => ({
        execute: async () => {
          adapterCalls++;
          if (adapterCalls === 1) throw Object.assign(new Error('not found'), { status: 404 });
          return { id: 'written' };
        },
      }) },
    });
    expect((await service.approveAndStart('p', 'user-a')).status).toBe(200);
    await partialWriteStarted;
    const retry = service.retryStep('p', 's1', 'user-a');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(adapterCalls).toBe(1);
    release();
    expect((await retry).status).toBe('completed');
    expect(status).toBe('completed');
  });

  it('does not conceal a previously unknown write outcome when stopping a paused plan', async () => {
    const plan = { steps: [{ id: 's1', tool: 'trello.create_card', description: 'Write', args: {}, dependsOn: [] }] };
    let status = 'pending';
    const service = new ExecutionService({
      planRepo: {
        getPlan: async () => ({ id: 'p', conv_id: 'c', status, plan_json: plan, plan_hash: createHash('sha256').update(JSON.stringify(plan)).digest('hex') }),
        approvePlan: async () => { status = 'approved'; return true; },
        updatePlanStatus: async (_id: string, next: string) => { status = next; },
      } as any,
      convRepo: { getConversation: async () => ({ id: 'c', user_id: 'user-a' }) },
      stepRepo: { createStep: async () => ({ id: 'db-s1' }), updateStepStatus: async () => ({}) } as any,
      adapterFactory: { getAdapterForService: async () => ({ execute: async () => { throw new Error('network lost after possible write'); } }) },
    });
    expect((await service.approveAndStart('p', 'user-a')).status).toBe(200);
    await vi.waitFor(() => expect(service.getExecutionStatus('p')?.status).toBe('partial'));
    expect((await service.stop('p', 'user-a')).status).toBe('reconciliation_required');
    expect(status).toBe('reconciliation_required');
  });
  it('prevents a different user from rejecting or inspecting a plan', async () => {
    const rejectPlan = vi.fn().mockResolvedValue(true);
    const planRepo = {
      getPlan: async () => ({ id: 'plan-b', conv_id: 'conv-b', plan_json: { steps: [] }, status: 'pending', plan_hash: 'x' }),
      rejectPlan,
    };
    const service = new ExecutionService({
      planRepo: planRepo as any,
      convRepo: { getConversation: async () => ({ id: 'conv-b', user_id: 'user-b' }) },
      adapterFactory: { getAdapterForService: async () => ({ execute: async () => ({}) }) },
    });
    const app = createApp({ jwtSecret: secret, executionService: service });

    const rejected = await request(app).post('/api/plans/plan-b/reject').set('Authorization', `Bearer ${token}`);
    expect(rejected.status).toBe(403);
    expect(rejectPlan).not.toHaveBeenCalled();

    const status = await request(app).get('/api/executions/plan-b/status').set('Authorization', `Bearer ${token}`);
    expect(status.status).toBe(403);
  });

  it('does not approve a plan whose stored hash differs from its JSON', async () => {
    const approvePlan = vi.fn().mockResolvedValue(true);
    const service = new ExecutionService({
      planRepo: {
        getPlan: async () => ({ id: 'p', conv_id: 'c', status: 'pending', expires_at: new Date(Date.now() + 60_000), plan_json: { kind: 'plan', steps: [] }, plan_hash: 'wrong-hash' }),
        approvePlan,
      } as any,
      convRepo: { getConversation: async () => ({ id: 'c', user_id: 'user-a' }) },
      adapterFactory: { getAdapterForService: async () => ({ execute: async () => ({}) }) },
    });
    const result = await service.approveAndStart('p', 'user-a');
    expect(result.success).toBe(false);
    expect(result.status).toBe(409);
    expect(approvePlan).not.toHaveBeenCalled();
  });

  it('stops later writes and reports failed status when step persistence fails', async () => {
    const plan = { steps: [
      { id: 's1', tool: 'trello.create_card', description: 'First', args: {}, dependsOn: [] },
      { id: 's2', tool: 'slack.send_message', description: 'Second', args: {}, dependsOn: ['s1'] },
    ] };
    const adapterCalls = vi.fn().mockResolvedValue({ id: 'created' });
    let resolveFinal!: (value: any) => void;
    const finalEvent = new Promise<any>((resolve) => { resolveFinal = resolve; });
    const service = new ExecutionService({
      planRepo: {
        getPlan: async () => ({ id: 'p', conv_id: 'c', status: 'pending', expires_at: new Date(Date.now() + 60_000), plan_json: plan, plan_hash: createHash('sha256').update(JSON.stringify(plan)).digest('hex') }),
        approvePlan: async () => true,
        updatePlanStatus: async () => undefined,
      } as any,
      convRepo: { getConversation: async () => ({ id: 'c', user_id: 'user-a' }) },
      stepRepo: {
        createStep: async ({ stepId }: any) => ({ id: stepId }),
        updateStepStatus: async (_id: string, status: string) => {
          if (status === 'succeeded') throw new Error('database unavailable');
        },
      } as any,
      adapterFactory: { getAdapterForService: async () => ({ execute: adapterCalls }) },
      sseManager: { emitEvent: (_convId, event, payload) => { if (event === 'exec_done') resolveFinal(payload); } },
    });
    expect((await service.approveAndStart('p', 'user-a')).status).toBe(200);
    const result = await Promise.race([finalEvent, new Promise((_, reject) => setTimeout(() => reject(new Error('missing exec_done')), 2000))]);
    expect(adapterCalls).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('failed');
    expect(service.getExecutionStatus('p')?.status).toBe('failed');
  });

  it('marks a retry failed if its durable step update fails', async () => {
    const plan = { steps: [{ id: 's1', tool: 'trello.create_card', description: 'Write', args: {}, dependsOn: [] }] };
    const events: any[] = [];
    let calls = 0;
    const updatePlanStatus = vi.fn().mockResolvedValue(undefined);
    const service = new ExecutionService({
      planRepo: {
        getPlan: async () => ({ id: 'p', conv_id: 'c', status: 'pending', expires_at: new Date(Date.now() + 60_000), plan_json: plan, plan_hash: createHash('sha256').update(JSON.stringify(plan)).digest('hex') }),
        approvePlan: async () => true,
        updatePlanStatus,
      } as any,
      convRepo: { getConversation: async () => ({ id: 'c', user_id: 'user-a' }) },
      stepRepo: {
        createStep: async () => ({ id: 'db-s1' }),
        updateStepStatus: async (_id: string, status: string) => {
          if (status === 'succeeded') throw new Error('step persistence unavailable');
        },
      } as any,
      adapterFactory: { getAdapterForService: async () => ({ execute: async () => {
        calls++;
        if (calls === 1) throw Object.assign(new Error('not found'), { status: 404 });
        return { id: 'card' };
      } }) },
      sseManager: { emitEvent: (_convId, name, payload) => { if (name === 'exec_done') events.push(payload); } },
    });
    expect((await service.approveAndStart('p', 'user-a')).status).toBe(200);
    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0].status).toBe('partial');
    await expect(service.retryStep('p', 's1', 'user-a')).rejects.toThrow('step persistence unavailable');
    expect(calls).toBe(2);
    expect(service.getExecutionStatus('p')?.status).toBe('failed');
    expect(updatePlanStatus).toHaveBeenLastCalledWith('p', 'failed');
  });
});
