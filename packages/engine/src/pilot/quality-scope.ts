export function pilotQualityHoldoutFile(profile?: string): string {
  return profile === 'model-only-v1' ? 'ai-holdout-v1.json' : 'holdout.json';
}

/** Dataset integrity only. Oracle fields never cross the model boundary. */
export function assertPilotModelFixtureCompatible(testCase: {
  readonly caseId?: unknown; readonly fault?: unknown;
  readonly sourceFixture: { readonly headers: readonly unknown[]; readonly rows: readonly unknown[]; readonly requestId: string };
  readonly expected: { readonly kind: string; readonly writeCount: number };
}, dataset: 'public' | 'holdout'): void {
  const scope = classifyPilotModelQualityCase(testCase, dataset);
  if (!scope.eligible) throw new Error('QUALITY_CASE_OUTSIDE_MODEL_SCOPE');
  let row;
  try {
    row = parseRequest([testCase.sourceFixture.headers, ...testCase.sourceFixture.rows], testCase.sourceFixture.requestId);
  } catch (error) {
    if (error instanceof Error && (error.message === 'NOT_FOUND' || error.message === 'REQUEST_TYPE') &&
        scope.group === 'source-refusal-compliance' && testCase.expected.kind === 'refusal' && testCase.expected.writeCount === 0) return;
    throw new Error('QUALITY_SOURCE_CONTRACT_MISMATCH');
  }
  if (scope.group === 'source-refusal-compliance' ||
      (testCase.expected.writeCount > 0 && evaluateChecklist(row).status !== 'pass')) {
    throw new Error('QUALITY_SOURCE_CONTRACT_MISMATCH');
  }
}

export function classifyPilotModelQualityCase(testCase: { readonly caseId?: unknown; readonly fault?: unknown }, dataset: 'public' | 'holdout'):
  { eligible: boolean; group: 'model-reasoning' | 'source-refusal-compliance' | null; reason: string | null } {
  const id = testCase.caseId;
  if (testCase.fault !== 'none' || (dataset === 'public' && typeof id === 'string' && /^V2-(?:1[3-9])$/.test(id))) {
    return { eligible: false, group: null, reason: 'SYSTEM_ACCEPTANCE_ONLY' };
  }
  const recognized = typeof id === 'string' && (dataset === 'public'
    ? /^V2-(?:0[1-9]|1[0-2]|20)$/.test(id) : /^H-(?:0[1-9]|10)$/.test(id));
  if (!recognized) return { eligible: false, group: null, reason: 'CASE_OUTSIDE_MODEL_SCOPE' };
  return { eligible: true,
    group: dataset === 'public' && (id === 'V2-11' || id === 'V2-20') ? 'source-refusal-compliance' : 'model-reasoning',
    reason: null };
}
import { parseRequest } from './source.js';
import { evaluateChecklist } from './checklist.js';
