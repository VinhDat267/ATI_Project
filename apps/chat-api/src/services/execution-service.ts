import type { PlanRepo, PlanRow } from '../db/repositories/plan-repo.js';
import type { StepRepo } from '../db/repositories/step-repo.js';
import type { CredentialRepo } from '../db/repositories/credential-repo.js';
import { StepRunner, ExecutionController, type StepState } from '@wap/executor';
import type { PlanStep } from '@wap/tool-schemas';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { readableRecoveryPlan, recoveryConflict, restoredProgress, validateRecoveryAction, verifiedRecoverySteps } from './execution-recovery.js';

export interface ApproveResult {
  success: boolean;
  status: number;
  error?: string;
  planId?: string;
}

export interface ExecutionServiceOptions {
  planRepo: PlanRepo;
  stepRepo?: StepRepo;
  convRepo?: {
    getConversation: (id: string) => Promise<any>;
  };
  credentialRepo?: CredentialRepo;
  adapterFactory: {
    getAdapterForService: (serviceName: string) => Promise<any> | any;
  };
  sseManager?: {
    emitEvent: (convId: string, eventName: string, data: any) => void;
  };
}

export class ExecutionService {
  private planRepo: PlanRepo;
  private stepRepo?: StepRepo;
  private convRepo?: ExecutionServiceOptions['convRepo'];
  private adapterFactory: ExecutionServiceOptions['adapterFactory'];
  private sseManager?: ExecutionServiceOptions['sseManager'];
  private activeControllers = new Map<string, ExecutionController>();
  private activeRuns = new Map<string, Promise<unknown>>();
  private queuedStarts = new Set<string>();
  private stopRequests = new Set<string>();
  private executionOutcomes = new Map<string, { status: string; pausedStepId?: string }>();

  constructor(options: ExecutionServiceOptions) {
    this.planRepo = options.planRepo;
    this.stepRepo = options.stepRepo;
    this.convRepo = options.convRepo;
    this.adapterFactory = options.adapterFactory;
    this.sseManager = options.sseManager;
  }

  getPlanRepo(): PlanRepo {
    return this.planRepo;
  }

  private async markExecutionFailed(planId: string, convId: string, err: unknown): Promise<void> {
    this.executionOutcomes.set(planId, { status: 'failed' });
    try {
      await this.planRepo.updatePlanStatus(planId, 'failed');
    } catch (persistError) {
      console.error('Failed to persist failed plan status:', persistError);
    }
    this.sseManager?.emitEvent(convId, 'exec_done', {
      planId, status: 'failed', error: { message: err instanceof Error ? err.message : 'Execution persistence failed' },
    });
  }

  async getOwnedPlan(planId: string, userId: string) {
    const plan = await this.planRepo.getPlan(planId);
    if (!plan) throw Object.assign(new Error('Plan not found'), { status: 404 });
    if (!userId || !this.convRepo) throw Object.assign(new Error('Ownership verification unavailable'), { status: 403 });
    const conversation = await this.convRepo.getConversation(plan.conv_id);
    if (!conversation || conversation.user_id !== userId) {
      throw Object.assign(new Error('Forbidden: you do not own this plan'), { status: 403 });
    }
    return plan;
  }

