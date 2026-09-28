import { describe, it, expect } from 'vitest';
import { runEvaluations } from './evaluator.js';

describe('Evaluation Framework & Quality Gate', () => {
  it('enforces quality gate thresholds on golden dataset', async () => {
    const results = await runEvaluations({ useMock: true });
    expect(results.totalPrompts).toBe(50);
    expect(results.syntaxValidRate).toBe(1.0);
    expect(results.happyPathAccuracy).toBeGreaterThanOrEqual(0.85);
    expect(results.edgeCaseAccuracy).toBeGreaterThanOrEqual(0.70);
  });
});
