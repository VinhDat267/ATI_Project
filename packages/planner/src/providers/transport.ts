import type { ModelAttemptMetrics } from '../types.js';
/** Timeout, bounded transient retry and cancellation shared by HTTP-backed providers. */
export interface TransportOptions {
  /** Per-attempt deadline; the attempt's signal is aborted when it elapses. */
  timeoutMs: number;
  /** Retries after a transient failure; other errors fail fast. */
  maxRetries: number;
  /**
   * Retries after this call hit its own deadline. Counted separately from
   * maxRetries because each one costs a whole timeoutMs; a slow answer is
   * usually a long reasoning run that a fresh attempt does not repeat.
   */
  timeoutRetries?: number;
  /** Base backoff; retry n waits retryDelayMs * 2^(n-1). */
  retryDelayMs: number;
  /** Provider name used in the timeout message. */
  label: string;
  signal?: AbortSignal;
  /** Observer failures must not change provider behavior. */
  onAttempt?: (metrics: ModelAttemptMetrics) => void;
}

const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504]);

/** Capacity and upstream errors worth retrying: HTTP 429 and 5xx gateway statuses. */
export function isTransientStatus(err: unknown): boolean {
  const status = (err as { status?: unknown })?.status;
  return typeof status === 'number' && TRANSIENT_STATUS.has(status);
}

function abortReason(signal: AbortSignal, label: string): unknown {
  return signal.reason ?? new Error(`${label} request aborted`);
}

function sleep(ms: number, signal: AbortSignal | undefined, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortReason(signal, label));
    const onAbort = () => { clearTimeout(timer); reject(abortReason(signal!, label)); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

class DeadlineError extends Error {}

async function attemptWithDeadline<T>(attempt: (signal: AbortSignal) => Promise<T>, options: TransportOptions): Promise<T> {
  const timeout = new AbortController();
  const timer = setTimeout(
    () => timeout.abort(new DeadlineError(`${options.label} request timed out after ${options.timeoutMs}ms`)),
    options.timeoutMs,
  );
  const signal = options.signal ? AbortSignal.any([options.signal, timeout.signal]) : timeout.signal;
  try {
    return await attempt(signal);
  } catch (err) {
    // Surface our own deadline rather than the transport's generic abort error.
    if (timeout.signal.aborted && !options.signal?.aborted) throw timeout.signal.reason;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function callWithRetry<T>(attempt: (signal: AbortSignal) => Promise<T>, options: TransportOptions): Promise<T> {
  const timeoutRetries = options.timeoutRetries ?? 0;
  let retry = 0;
  let timeouts = 0;
  const callStarted = performance.now();
  for (;;) {
    if (options.signal?.aborted) throw abortReason(options.signal, options.label);
    const started = performance.now();
    const record = (outcome: ModelAttemptMetrics['outcome'], status?: number, retryReason?: ModelAttemptMetrics['retryReason']) => {
      try { options.onAttempt?.({ startedAtMs: started - callStarted, durationMs: performance.now() - started, outcome, status, retryReason }); }
      catch { /* Diagnostics cannot fail a model call. */ }
    };
    try {
      const result = await attemptWithDeadline(attempt, options);
      record('success');
      return result;
    } catch (err) {
      if (options.signal?.aborted) { record('cancelled'); throw abortReason(options.signal, options.label); }
      if (err instanceof DeadlineError) {
        record('timeout', undefined, timeouts < timeoutRetries ? 'timeout' : undefined);
        if (timeouts >= timeoutRetries) throw err;
        timeouts += 1;
        continue;
      }
      const status = (err as { status?: unknown })?.status;
      const code = typeof status === 'number' ? status : undefined;
      const transient = isTransientStatus(err);
      record(transient ? 'transient' : 'error', code, transient && code !== undefined && retry < options.maxRetries ? `http_${code}` : undefined);
      if (!transient || retry >= options.maxRetries) throw err;
      await sleep(options.retryDelayMs * 2 ** retry, options.signal, options.label);
      retry += 1;
    }
  }
}