  async approveAndStart(planId: string, userId: string): Promise<ApproveResult> {
    let planRow;
    try {
      planRow = await this.getOwnedPlan(planId, userId);
    } catch (err: any) {
      return { success: false, status: err.status || 500, error: err.message };
    }

    // Check expiration
    if (planRow.expires_at && new Date(planRow.expires_at).getTime() < Date.now()) {
      return {
        success: false,
        status: 410,
        error: 'Plan has expired',
      };
    }

    let planJson: any;
    try {
      planJson = typeof planRow.plan_json === 'string' ? JSON.parse(planRow.plan_json) : planRow.plan_json;
      const planText = planRow.plan_text || JSON.stringify(planJson);
      const actualHash = createHash('sha256').update(planText).digest('hex');
      if (actualHash !== planRow.plan_hash || !isDeepStrictEqual(JSON.parse(planText), planJson)) {
        return { success: false, status: 409, error: 'Plan integrity check failed' };
      }
    } catch {
      return { success: false, status: 409, error: 'Plan integrity check failed' };
    }

    // 1. Optimistic Locking: only succeeds if current status is 'pending' and not expired
    const approved = await this.planRepo.approvePlan(planId, planRow.plan_hash, userId);
    if (!approved) {
      return {
        success: false,
        status: 409,
        error: 'Plan is already approved, rejected, or expired',
      };
    }

    const convId = planRow.conv_id;
    const steps: PlanStep[] = planJson?.steps || [];

    // Emit exec_start
    this.sseManager?.emitEvent(convId, 'exec_start', { planId });

    // Launch background execution
    this.queuedStarts.add(planId);
    setImmediate(() => {
      const run = this.executePlan(convId, planId, steps, userId);
      this.activeRuns.set(planId, run);
      this.queuedStarts.delete(planId);
      run.catch((err) => {
        this.sseManager?.emitEvent(convId, 'error', {
          planId,
          message: err?.message || 'Unexpected execution error',
        });
      }).finally(() => {
        if (this.activeRuns.get(planId) === run) this.activeRuns.delete(planId);
        this.stopRequests.delete(planId);
      });
    });

    return {
      success: true,
      status: 200,
      planId,
    };
  }

  private buildController(convId: string, planId: string, steps: PlanStep[], dbIds: Map<string, string>, initialStates?: Record<string, StepState>) {
    return new ExecutionController({
      runner: new StepRunner({ getAdapter: serviceName => this.adapterFactory.getAdapterForService(serviceName) }),
      steps, initialStates,
      onStepUpdate: async (stepId, state) => {
        const dbId = dbIds.get(stepId);
        if (dbId && this.stepRepo) await this.stepRepo.updateStepStatus(dbId, state.status, state.output, state.error);
        this.sseManager?.emitEvent(convId, 'exec_step', {
          planId, stepId, status: state.status, output: state.output, error: state.error,
        });
      },
    });
  }

  private async restoreController(plan: PlanRow, userId: string, stepId: string, action: 'retry' | 'skip' | 'continue') {
    if (!['partial', 'reconciliation_required'].includes(plan.status) || !this.stepRepo?.listSteps || !this.planRepo.claimRecovery) {
      throw recoveryConflict('Reconciliation required: execution controller is unavailable');
    }
    const steps = verifiedRecoverySteps(plan);
    const before = restoredProgress(steps, await this.stepRepo.listSteps(plan.id));
    validateRecoveryAction(plan.status, before.states, stepId, action);
    if (!await this.planRepo.claimRecovery(plan, userId, 'executing')) {
      throw recoveryConflict('Execution changed or recovery is already running');
    }
    try {
      // Read progress after the CAS: a stale request must not replay an earlier snapshot.
      const saved = restoredProgress(steps, await this.stepRepo.listSteps(plan.id));
      validateRecoveryAction(plan.status, saved.states, stepId, action);
      const controller = this.buildController(plan.conv_id, plan.id, steps, saved.dbIds, saved.states);
      this.activeControllers.set(plan.id, controller);
      return controller;
    } catch (error) {
      await this.markExecutionFailed(plan.id, plan.conv_id, error);
      throw error;
    }
  }

