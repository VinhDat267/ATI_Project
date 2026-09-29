import { describe, it, expect } from 'vitest';
import { runEvaluations } from './evaluator.js';
import { MockLLMProvider } from '@wap/planner';

describe('Evaluation Framework & Quality Gate', () => {
  it('labels expected-answer fixtures as offline diagnostics with no live quality gate', async () => {
    const results = await runEvaluations({ useMock: true });
    expect(results.totalPrompts).toBe(50);
    expect(results.evidence).toBe('offline_fixture');
    expect(results.qualityGate).toBe('not_run');
    expect(results.argumentQualityRate).toBeNull();
    expect(results.details).toHaveLength(50);
  });

  it('requires an actual provider for live evaluation', async () => {
    await expect(runEvaluations({ useMock: false })).rejects.toThrow(/provider/i);
    await expect(runEvaluations({ useMock: false, provider: new MockLLMProvider() }))
      .rejects.toThrow(/mock provider/i);
  });
});
