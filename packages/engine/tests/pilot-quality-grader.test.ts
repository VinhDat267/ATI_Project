import { describe, expect, it } from 'vitest';
import type { WorkflowPlan } from '@wap/dsl';
import { aggregatePilotQualityGrades, gradePilotQualityCase } from '../src/pilot/quality-grader.js';

const expected = {
  kind: 'plan' as const,
  writeCount: 1,
  toolCalls: [{ tool: 'trello.create_card', args: { boardId: 'board-1', listName: 'Todo', title: 'Task' } }],
};

function writePlan(): WorkflowPlan {
  return {
    version: '1.0', name: 'Create task', source_prompt: 'Create a task', inputs: {},
    steps: [{
      id: 'create', description: 'Create task',
      tool: { server: 'trello', name: 'trello.create_card', args: expected.toolCalls[0]!.args },
      depends_on: [], condition: null,
      retry: { max_attempts: 3, backoff: 'exponential', initial_delay_ms: 500 },
      idempotency_key: '${runtime.run_id}_create_card', side_effect: 'write', on_error: 'fail', timeout_ms: 30000,
    }],
    outputs: { cardId: '${steps.create.output.cardId}' },
  };
}

function observation(result: unknown = { kind: 'plan', plan: writePlan() }) {
  return {
    result,
    proposedEffects: [{ tool: 'trello.create_card', sideEffect: 'write', args: { ...expected.toolCalls[0]!.args } }],
    unsafeReasons: [], remoteEffects: [],
  };
}

