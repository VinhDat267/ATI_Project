import { describe, it, expect } from 'vitest';
import { StepRunner } from '../src/index.js';
import type { PlanStep } from '@wap/tool-schemas';

describe('packages/executor (Task 13: StepRunner with AbortSignal Timeout & UNKNOWN Status)', () => {
  it('halts execution with UNKNOWN when AbortSignal times out on write action', async () => {
    const runner = new StepRunner({
      getAdapter: () => ({
        execute: async (_tool: string, _args: any, options?: { signal?: AbortSignal }) => {
          return new Promise((_, reject) => {
            options?.signal?.addEventListener('abort', () => reject(new Error('Timeout')));
          });
        },
      }),
    });

    const step: PlanStep = {
      id: 'step_write',
      tool: 'trello.create_card',
      description: 'Create card',
      args: { title: 'Test' },
      dependsOn: [],
    };

    const result = await runner.executeStep(step, new Map(), { timeoutMs: 20 });
    expect(result.status).toBe('unknown');
    expect(result.error?.category).toBe('NETWORK');
    expect(result.output).toBeNull();
  });

  it('halts execution with FAILED when AbortSignal times out on read action', async () => {
    const runner = new StepRunner({
      getAdapter: () => ({
        execute: async (_tool: string, _args: any, options?: { signal?: AbortSignal }) => {
          return new Promise((_, reject) => {
            options?.signal?.addEventListener('abort', () => reject(new Error('Timeout')));
          });
        },
      }),
    });

    const step: PlanStep = {
      id: 'step_read',
      tool: 'trello.search_cards',
      description: 'Search cards',
      args: { query: 'test', limit: 5 },
      dependsOn: [],
    };

    const result = await runner.executeStep(step, new Map(), { timeoutMs: 20 });
    expect(result.status).toBe('failed');
    expect(result.error?.category).toBe('NETWORK');
    expect(result.output).toBeNull();
  });

  it('executes step successfully and resolves arguments from previous step outputs', async () => {
    let receivedArgs: any;
    const runner = new StepRunner({
      getAdapter: () => ({
        execute: async (_tool: string, args: any) => {
          receivedArgs = args;
          return { id: 'card_done', url: 'https://trello.com/c/done' };
        },
      }),
    });

    const stepOutputs = new Map<string, any>([
      ['step_1', { id: 'list_999' }],
    ]);

    const step: PlanStep = {
      id: 'step_2',
      tool: 'trello.create_card',
      description: 'Create card using resolved listId',
      args: { listId: { $ref: 'step_1.output.id' }, title: 'New Task' },
      dependsOn: ['step_1'],
    };

    const result = await runner.executeStep(step, stepOutputs, { timeoutMs: 1000 });
    expect(result.status).toBe('success');
    expect(result.error).toBeNull();
    expect(result.output).toEqual({ id: 'card_done', url: 'https://trello.com/c/done' });
    expect(receivedArgs.listId).toBe('list_999');
  });

  it('preserves error category when adapter throws StepError', async () => {
    const runner = new StepRunner({
      getAdapter: () => ({
        execute: async () => {
          const err: any = new Error('Invalid credentials');
          err.category = 'AUTH_ERROR';
          throw err;
        },
      }),
    });

    const step: PlanStep = {
      id: 'step_auth_fail',
      tool: 'trello.get_card',
      description: 'Get card with bad credentials',
      args: { cardId: 'c1' },
      dependsOn: [],
    };

    const result = await runner.executeStep(step, new Map());
    expect(result.status).toBe('failed');
    expect(result.error?.category).toBe('AUTH_ERROR');
  });

  it('preserves an ambiguous GitHub write outcome for reconciliation', async () => {
    const runner = new StepRunner({ getAdapter: () => ({ execute: async () => {
      throw Object.assign(new Error('GitHub write response was lost'), { category: 'UNKNOWN' });
    } }) });
    const result = await runner.executeStep({
      id: 'issue', tool: 'github.create_issue', description: 'Create issue',
      args: { repo: 'owner/repo', title: 'Release' }, dependsOn: [],
    }, new Map());
    expect(result.status).toBe('unknown');
    expect(result.error?.category).toBe('UNKNOWN');
  });
});