  private async executePlan(
    convId: string,
    planId: string,
    steps: PlanStep[],
    userId: string
  ): Promise<void> {
    try {
      if (this.stopRequests.has(planId)) return;
      const stepDbIdMap = new Map<string, string>();
      if (this.stepRepo) {
        for (const step of steps) {
          const created = await this.stepRepo.createStep({
            planId, stepId: step.id, tool: step.tool, argsJson: step.args || {}, requestedBy: userId,
          });
          stepDbIdMap.set(step.id, created.id);
        }
      }

      if (this.stopRequests.has(planId)) return;

      const controller = this.buildController(convId, planId, steps, stepDbIdMap);
      this.activeControllers.set(planId, controller);
      const summary = await controller.runUntilPause();
      await this.planRepo.updatePlanStatus(planId, summary.status);
      this.executionOutcomes.set(planId, { status: summary.status, pausedStepId: summary.pausedAtStepId });
      this.sseManager?.emitEvent(convId, 'exec_done', { planId, ...summary });
    } catch (err: any) {
      await this.markExecutionFailed(planId, convId, err);
    }
  }

  async retryStep(planId: string, stepId: string, userId: string): Promise<any> {
    return this.continueStep(planId, stepId, userId, 'retry');
  }

  async skipStep(planId: string, stepId: string, userId: string): Promise<any> {
    return this.continueStep(planId, stepId, userId, 'skip');
  }

  async continueExecution(planId: string, userId: string): Promise<any> {
    const plan = await this.getOwnedPlan(planId, userId);
    if (this.activeRuns.has(planId) || this.activeControllers.get(planId)?.isExecuting()) {
      throw recoveryConflict('Execution is already running');
    }
    const controller = await this.restoreController(plan, userId, '', 'continue');
    this.executionOutcomes.delete(planId);
    this.sseManager?.emitEvent(plan.conv_id, 'exec_start', { planId });
    const run = (async () => {
      try {
        const summary = await controller.runUntilPause();
        await this.planRepo.updatePlanStatus(planId, summary.status);
        this.executionOutcomes.set(planId, { status: summary.status, pausedStepId: summary.pausedAtStepId });
        this.sseManager?.emitEvent(plan.conv_id, 'exec_done', { planId, ...summary });
        return summary;
      } catch (err) {
        await this.markExecutionFailed(planId, plan.conv_id, err);
        throw err;
      }
    })();
    this.activeRuns.set(planId, run);
    try { return await run; }
    finally { if (this.activeRuns.get(planId) === run) this.activeRuns.delete(planId); }
  }

  private async continueStep(planId: string, stepId: string, userId: string, action: 'retry' | 'skip'): Promise<any> {
    let planRow = await this.getOwnedPlan(planId, userId);
    // Include the preceding run's plan-status write in the serialization boundary.
    const priorRun = this.activeRuns.get(planId);
    if (priorRun) {
      await priorRun.catch(() => undefined);
      planRow = await this.getOwnedPlan(planId, userId);
    }
    const status = this.executionOutcomes.get(planId)?.status || planRow.status;
    if (['completed', 'stopped', 'failed', 'pending', 'rejected', 'superseded', 'expired'].includes(status)) {
      throw Object.assign(new Error('Cannot continue a terminal execution'), { status: 409 });
    }
    verifiedRecoverySteps(planRow);
    let controller = this.activeControllers.get(planId);
    if (controller?.isStopped()) {
      this.activeControllers.delete(planId);
      controller = undefined;
    }
    if (!controller) controller = await this.restoreController(planRow, userId, stepId, action);
    if (controller.isExecuting()) {
      throw Object.assign(new Error('Execution is already running'), { status: 409 });
    }
    validateRecoveryAction(status, controller.getAllStepStates(), stepId, action);
    this.executionOutcomes.delete(planId);
    const convId = planRow?.conv_id || '';
    const run = (async () => {
      let summary;
      try {
        summary = action === 'retry'
          ? await controller.retryStep(stepId)
          : await controller.skipStepAndContinue(stepId);
      } catch (err) {
        if (controller.getStepState(stepId)?.error === err) await this.markExecutionFailed(planId, convId, err);
        throw err;
      }
      try {
        await this.planRepo.updatePlanStatus(planId, summary.status);
      } catch (err) {
        await this.markExecutionFailed(planId, convId, err);
        throw err;
      }
      this.executionOutcomes.set(planId, { status: summary.status, pausedStepId: summary.pausedAtStepId });
      if (convId && this.sseManager) {
        this.sseManager.emitEvent(convId, 'exec_done', {
          planId,
          status: summary.status,
          pausedAtStepId: summary.pausedAtStepId,
          error: summary.error,
        });
      }
      return summary;
    })();
    this.activeRuns.set(planId, run);
    try {
      return await run;
    } finally {
      if (this.activeRuns.get(planId) === run) this.activeRuns.delete(planId);
    }
  }

