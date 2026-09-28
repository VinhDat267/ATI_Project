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

export type StepExecutionStatus = 'success' | 'failed' | 'unknown';

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
