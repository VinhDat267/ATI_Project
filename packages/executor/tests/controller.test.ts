import { describe, it, expect, vi } from 'vitest';
import { ExecutionController } from '../src/index.js';
import type { PlanStep } from '@wap/tool-schemas';

describe('packages/executor (Task 14: ExecutionController & Partial Failure Recovery)', () => {
  it('waits for durable step updates and stops before a later write when persistence fails', async () => {
    const steps: PlanStep[] = [
      { id: 's1', tool: 'trello.create_card', description: 'First write', args: {}, dependsOn: [] },
      { id: 's2', tool: 'slack.send_message', description: 'Second write', args: {}, dependsOn: ['s1'] },
    ];
    const executeStep = vi.fn().mockResolvedValue({ status: 'succeeded', output: { id: 'created' } });
    const controller = new ExecutionController({
      runner: { executeStep },
      steps,
      onStepUpdate: async (_stepId, state) => {
        if (state.status === 'succeeded') throw new Error('database unavailable');
      },
    });
    await expect(controller.runUntilPause()).rejects.toThrow('database unavailable');
    expect(executeStep).toHaveBeenCalledTimes(1);
  });

  it('rejects retry of a pending or skipped write step', async () => {
    const steps: PlanStep[] = [
      { id: 's1', tool: 'trello.create_card', description: 'Write', args: {}, dependsOn: [] },
    ];
    const runner = { executeStep: vi.fn().mockResolvedValue({ status: 'failed', error: { message: 'known failure' } }) };
    const controller = new ExecutionController({ runner, steps });
    await expect(controller.retryStep('s1')).rejects.toThrow(/Cannot retry/);
    expect(runner.executeStep).not.toHaveBeenCalled();
    await controller.runUntilPause();
    await controller.skipStepAndContinue('s1');
    await expect(controller.retryStep('s1')).rejects.toThrow(/Cannot retry/);
    expect(runner.executeStep).toHaveBeenCalledTimes(1);
  });

  it('passes a live AbortSignal to the runner and aborts it on stop', async () => {
    let signal: AbortSignal | undefined;
    let started!: () => void;
    const observed = new Promise<void>((resolve) => { started = resolve; });
    const runner = { executeStep: vi.fn().mockImplementation(async (_step, _outputs, options) => {
      signal = options?.signal;
      started();
      await new Promise<void>((done) => signal?.addEventListener('abort', () => done(), { once: true }));
      return { status: 'unknown', error: { message: 'aborted' } };
    }) };
    const controller = new ExecutionController({ runner, steps: [
      { id: 's1', tool: 'trello.create_card', description: 'Write', args: {}, dependsOn: [] },
    ] });
    const running = controller.runUntilPause();
    await observed;
    expect(signal).toBeDefined();
    await controller.stop();
    expect(signal?.aborted).toBe(true);
    expect((await running).status).toBe('reconciliation_required');
    expect(controller.getStepState('s1')?.status).toBe('unknown');
    await expect(controller.retryStep('s1')).rejects.toThrow(/Cannot retry/);
  });

  it('does not report completed when stop races with the final in-flight write', async () => {
    let entered!: () => void;
    let finish!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const finishing = new Promise<void>((resolve) => { finish = resolve; });
    const controller = new ExecutionController({
      runner: { executeStep: async () => {
        entered();
        await finishing;
        return { status: 'succeeded', output: { id: 'written' } };
      } },
      steps: [{ id: 's1', tool: 'trello.create_card', description: 'Write', args: {}, dependsOn: [] }],
    });
    const running = controller.runUntilPause();
    await started;
    await controller.stop();
    finish();
    expect((await running).status).toBe('stopped');
  });

  it('pauses plan on step failure and allows skip step to proceed to next steps', async () => {
    const steps: PlanStep[] = [
      { id: 's1', tool: 'trello.create_card', description: 'Step 1', args: {}, dependsOn: [] },
      { id: 's2', tool: 'trello.add_member', description: 'Step 2 (fails)', args: {}, dependsOn: ['s1'] },
      { id: 's3', tool: 'slack.send_message', description: 'Step 3', args: {}, dependsOn: ['s1'] },
    ];

    let s2Failed = true;
    const runner = {
      executeStep: vi.fn().mockImplementation(async (step: any) => {
        if (step.id === 's2' && s2Failed) return { status: 'failed', error: { message: 'Not found' } };
        return { status: 'succeeded', output: { ok: true } };
      }),
    };

    const controller = new ExecutionController({ runner: runner as any, steps });
    const run1 = await controller.runUntilPause();
    expect(run1.status).toBe('partial');
    expect(run1.pausedAtStepId).toBe('s2');

    // Skip step s2
    const run2 = await controller.skipStepAndContinue('s2');
    expect(run2.status).toBe('completed');
    expect(controller.getStepState('s2')?.status).toBe('skipped');
    expect(controller.getStepState('s3')?.status).toBe('succeeded');
  });

  it('retries a failed step and continues execution to completion', async () => {
    const steps: PlanStep[] = [
      { id: 'step_1', tool: 'trello.create_card', description: 'Create card', args: {}, dependsOn: [] },
      { id: 'step_2', tool: 'slack.send_message', description: 'Notify', args: {}, dependsOn: ['step_1'] },
    ];

    let attempt = 0;
    const runner = {
      executeStep: vi.fn().mockImplementation(async (step: any) => {
        if (step.id === 'step_1') {
          attempt++;
          if (attempt === 1) {
            return { status: 'failed', error: { message: 'Rate limit' } };
          }
          return { status: 'success', output: { id: 'c1' } };
        }
        return { status: 'success', output: { ok: true } };
      }),
    };

    const controller = new ExecutionController({ runner: runner as any, steps });
    const run1 = await controller.runUntilPause();
    expect(run1.status).toBe('partial');
    expect(run1.pausedAtStepId).toBe('step_1');

    // Retry step_1
    const run2 = await controller.retryStep('step_1');
    expect(run2.status).toBe('completed');
    expect(controller.getStepState('step_1')?.status).toBe('succeeded');
    expect(controller.getStepState('step_2')?.status).toBe('succeeded');
  });

  it('stops execution immediately when stop() is called', async () => {
    const steps: PlanStep[] = [
      { id: 'step_1', tool: 'trello.create_card', description: 'Step 1', args: {}, dependsOn: [] },
      { id: 'step_2', tool: 'slack.send_message', description: 'Step 2', args: {}, dependsOn: [] },
    ];

    const runner = {
      executeStep: vi.fn().mockImplementation(async () => {
        return { status: 'success', output: { ok: true } };
      }),
    };

    const controller = new ExecutionController({ runner: runner as any, steps });
    const stopResult = await controller.stop();
    expect(stopResult.status).toBe('stopped');
  });
});
