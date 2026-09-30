/** Timeout, bounded transient retry and cancellation shared by HTTP-backed providers. */
export interface TransportOptions {
  /** Per-attempt deadline; the attempt's signal is aborted when it elapses. */
  timeoutMs: number;
  /** Retries after a transient failure; other errors fail fast. */
  maxRetries: number;
  /** Base backoff; retry n waits retryDelayMs * 2^(n-1). */
  retryDelayMs: number;
  /** Start a second identical attempt when the first has not answered after this long. */
  hedgeAfterMs?: number;
  /** Provider name used in the timeout message. */
  label: string;
  signal?: AbortSignal;
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

async function attemptWithDeadline<T>(attempt: (signal: AbortSignal) => Promise<T>, options: TransportOptions): Promise<T> {
  const timeout = new AbortController();
  const timer = setTimeout(
    () => timeout.abort(new Error(`${options.label} request timed out after ${options.timeoutMs}ms`)),
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

/**
 * Races a second identical attempt against one that is slow to answer and
 * returns whichever succeeds first, aborting the other. Only for idempotent,
 * read-only calls: it trades an extra request for a shorter latency tail.
 */
function attemptWithHedge<T>(attempt: (signal: AbortSignal) => Promise<T>, options: TransportOptions): Promise<T> {
  if (!options.hedgeAfterMs) return attemptWithDeadline(attempt, options);
  return new Promise<T>((resolve, reject) => {
    const losers = [new AbortController(), new AbortController()];
    const errors: unknown[] = [];
    let started = 0;
    let settled = false;
    const launch = () => {
      const index = started++;
      attemptWithDeadline((signal) => attempt(AbortSignal.any([signal, losers[index]!.signal])), options).then(
        (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          losers[1 - index]!.abort(new Error(`${options.label} hedged request was not needed`));
          resolve(value);
        },
        (err) => {
          errors.push(err);
          if (settled) return;
          // A rejected first attempt fails at once; after the hedge started, wait for the other one.
          if (started === 1 || errors.length === 2) {
            settled = true;
            clearTimeout(timer);
            reject(errors[0]);
          }
        },
      );
    };
    const timer = setTimeout(() => { if (!settled && !options.signal?.aborted) launch(); }, options.hedgeAfterMs);
    launch();
  });
}

export async function callWithRetry<T>(attempt: (signal: AbortSignal) => Promise<T>, options: TransportOptions): Promise<T> {
  for (let retry = 0; ; retry++) {
    if (options.signal?.aborted) throw abortReason(options.signal, options.label);
    try {
      return await attemptWithHedge(attempt, options);
    } catch (err) {
      if (options.signal?.aborted) throw abortReason(options.signal, options.label);
      if (!isTransientStatus(err) || retry >= options.maxRetries) throw err;
      await sleep(options.retryDelayMs * 2 ** retry, options.signal, options.label);
    }
  }
}
