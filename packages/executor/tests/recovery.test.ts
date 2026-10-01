import { describe, expect, it } from 'vitest';
import { ExecutionController, StepRunner, type StepState } from '../src/index.js';
import type { PlanStep } from '@wap/tool-schemas';

const steps: PlanStep[] = [
  { id: 'step_1', tool: 'trello.create_card', description: 'Already created', args: { listId: 'list', title: 'Card' }, dependsOn: [] },
  { id: 'step_2', tool: 'slack.send_message', description: 'Interrupted notification', args: { channel: 'channel', text: 'Before crash' }, dependsOn: ['step_1'] },
  { id: 'step_3', tool: 'slack.send_message', description: 'Next notification', args: {
    channel: { $ref: 'step_1.output.channel' }, text: { $template: 'Card ${step_1.output.id}' },
  }, dependsOn: ['step_1', 'step_2'] },
];

function restored(status: 'unknown' | 'failed', thirdStatus: 'pending' | 'unknown' = 'pending') {
  const calls: { tool: string; args: any }[] = [];
  const initialStates: Record<string, StepState> = {
    step_1: { stepId: 'step_1', status: 'succeeded', output: { id: 'preserved-card', channel: 'preserved-channel' } },
    step_2: { stepId: 'step_2', status, error: { category: status === 'unknown' ? 'UNKNOWN' : 'NOT_FOUND', message: 'Saved failure' } },
    step_3: { stepId: 'step_3', status: thirdStatus },
  };
  const runner = new StepRunner({ getAdapter: () => ({ execute: async (tool, args) => {
    calls.push({ tool, args });
    return { ok: true };
  } }) });
  const controller = new ExecutionController({ runner, steps, initialStates });
  return { controller, calls, initialStates };
}

describe('restoring ExecutionController from durable progress', () => {
  it('skips UNKNOWN and resolves ref/template from saved success without replaying it', async () => {
    const { controller, calls } = restored('unknown');
    expect(await controller.skipStepAndContinue('step_2')).toMatchObject({ status: 'completed' });
    expect(calls).toEqual([{ tool: 'slack.send_message', args: { channel: 'preserved-channel', text: 'Card preserved-card' } }]);
    expect(controller.getStepState('step_1')).toMatchObject({ status: 'succeeded', output: { id: 'preserved-card' } });
  });

  it('does not dispatch a saved UNKNOWN even through runUntilPause', async () => {
    const { controller, calls } = restored('unknown');
    expect(await controller.runUntilPause()).toMatchObject({ status: 'reconciliation_required', pausedAtStepId: 'step_2' });
    await expect(controller.retryStep('step_2')).rejects.toThrow(/Cannot retry/);
    expect(calls).toEqual([]);
  });

  it('requires an explicit retry of known failure and never replays saved success', async () => {
    const { controller, calls } = restored('failed');
    expect(await controller.runUntilPause()).toMatchObject({ status: 'partial', pausedAtStepId: 'step_2' });
    expect(calls).toEqual([]);
    expect(await controller.retryStep('step_2')).toMatchObject({ status: 'completed' });
    expect(calls.map(call => call.args.text)).toEqual(['Before crash', 'Card preserved-card']);
  });

  it('stops at another saved UNKNOWN after skipping the first', async () => {
    const { controller, calls } = restored('unknown', 'unknown');
    expect(await controller.skipStepAndContinue('step_2')).toMatchObject({ status: 'reconciliation_required', pausedAtStepId: 'step_3' });
    expect(calls).toEqual([]);
  });

  it('rejects restoring running progress that has not been reconciled', () => {
    expect(() => new ExecutionController({
      runner: { executeStep: async () => ({ status: 'succeeded' }) }, steps,
      initialStates: { step_1: { stepId: 'step_1', status: 'running' } },
    })).toThrow(/running/);
  });
});
