import { describe, expect, it, vi } from 'vitest';
import type { PlanStep } from '@wap/tool-schemas';
import { coerceStringParams } from '../src/resolver.js';
import { StepRunner } from '../src/index.js';

describe('Backend Audit Hardening — Executor (Task 3)', () => {
  it('marks write step failed (never unknown) with requestSent=false when $ref resolution fails before dispatch', async () => {
    const executeSpy = vi.fn();
    const runner = new StepRunner({
      getAdapter: () => ({ execute: executeSpy }),
    });

    const writeStep: PlanStep = {
      id: 'step_write',
      tool: 'trello.create_card',
      description: 'Create card using missing ref',
      args: { listId: { $ref: 'step_missing.output.id' }, title: 'Test card' },
      dependsOn: ['step_missing'],
    };

    const result = await runner.executeStep(writeStep, new Map());
    expect(result.status).toBe('failed');
    expect(result.error?.details?.requestSent).toBe(false);
    expect(executeSpy).not.toHaveBeenCalled();

    const stepOutputs = new Map<string, any>([['step_1', { id: 'card_1' }]]);
    const propMissingStep: PlanStep = {
      id: 'step_write_2',
      tool: 'github.create_issue',
      description: 'Create issue using missing nested ref prop',
      args: { repo: 'team/project', title: { $ref: 'step_1.output.nonExistent' } },
      dependsOn: ['step_1'],
    };
    const result2 = await runner.executeStep(propMissingStep, stepOutputs);
    expect(result2.status).toBe('failed');
    expect(result2.error?.details?.requestSent).toBe(false);
  });

  it('marks write step failed (never unknown) with requestSent=false when getAdapter throws or returns undefined', async () => {
    const runnerThrowing = new StepRunner({
      getAdapter: async () => {
        throw new Error('OAuth token endpoint unreachable');
      },
    });
    const writeStep: PlanStep = {
      id: 'step_write',
      tool: 'github.create_issue',
      description: 'Create issue',
      args: { repo: 'team/project', title: 'Hello' },
      dependsOn: [],
    };
    const res1 = await runnerThrowing.executeStep(writeStep, new Map());
    expect(res1.status).toBe('failed');
    expect(res1.error?.details?.requestSent).toBe(false);

    const runnerMissing = new StepRunner({
      getAdapter: async () => undefined as any,
    });
    const res2 = await runnerMissing.executeStep(writeStep, new Map());
    expect(res2.status).toBe('failed');
    expect(res2.error?.details?.requestSent).toBe(false);
  });

  it('deduplicates myjira.create_issue against preceding myjira.search_issues step output preserving siteId', async () => {
    const executeSpy = vi.fn();
    const runner = new StepRunner({
      getAdapter: () => ({ execute: executeSpy }),
    });

    const stepOutputs = new Map<string, any>([
      [
        'step_search',
        {
          issues: [
            {
              siteId: 'site-1',
              id: '10099',
              key: 'ATI-99',
              url: 'https://ati.atlassian.net/browse/ATI-99',
              title: 'SSO login fails on iOS',
              status: 'To Do',
            },
          ],
        },
      ],
    ]);

    const createStep: PlanStep = {
      id: 'step_create',
      tool: 'myjira.create_issue',
      description: 'Create Jira bug if missing',
      args: {
        siteId: 'site-1',
        projectKey: 'ATI',
        summary: 'SSO login fails on iOS',
        description: 'Reproduced on staging',
        issueType: 'Bug',
      },
      dependsOn: ['step_search'],
    };

    const res = await runner.executeStep(createStep, stepOutputs);
    expect(res.status).toBe('success');
    expect(res.output).toEqual({
      siteId: 'site-1',
      id: '10099',
      key: 'ATI-99',
      url: 'https://ati.atlassian.net/browse/ATI-99',
    });
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it('coerceStringParams supports union types, stringifies primitives, and parses numeric strings for number/integer $ref params', () => {
    const schema = {
      properties: {
        title: { type: ['string', 'null'] },
        note: { type: 'string' },
        issueNumber: { type: 'integer' },
        score: { type: 'number' },
      },
    };

    const coerced = coerceStringParams(
      {
        title: { $ref: 's1.output.items' },
        note: { $ref: 's1.output.count' },
        issueNumber: { $ref: 's1.output.issueNumStr' },
        score: { $ref: 's1.output.scoreStr' },
      },
      {
        title: [{ title: 'Alpha' }],
        note: 42,
        issueNumber: '123',
        score: '9.5',
      },
      schema,
    );

    expect(typeof coerced.title).toBe('string');
    expect(coerced.title).toContain('Alpha');
    expect(coerced.note).toBe('42');
    expect(coerced.issueNumber).toBe(123);
    expect(coerced.score).toBe(9.5);
  });
});
