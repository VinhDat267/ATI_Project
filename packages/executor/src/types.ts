import type { PlanStep } from '@wap/tool-schemas';

export type StepOutputs = Map<string, any>;

export interface ResolveOptions {
  strict?: boolean;
}

export type ErrorCategory =
  | 'AUTH_ERROR'
  | 'NOT_FOUND'
  | 'RATE_LIMIT'
  | 'SERVER_ERROR'
  | 'NETWORK'
  | 'VALIDATION';

export interface StepErrorDetail {
  category: ErrorCategory;
  message: string;
  details?: any;
}

export type StepExecutionStatus = 'success' | 'failed' | 'unknown' | 'succeeded';

export interface StepExecutionResult {
  stepId: string;
  status: StepExecutionStatus;
  output: any | null;
  error: StepErrorDetail | null;
  durationMs: number;
}

export interface AdapterExecutor {
  execute(tool: string, args: any, options?: { signal?: AbortSignal }): Promise<any>;
}

export interface StepRunnerOptions {
  getAdapter: (serviceName: string) => AdapterExecutor;
}

export interface ExecuteStepOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export type StepStateStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'unknown'
  | 'skipped';

export interface StepState {
  stepId: string;
  status: StepStateStatus;
  output?: any;
  error?: any;
}

export type ExecutionStatus = 'completed' | 'partial' | 'stopped' | 'failed';

export interface ExecutionSummary {
  status: ExecutionStatus;
  pausedAtStepId?: string;
  error?: any;
}

export interface ExecutionControllerOptions {
  runner: {
    executeStep: (
      step: PlanStep,
      stepOutputs: StepOutputs,
      options?: ExecuteStepOptions
    ) => Promise<{ status: string; output?: any; error?: any; durationMs?: number }>;
  };
  steps: PlanStep[];
  onStepUpdate?: (stepId: string, state: StepState) => void;
}