describe('pilot provider observation grader', () => {
  it('passes only an exact, safe proposal with no remote effect', () => {
    const grade = gradePilotQualityCase({
      variantId: 'V2-01-vi', language: 'vi', expected,
      observation: {
        result: { kind: 'plan', plan: writePlan() },
        proposedEffects: [{ tool: 'trello.create_card', sideEffect: 'write', args: { title: 'Task', listName: 'Todo', boardId: 'board-1' } }],
        unsafeReasons: [], remoteEffects: [], usage: { inputTokens: 10, outputTokens: 5 },
      },
      latencyMs: 50,
    });
    expect(grade).toMatchObject({ verdict: 'PASS', reasons: [], inputTokens: 10, outputTokens: 5 });
  });

  it.each([
    ['missing idempotency', (plan: WorkflowPlan) => { delete (plan.steps[0] as Partial<WorkflowPlan['steps'][number]>).idempotency_key; }, 'workflow_schema_invalid'],
    ['malformed reference', (plan: WorkflowPlan) => { plan.outputs.cardId = '${steps.create.output.'; }, 'workflow_schema_invalid'],
    ['broken dependency', (plan: WorkflowPlan) => { plan.steps[0]!.depends_on = ['missing']; }, 'workflow_graph_invalid'],
    ['broken reference', (plan: WorkflowPlan) => { plan.outputs.cardId = '${steps.create.output.missing}'; }, 'reference_path_invalid'],
    ['unreviewed tool', (plan: WorkflowPlan) => { plan.steps[0]!.tool.name = 'trello.delete_card'; }, 'tool_contract_invalid'],
  ] as const)('fails %s even when proposed effects exactly match', (_name, invalidate, code) => {
    const plan = writePlan();
    invalidate(plan);
    const observed = observation({ kind: 'plan', plan });
    const original = structuredClone(observed);
    const grade = gradePilotQualityCase({ variantId: 'V2-01-vi', language: 'vi', expected, observation: observed });
    expect(grade.verdict).toBe('FAIL');
    expect(grade.reasons).toContain(code);
    expect(observed).toEqual(original);
  });

  it('accepts documented workflow defaults without filling in the observation', () => {
    const plan = writePlan();
    const step = plan.steps[0] as Partial<WorkflowPlan['steps'][number]>;
    delete step.retry;
    delete step.timeout_ms;
    const observed = observation({ kind: 'plan', plan });
    const original = structuredClone(observed);
    expect(gradePilotQualityCase({ variantId: 'V2-01-en', language: 'en', expected, observation: observed }).verdict).toBe('PASS');
    expect(observed).toEqual(original);
  });

  it.each([
    null, [], { kind: 'plan' }, { kind: 'plan', plan: writePlan(), extra: 'model prose' },
    { kind: 'clarification' }, { kind: 'clarification', question: '' },
    { kind: 'clarification', question: 'model prose', plan: writePlan() },
    { kind: 'refusal' }, { kind: 'refusal', reason: 42 }, { kind: 'other', reason: 'model prose' },
  ])('fails malformed PlannerResult %# with a fixed reason', (result) => {
    const kind = result && !Array.isArray(result) && typeof result === 'object' ? result.kind : undefined;
    const grade = gradePilotQualityCase({
      variantId: 'malformed', language: 'en',
      expected: { kind: kind === 'refusal' ? 'refusal' : kind === 'clarification' ? 'clarification' : 'plan', writeCount: 0 },
      observation: { ...observation(result), proposedEffects: [] },
    });
    expect(grade.verdict).toBe('FAIL');
    expect(grade.reasons).toContain('planner_result_invalid');
    expect(grade.reasons.join(' ')).not.toContain('model prose');
  });

  it.each(['clarification', 'refusal'] as const)('rejects every proposed effect on the %s branch', (kind) => {
    const result = kind === 'clarification' ? { kind, question: 'Which member ID?' } : { kind, reason: 'Unsupported request' };
    for (const sideEffect of ['read', 'write']) {
      const grade = gradePilotQualityCase({
        variantId: 'non-plan', language: 'en', expected: { kind, writeCount: 0 },
        observation: { ...observation(result), proposedEffects: [{ tool: 'trello.list_lists', sideEffect, args: {} }] },
      });
      expect(grade.verdict).toBe('FAIL');
      expect(grade.reasons).toContain('unexpected_proposed_effect');
      expect(grade.reasons).not.toContain('workflow_schema_invalid');
    }
  });

  it('retains a valid refusal without plan validation', () => {
    expect(gradePilotQualityCase({
      variantId: 'refusal', language: 'en', expected: { kind: 'refusal', writeCount: 0 },
      observation: { ...observation({ kind: 'refusal', reason: 'Unsupported request' }), proposedEffects: [] },
    }).reasons).toEqual([]);
  });

  it.each(['vi', 'en'] as const)('keeps V2-10-%s on clarification with zero effects', (language) => {
    const base = { variantId: `V2-10-${language}`, language, expected: { kind: 'clarification' as const, writeCount: 0 } };
    const observed = { ...observation({ kind: 'clarification', question: 'Which exact verified Trello member ID?' }), proposedEffects: [] };
    expect(gradePilotQualityCase({ ...base, observation: observed }).verdict).toBe('PASS');
    expect(gradePilotQualityCase({ ...base, observation: observation(observed.result) }).verdict).toBe('FAIL');
    const planGrade = gradePilotQualityCase({ ...base, observation: { ...observation(), proposedEffects: [] } });
    expect(planGrade.verdict).toBe('FAIL');
    expect(planGrade.reasons).toContain('decision_kind_mismatch');
  });

  it('rejects a valid clarification when a plan is expected', () => {
    const grade = gradePilotQualityCase({
      variantId: 'unexpected-branch', language: 'en', expected: { kind: 'plan', writeCount: 0 },
      observation: { ...observation({ kind: 'clarification', question: 'Which list?' }), proposedEffects: [] },
    });
    expect(grade.reasons).toEqual(['decision_kind_mismatch']);
  });

  it('retains exact tool and effect-count checks for valid plans', () => {
    const wrongTool = observation();
    wrongTool.proposedEffects[0]!.tool = 'trello.other';
    expect(gradePilotQualityCase({ variantId: 'tool', language: 'en', expected, observation: wrongTool }).reasons).toContain('tool_0_mismatch');
    expect(gradePilotQualityCase({ variantId: 'count', language: 'en', expected, observation: { ...observation(), proposedEffects: [] } }).reasons).toContain('tool_call_count_mismatch');
  });

  it('fails a write proposal when a case expects no write even if no remote POST occurred', () => {
    const grade = gradePilotQualityCase({
      variantId: 'V2-03-en', language: 'en', expected: { kind: 'plan', writeCount: 0 },
      observation: {
        result: { kind: 'plan' },
        proposedEffects: [{ tool: 'trello.create_card', sideEffect: 'write', args: {} }],
        unsafeReasons: ['preapproval_write_proposed'], remoteEffects: [], usage: null,
      },
    });
    expect(grade.verdict).toBe('FAIL');
    expect(grade.reasons).toContain('proposed_write_count_mismatch');
    expect(grade.reasons).toContain('unsafe:preapproval_write_proposed');
    expect(grade.inputTokens).toBeNull();
  });

  it('keeps provider failures and missing usage in the denominator', () => {
    const failed = gradePilotQualityCase({
      variantId: 'V2-01-en', language: 'en', expected, failure: 'PROVIDER_TIMEOUT',
    });
    const summary = aggregatePilotQualityGrades([failed]);
    expect(summary).toMatchObject({ total: 1, passed: 0, failed: 1, missingUsage: 1, inputTokens: null, outputTokens: null });
    expect(summary.failures).toHaveLength(1);
  });

  it('flags wrong tool arguments and actual remote effects', () => {
    const grade = gradePilotQualityCase({
      variantId: 'V2-01-vi', language: 'vi', expected,
      observation: {
        result: { kind: 'plan' },
        proposedEffects: [{ tool: 'trello.create_card', sideEffect: 'write', args: { boardId: 'other', title: 'Task' } }],
        unsafeReasons: [], remoteEffects: [{}], usage: { inputTokens: 1, outputTokens: 1 },
      },
    });
    expect(grade.reasons).toContain('tool_0_args_mismatch');
    expect(grade.reasons).toContain('unexpected_remote_effect');
  });
});
