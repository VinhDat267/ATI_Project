import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { PlanStep } from '@wap/tool-schemas';
import type { StepState } from '@wap/executor';
import type { PlanRow } from '../db/repositories/plan-repo.js';
import type { ExecutionStepRow } from '../db/repositories/step-repo.js';

export function recoveryConflict(message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status: 409 });
}

export function verifiedRecoverySteps(plan: PlanRow): PlanStep[] {
  try {
    const parsed = typeof plan.plan_json === 'string' ? JSON.parse(plan.plan_json) : plan.plan_json;
    const text = plan.plan_text ?? JSON.stringify(parsed);
    if (createHash('sha256').update(text).digest('hex') !== plan.plan_hash || !isDeepStrictEqual(JSON.parse(text), parsed)) {
      throw new Error('Plan integrity mismatch');
    }
    if (!Array.isArray(parsed.steps) || !parsed.steps.length) throw new Error('No executable steps');
    const ids = new Set<string>();
    for (const step of parsed.steps) {
      if (!step || typeof step.id !== 'string' || typeof step.tool !== 'string' || ids.has(step.id)) throw new Error('Invalid steps');
      ids.add(step.id);
    }
    return parsed.steps;
  } catch {
    throw recoveryConflict('Cannot recover execution: approved plan integrity check failed');
  }
}

export function restoredProgress(steps: PlanStep[], rows: ExecutionStepRow[]) {
  if (rows.length !== steps.length) throw recoveryConflict('Cannot recover an incomplete execution snapshot; Stop is available');
  const byId = new Map(rows.map(row => [row.step_id, row]));
  if (byId.size !== rows.length) throw recoveryConflict('Cannot recover duplicate execution steps');
  const states: Record<string, StepState> = Object.create(null);
  const dbIds = new Map<string, string>();
  for (const step of steps) {
    const row = byId.get(step.id);
    if (!row || row.tool !== step.tool || !['pending', 'succeeded', 'skipped', 'failed', 'unknown'].includes(row.status)) {
      throw recoveryConflict('Cannot recover unmatched or unreconciled execution steps');
    }
    states[step.id] = { stepId: step.id, status: row.status as StepState['status'], output: row.output_json, error: row.error_json };
    dbIds.set(step.id, row.id);
  }
  return { states, dbIds };
}

export function validateRecoveryAction(status: string, states: Record<string, StepState>, stepId: string, action: 'retry' | 'skip') {
  if (status === 'reconciliation_required' && !Object.values(states).some(state => state.status === 'unknown')) {
    throw recoveryConflict('This reconciled execution can only be stopped');
  }
  const state = states[stepId];
  if (!state || (action === 'retry' ? state.status !== 'failed' : !['failed', 'unknown'].includes(state.status))) {
    throw recoveryConflict(action === 'retry' ? 'Cannot retry a step unless its failure is known' : 'Cannot skip a step unless it failed or has an unknown outcome');
  }
}
