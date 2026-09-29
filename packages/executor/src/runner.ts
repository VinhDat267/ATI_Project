import type { PlanStep, ToolDefinition } from '@wap/tool-schemas';
import { ALL_TOOLS } from '@wap/tool-schemas';
import { resolveArgs } from './resolver.js';
import type {
  StepOutputs,
  StepRunnerOptions,
  ExecuteStepOptions,
  StepExecutionResult,
  ErrorCategory,
} from './types.js';

const catalog = new Map<string, ToolDefinition>(
  ALL_TOOLS.map((t) => [t.name, t])
);

export function isWriteTool(toolName: string): boolean {
  const def = catalog.get(toolName);
  if (def) {
    return def.sideEffect === 'write';
  }
  return /(create|update|add|send|delete|post|put|patch)/i.test(toolName);
}

function combineSignals(s1: AbortSignal, s2?: AbortSignal): AbortSignal {
  if (!s2) return s1;
  if (typeof (AbortSignal as any).any === 'function') {
    return (AbortSignal as any).any([s1, s2]);
  }
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  s1.addEventListener('abort', onAbort, { once: true });
  s2.addEventListener('abort', onAbort, { once: true });
  return controller.signal;
}

function classifyErrorCategory(err: any, timeoutAborted: boolean): ErrorCategory {
  if (
    err?.category &&
    ['AUTH_ERROR', 'NOT_FOUND', 'RATE_LIMIT', 'SERVER_ERROR', 'NETWORK', 'VALIDATION', 'UNKNOWN'].includes(
      err.category
    )
  ) {
    return err.category;
  }
  if (timeoutAborted || err?.name === 'TimeoutError' || /timeout/i.test(err?.message || '')) {
    return 'NETWORK';
  }
  if (err?.status >= 500) {
    return 'SERVER_ERROR';
  }
  if (err?.status === 401 || err?.status === 403) {
    return 'AUTH_ERROR';
  }
  if (err?.status === 404) {
    return 'NOT_FOUND';
  }
  if (err?.status === 429) {
    return 'RATE_LIMIT';
  }
  return 'NETWORK';
}

export class StepRunner {
  private options: StepRunnerOptions;

  constructor(options: StepRunnerOptions) {
    this.options = options;
  }

  async executeStep(
    step: PlanStep,
    stepOutputs: StepOutputs,
    options?: ExecuteStepOptions
  ): Promise<StepExecutionResult> {
    const startTime = Date.now();
    const isWrite = isWriteTool(step.tool);
    const defaultTimeoutMs = isWrite ? 30000 : 15000;
    const timeoutMs = options?.timeoutMs ?? defaultTimeoutMs;

    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const combinedSignal = combineSignals(timeoutSignal, options?.signal);

    try {
      // 1. Resolve arguments ($ref, $template)
      const resolvedArgs = resolveArgs(step.args || {}, stepOutputs);

      // 2. Extract service name (e.g. 'trello' from 'trello.create_card')
      const dotIndex = step.tool.indexOf('.');
      const serviceName = dotIndex === -1 ? step.tool : step.tool.slice(0, dotIndex);
      const adapter = await this.options.getAdapter(serviceName);
      if (!adapter || typeof (adapter as any).execute !== 'function') {
        throw new Error(`Tool adapter for service '${serviceName}' is not available or missing execute() method`);
      }

      // 3. Execute adapter tool with combined signal
      const output = await adapter.execute(step.tool, resolvedArgs, {
        signal: combinedSignal,
      });

      const durationMs = Date.now() - startTime;
      return {
        stepId: step.id,
        status: 'success',
        output,
        error: null,
        durationMs,
      };
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      const category = classifyErrorCategory(err, timeoutSignal.aborted);

      // Write safety: Network/Server failures on write tools result in 'unknown' status
      const status =
        isWrite && (category === 'NETWORK' || category === 'SERVER_ERROR' || category === 'UNKNOWN')
          ? 'unknown'
          : 'failed';

      return {
        stepId: step.id,
        status,
        output: null,
        error: {
          category,
          message: err?.message || String(err),
          details: err?.details,
        },
        durationMs,
      };
    }
  }
}