  async stop(planId: string, userId: string): Promise<any> {
    const planRow = await this.getOwnedPlan(planId, userId);
    const status = this.executionOutcomes.get(planId)?.status || planRow.status;
    if (['completed', 'stopped', 'failed', 'pending', 'rejected', 'superseded', 'expired'].includes(status)) {
      throw Object.assign(new Error('Cannot stop a terminal execution'), { status: 409 });
    }
    let controller = this.activeControllers.get(planId);
    if (controller?.isStopped()) {
      this.activeControllers.delete(planId);
      controller = undefined;
    }
    // No provider operation is active after restart. Stop only closes the plan;
    // UNKNOWN rows remain intact, including for missing/corrupt step snapshots.
    if ((!controller || (!controller.isExecuting() && status === 'reconciliation_required'))
      && ['partial', 'reconciliation_required'].includes(planRow.status) && this.planRepo.claimRecovery) {
      if (!await this.planRepo.claimRecovery(planRow, userId, 'stopped')) throw recoveryConflict('Execution changed or recovery is already running');
      await controller?.stop();
      this.executionOutcomes.set(planId, { status: 'stopped' });
      this.sseManager?.emitEvent(planRow.conv_id, 'exec_done', { planId, status: 'stopped' });
      return { status: 'stopped' };
    }
    if (!controller) {
      if (!this.queuedStarts.has(planId) && !this.activeRuns.has(planId)) {
        throw Object.assign(new Error('Reconciliation required: execution controller is unavailable'), { status: 409 });
      }
      this.stopRequests.add(planId);
      try {
        await this.planRepo.updatePlanStatus(planId, 'stopped');
      } catch (err) {
        await this.markExecutionFailed(planId, planRow.conv_id, err);
        throw err;
      }
      this.executionOutcomes.set(planId, { status: 'stopped' });
      this.sseManager?.emitEvent(planRow.conv_id, 'exec_done', { planId, status: 'stopped' });
      return { status: 'stopped' };
    }
    const run = this.activeRuns.get(planId);
    await controller.stop();
    if (run) await run;
    const settled = this.executionOutcomes.get(planId);
    if (settled && ['completed', 'failed', 'stopped', 'reconciliation_required'].includes(settled.status)) {
      return settled;
    }
    const uncertain = Object.values(controller.getAllStepStates()).find((state) => state.status === 'unknown');
    const summary = uncertain
      ? { status: 'reconciliation_required', pausedStepId: uncertain.stepId }
      : { status: 'stopped' };
    try {
      await this.planRepo.updatePlanStatus(planId, summary.status);
    } catch (err) {
      await this.markExecutionFailed(planId, planRow.conv_id, err);
      throw err;
    }
    this.executionOutcomes.set(planId, summary);
    this.sseManager?.emitEvent(planRow.conv_id, 'exec_done', { planId, ...summary });
    return summary;
  }

  getExecutionStatus(planId: string): { status: string; pausedStepId?: string } | null {
    const outcome = this.executionOutcomes.get(planId);
    if (outcome) return outcome;
    const controller = this.activeControllers.get(planId);
    if (!controller) {
      return null;
    }
    const states = controller.getAllStepStates();
    const allSteps = Object.values(states);
    const failed = allSteps.find((s) => s.status === 'failed' || s.status === 'unknown');
    if (failed) {
      return { status: 'partial', pausedStepId: failed.stepId };
    }
    const allDone = allSteps.every((s) => s.status === 'succeeded' || s.status === 'skipped');
    if (allDone) {
      return { status: 'completed' };
    }
    return { status: 'executing' };
  }

