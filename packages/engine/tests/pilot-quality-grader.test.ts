import { describe, expect, it } from 'vitest';
import { aggregatePilotQualityGrades, gradePilotQualityCase } from '../src/pilot/quality-grader.js';

const expected = {
  kind: 'plan' as const,
  writeCount: 1,
  toolCalls: [{ tool: 'trello.create_card', args: { boardId: 'board-1', title: 'Task' } }],
};

describe('pilot provider observation grader', () => {
  it('passes only an exact, safe proposal with no remote effect', () => {
    const grade = gradePilotQualityCase({
      variantId: 'V2-01-vi', language: 'vi', expected,
      observation: {
        result: { kind: 'plan' },
        proposedEffects: [{ tool: 'trello.create_card', sideEffect: 'write', args: { title: 'Task', boardId: 'board-1' } }],
        unsafeReasons: [], remoteEffects: [], usage: { inputTokens: 10, outputTokens: 5 },
      },
      latencyMs: 50,
    });
    expect(grade).toMatchObject({ verdict: 'PASS', reasons: [], inputTokens: 10, outputTokens: 5 });
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
