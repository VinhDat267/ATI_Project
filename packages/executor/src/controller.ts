import type { PlanStep } from '@wap/tool-schemas';
import type {
  ExecutionControllerOptions,
  ExecutionSummary,
  StepOutputs,
  StepState,
} from './types.js';

export class ExecutionController {
  private runner: ExecutionControllerOptions['runner'];
  private steps: PlanStep[];
  private onStepUpdate?: (stepId: string, state: StepState) => void | Promise<void>;
  private stepStates = new Map<string, StepState>();
  private stepOutputs: StepOutputs = new Map();
  private stopped = false;
  private readonly abortController = new AbortController();

  constructor(options: ExecutionControllerOptions) {
    this.runner = options.runner;
    this.steps = [...options.steps];
    this.onStepUpdate = options.onStepUpdate;

    for (const step of this.steps) {
      this.stepStates.set(step.id, {
        stepId: step.id,
        status: 'pending',
      });
    }
  }

  private async updateStepState(stepId: string, partial: Partial<StepState>): Promise<StepState> {
    const existing = this.stepStates.get(stepId) || { stepId, status: 'pending' };
    const updated: StepState = { ...existing, ...partial };
    this.stepStates.set(stepId, updated);
    try {
      await this.onStepUpdate?.(stepId, updated);
    } catch (err) {
      this.stopped = true;
      this.stepStates.set(stepId, { stepId, status: 'unknown', error: err });
      throw err;
    }
    return updated;
  }

  getStepState(stepId: string): StepState | undefined {
    return this.stepStates.get(stepId);
  }

  getAllStepStates(): Record<string, StepState> {
    const result: Record<string, StepState> = {};
    for (const [id, state] of this.stepStates.entries()) {
      result[id] = state;
    }
    return result;
  }

  private isRunning: boolean = false;

  isExecuting(): boolean {
    return this.isRunning;
  }

  getOutputs(): StepOutputs {
    return new Map(this.stepOutputs);
  }

  async stop(): Promise<ExecutionSummary> {
    this.stopped = true;
    this.abortController.abort();
    return { status: 'stopped' };
  }

  async runUntilPause(): Promise<ExecutionSummary> {
    if (this.stopped) {
      return { status: 'stopped' };
    }
    if (this.isRunning) {
      return { status: 'partial' };
    }

    this.isRunning = true;
    try {
      for (const step of this.steps) {
        if (this.stopped) {
          return { status: 'stopped' };
        }

        const currentState = this.stepStates.get(step.id);
        // Skip if already succeeded or skipped
        if (currentState?.status === 'succeeded' || currentState?.status === 'skipped') {
          continue;
        }

        // Check dependsOn dependencies: must be either succeeded or skipped
        for (const depId of step.dependsOn || []) {
          const depState = this.stepStates.get(depId);
          if (!depState || (depState.status !== 'succeeded' && depState.status !== 'skipped')) {
            return {
              status: 'partial',
              pausedAtStepId: step.id,
              error: { message: `Waiting on dependency ${depId}` },
            };
          }
        }

        // Mark step running
        await this.updateStepState(step.id, { status: 'running' });

        // Execute step
        const result = await this.runner.executeStep(step, this.stepOutputs, { signal: this.abortController.signal });

        if (result.status === 'success' || result.status === 'succeeded') {
          this.stepOutputs.set(step.id, result.output);
          await this.updateStepState(step.id, {
            status: 'succeeded',
            output: result.output,
            error: undefined,
          });
        } else {
          // failed or unknown
          const failureStatus = result.status === 'unknown' ? 'unknown' : 'failed';
          await this.updateStepState(step.id, {
            status: failureStatus,
            error: result.error,
          });
          return {
            status: failureStatus === 'unknown' && this.stopped ? 'reconciliation_required' : this.stopped ? 'stopped' : 'partial',
            pausedAtStepId: step.id,
            error: result.error,
          };
        }
      }

      return { status: this.stopped ? 'stopped' : 'completed' };
    } finally {
      this.isRunning = false;
    }
  }

  async retryStep(stepId: string): Promise<ExecutionSummary> {
    if (this.stopped) throw new Error(`Cannot retry step '${stepId}' after execution was stopped`);
    const step = this.steps.find((s) => s.id === stepId);
    if (!step) {
      throw new Error(`Step '${stepId}' not found in plan`);
    }

    const current = this.stepStates.get(stepId);
    if (current?.status !== 'failed') {
      throw new Error(`Cannot retry step '${stepId}' unless it failed and its outcome is known`);
    }

    await this.updateStepState(stepId, { status: 'pending', error: undefined });
    return this.runUntilPause();
  }

  async skipStepAndContinue(stepId: string): Promise<ExecutionSummary> {
    if (this.stopped) throw new Error(`Cannot skip step '${stepId}' after execution was stopped`);
    const step = this.steps.find((s) => s.id === stepId);
    if (!step) {
      throw new Error(`Step '${stepId}' not found in plan`);
    }

    const current = this.stepStates.get(stepId);
    if (current?.status !== 'failed' && current?.status !== 'unknown') {
      throw new Error(`Cannot skip step '${stepId}' unless it failed or has an unknown outcome`);
    }

    await this.updateStepState(stepId, { status: 'skipped' });
    return this.runUntilPause();
  }
}