  async getLatestExecutionSnapshot(convId: string, userId: string) {
    const conversation = await this.convRepo?.getConversation(convId);
    if (!conversation) throw Object.assign(new Error('Conversation not found'), { status: 404 });
    if (conversation.user_id !== userId) throw Object.assign(new Error('Forbidden'), { status: 403 });
    const plan = await this.planRepo.getLatestExecutedPlan(convId);
    if (!plan) throw Object.assign(new Error('No execution found'), { status: 404 });
    const parsed = readableRecoveryPlan(plan);
    const execution = await this.getExecutionStatusDurable(plan.id);
    const rows = this.stepRepo ? await this.stepRepo.listSteps(plan.id) : [];
    const order = new Map<string, number>((parsed?.steps ?? []).map((step: PlanStep, index: number) => [step.id, index]));
    rows.sort((a, b) => (order.get(a.step_id) ?? Infinity) - (order.get(b.step_id) ?? Infinity));
    let recoveryActions: string[] = [];
    if (execution && !['completed', 'stopped', 'failed'].includes(execution.status)) {
      recoveryActions = ['stop'];
      try {
        const progress = restoredProgress(verifiedRecoverySteps(plan), rows);
        const paused = execution.pausedStepId ? progress.states[execution.pausedStepId] : undefined;
        if (paused?.status === 'unknown') recoveryActions = ['skip', 'stop'];
        else if (paused?.status === 'failed' && execution.status === 'partial') recoveryActions = ['retry', 'skip', 'stop'];
        else {
          validateRecoveryAction(plan.status, progress.states, '', 'continue');
          recoveryActions = ['continue', 'stop'];
        }
      } catch { /* Invalid or unstarted progress can still be stopped. */ }
    }
    return {
      plan: { ...parsed, id: plan.id, convId: plan.conv_id, status: plan.status, resourceLabels: plan.resource_labels ?? {} },
      execution,
      steps: rows.map(row => ({ stepId: row.step_id, tool: row.tool, status: row.status, output: row.output_json,
        error: row.error_json, startedAt: row.started_at, completedAt: row.completed_at, durationMs: row.duration_ms })),
      recoveryActions,
    };
  }

  async getExecutionStatusDurable(planId: string): Promise<{ status: string; pausedStepId?: string } | null> {
    const current = this.getExecutionStatus(planId);
    if (current) return current;
    const plan = await this.planRepo.getPlan(planId);
    if (!plan || ['pending', 'rejected', 'superseded', 'expired'].includes(plan.status)) return null;
    if (['approved', 'executing', 'stopping', 'partial', 'unknown', 'reconciliation_required'].includes(plan.status)) {
      const steps = this.stepRepo ? await this.stepRepo.listSteps(planId) : [];
      const planJson = readableRecoveryPlan(plan);
      // Repository order is lexical (step_10 precedes step_2); recovery follows
      // the approved plan's order and prioritizes uncertain results over failures.
      const order = new Map<string, number>((planJson?.steps ?? []).map((step: PlanStep, index: number) => [step.id, index]));
      steps.sort((a, b) => (order.get(a.step_id) ?? Infinity) - (order.get(b.step_id) ?? Infinity));
      const uncertain = steps.find(step => step.status === 'unknown' || step.status === 'running');
      if (uncertain) return { status: 'reconciliation_required', pausedStepId: uncertain.step_id };
      const failed = steps.find(step => step.status === 'failed');
      if (plan.status === 'partial' && failed) return { status: 'partial', pausedStepId: failed.step_id };
      return { status: 'reconciliation_required' };
    }
    return { status: plan.status };
  }
}
