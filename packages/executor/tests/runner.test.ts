import { describe, it, expect } from 'vitest';
import { StepRunner, isWriteTool } from '../src/index.js';
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

  it('forwards bound step.repo into adapter execution context', async () => {
    let receivedContext: Record<string, any> | undefined;
    const runner = new StepRunner({
      getAdapter: () => ({
        execute: async (_tool: string, _args: any, context?: Record<string, any>) => {
          receivedContext = context;
          return { id: '1', number: 1, title: 'Release', url: 'https://github.com/owner/repo/issues/1', repo: 'owner/repo' };
        },
      }),
    });
    const step = {
      id: 'issue',
      tool: 'github.create_issue',
      description: 'Create issue',
      args: { repo: 'owner/repo', title: 'Release' },
      repo: 'owner/repo',
      dependsOn: [],
    } as PlanStep;
    const result = await runner.executeStep(step, new Map());
    expect(result.status).toBe('success');
    expect(receivedContext?.repo).toBe('owner/repo');
  });
});

describe('Gmail tools are classified from the Gmail catalog, not the name heuristic', () => {
  it.each(['gmail.reply', 'gmail.forward', 'gmail.trash_thread', 'gmail.modify_thread_labels', 'gmail.send_message', 'gmail.create_draft', 'gmail.create_label'])(
    '%s is a write tool even though GMAIL_TOOLS is not in ALL_TOOLS', (tool) => {
      expect(isWriteTool(tool)).toBe(true);
    });

  it.each(['gmail.search_threads', 'gmail.get_thread', 'gmail.list_labels'])('%s is a read tool', (tool) => {
    expect(isWriteTool(tool)).toBe(false);
  });

  it('marks a timed-out gmail.reply UNKNOWN instead of a retryable failure', async () => {
    const runner = new StepRunner({
      getAdapter: () => ({
        execute: async (_tool: string, _args: any, options?: { signal?: AbortSignal }) => new Promise((_, reject) => {
          options?.signal?.addEventListener('abort', () => reject(new Error('Timeout')));
        }),
      }),
    });
    const step: PlanStep = { id: 'reply', tool: 'gmail.reply', description: 'Reply', args: { threadId: 't1', to: ['a@example.com'], body: 'Hi' }, dependsOn: [] };
    const result = await runner.executeStep(step, new Map(), { timeoutMs: 20 });
    expect(result.status).toBe('unknown');
  });

  it('deduplicates jira.create_issue only within the same target projectKey and does not reuse an issue from another project', async () => {
    let adapterCalled = false;
    const runner = new StepRunner({
      getAdapter: async () => ({
        execute: async (_tool: string, args: any) => {
          adapterCalled = true;
          return { id: '200', key: `${args.projectKey}-1`, url: `https://example.atlassian.net/browse/${args.projectKey}-1` };
        },
      }),
    });

    const crossProjectResult = await runner.executeStep(
      {
        id: 'create-in-b',
        tool: 'jira.create_issue',
        description: 'Create a copy in project NEW',
        args: { projectKey: 'NEW', summary: 'Same title', description: 'New content' },
        dependsOn: ['search-old'],
      },
      new Map([
        ['search-old', { issues: [{ id: '100', key: 'OLD-1', title: 'Same title', url: 'https://example.atlassian.net/browse/OLD-1' }] }],
      ]),
    );
    expect(adapterCalled).toBe(true);
    expect(crossProjectResult.status).toBe('success');
    expect(crossProjectResult.output).toEqual({ id: '200', key: 'NEW-1', url: 'https://example.atlassian.net/browse/NEW-1' });

    adapterCalled = false;
    const sameProjectResult = await runner.executeStep(
      {
        id: 'create-in-old',
        tool: 'jira.create_issue',
        description: 'Create in OLD',
        args: { projectKey: 'OLD', summary: 'Same title', description: 'Same project' },
        dependsOn: ['search-old'],
      },
      new Map([
        ['search-old', { issues: [{ id: '100', key: 'OLD-1', title: 'Same title', url: 'https://example.atlassian.net/browse/OLD-1' }] }],
      ]),
    );
    expect(adapterCalled).toBe(false);
    expect(sameProjectResult.output).toEqual({ id: '100', key: 'OLD-1', url: 'https://example.atlassian.net/browse/OLD-1' });
  });
});
