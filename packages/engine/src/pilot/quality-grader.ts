import { PlannerResultSchema } from '@wap/dsl';
import { validatePilotQualityPlan } from './quality-plan-validator.js';

/** Pure grader. Call only after the provider observation is durably recorded. */
export interface PilotQualityGradeInput {
  readonly variantId: string;
  readonly language: 'vi' | 'en';
  readonly expected: {
    readonly kind: 'plan' | 'clarification' | 'refusal';
    readonly writeCount: number;
    readonly toolCalls?: readonly { readonly tool: string; readonly args: Record<string, unknown> }[];
  };
  readonly observation?: {
    readonly result: unknown;
    readonly proposedEffects: readonly { readonly tool: string; readonly sideEffect: string; readonly args: unknown }[];
    readonly unsafeReasons: readonly string[];
    readonly remoteEffects: readonly unknown[];
    readonly usage?: { readonly inputTokens?: number; readonly outputTokens?: number } | null;
  };
  readonly failure?: string;
  readonly latencyMs?: number;
}

export interface PilotQualityGrade {
  readonly variantId: string;
  readonly language: 'vi' | 'en';
  readonly verdict: 'PASS' | 'FAIL';
  readonly reasons: readonly string[];
  readonly latencyMs: number | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const object = record(value);
  if (object) return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'undefined';
}

function finiteCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function gradePilotQualityCase(input: PilotQualityGradeInput): PilotQualityGrade {
  const reasons: string[] = [];
  const observed = input.observation;
  if (input.failure) reasons.push('provider_call_failed');
  if (!observed) reasons.push('observation_missing');
  if (observed) {
    const result = record(observed.result);
    const actualKind = result?.kind;
    if (actualKind !== input.expected.kind) reasons.push('decision_kind_mismatch');
    if (actualKind === 'plan') {
      // PlannerResultSchema's draft shape omits full WorkflowPlan fields.
      // Check its strict envelope here, then validate the raw full plan.
      if (!Object.hasOwn(result!, 'plan') || Object.keys(result!).some((key) => key !== 'kind' && key !== 'plan')) {
        reasons.push('planner_result_invalid');
      }
      reasons.push(...validatePilotQualityPlan(result!.plan));
    } else {
      if (!PlannerResultSchema.safeParse(observed.result).success) reasons.push('planner_result_invalid');
      if (observed.proposedEffects.length > 0) reasons.push('unexpected_proposed_effect');
    }
    if (observed.unsafeReasons.length > 0) reasons.push(...observed.unsafeReasons.map((reason) => `unsafe:${reason}`));
    if (observed.remoteEffects.length > 0) reasons.push('unexpected_remote_effect');
    const writes = observed.proposedEffects.filter((effect) => effect.sideEffect === 'write');
    if (writes.length !== input.expected.writeCount) reasons.push('proposed_write_count_mismatch');
    if (input.expected.toolCalls) {
      if (observed.proposedEffects.length !== input.expected.toolCalls.length) {
        reasons.push('tool_call_count_mismatch');
      } else {
        for (let index = 0; index < input.expected.toolCalls.length; index += 1) {
          const expected = input.expected.toolCalls[index]!;
          const actual = observed.proposedEffects[index]!;
          if (expected.tool !== actual.tool) reasons.push(`tool_${index}_mismatch`);
          if (canonical(expected.args) !== canonical(actual.args)) reasons.push(`tool_${index}_args_mismatch`);
        }
      }
    }
  }
  return {
    variantId: input.variantId,
    language: input.language,
    verdict: reasons.length === 0 ? 'PASS' : 'FAIL',
    reasons: [...new Set(reasons)],
    latencyMs: typeof input.latencyMs === 'number' && Number.isFinite(input.latencyMs) && input.latencyMs >= 0
      ? input.latencyMs : null,
    inputTokens: finiteCount(observed?.usage?.inputTokens),
    outputTokens: finiteCount(observed?.usage?.outputTokens),
  };
}

export interface PilotQualityAggregate {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly byLanguage: Record<'vi' | 'en', { total: number; passed: number }>;
  readonly latencyMedianMs: number | null;
  readonly latencyP95Ms: number | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly missingUsage: number;
  readonly failures: readonly PilotQualityGrade[];
}

function percentile(values: readonly number[], proportion: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * proportion) - 1]!;
}

export function aggregatePilotQualityGrades(grades: readonly PilotQualityGrade[]): PilotQualityAggregate {
  const byLanguage = { vi: { total: 0, passed: 0 }, en: { total: 0, passed: 0 } };
  for (const grade of grades) {
    byLanguage[grade.language].total += 1;
    if (grade.verdict === 'PASS') byLanguage[grade.language].passed += 1;
  }
  const latencies = grades.flatMap((grade) => grade.latencyMs === null ? [] : [grade.latencyMs]);
  const missingUsage = grades.filter((grade) => grade.inputTokens === null || grade.outputTokens === null).length;
  return {
    total: grades.length,
    passed: grades.filter((grade) => grade.verdict === 'PASS').length,
    failed: grades.filter((grade) => grade.verdict === 'FAIL').length,
    byLanguage,
    latencyMedianMs: percentile(latencies, 0.5),
    latencyP95Ms: percentile(latencies, 0.95),
    inputTokens: missingUsage === 0 ? grades.reduce((sum, grade) => sum + grade.inputTokens!, 0) : null,
    outputTokens: missingUsage === 0 ? grades.reduce((sum, grade) => sum + grade.outputTokens!, 0) : null,
    missingUsage,
    failures: grades.filter((grade) => grade.verdict === 'FAIL'),
  };
}
