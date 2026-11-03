export interface RevalidateLeaseResult { valid: boolean; status?: string; reason?: string }
export type RevalidateLeaseFn = (leaseId: string, options?: { signal?: AbortSignal }) => Promise<RevalidateLeaseResult | boolean>;
export type LockedLeaseRunner = <T>(
  leaseId: string,
  action: (validation: RevalidateLeaseResult) => Promise<T>,
  options?: FlushOptions
) => Promise<T>;

export interface JiraStreamBufferOptions {
  revalidateLease?: RevalidateLeaseFn;
  withLockedLease?: LockedLeaseRunner;
}
export interface FlushOptions { signal?: AbortSignal }
export interface FlushSummary { flushedCount: number; deltas: any[] }

export class JiraStreamBufferRevokedError extends Error {
  constructor() { super('Jira authorization lease revoked or expired'); this.name = 'JiraStreamBufferRevokedError'; }
}

/** Isolated producer-side buffer. Linearized check -> emit -> release via withLockedLease. */
export class JiraStreamBuffer {
  private readonly revalidateLease?: RevalidateLeaseFn;
  private readonly withLockedLease?: LockedLeaseRunner;
  private deltas: any[] = [];

  constructor(options: JiraStreamBufferOptions) {
    if (!options) throw new TypeError('options required');
    if (options.revalidateLease !== undefined && typeof options.revalidateLease !== 'function') {
      throw new TypeError('revalidateLease function required');
    }
    if (options.withLockedLease !== undefined && typeof options.withLockedLease !== 'function') {
      throw new TypeError('withLockedLease function required');
    }
    if (typeof options.revalidateLease !== 'function' && typeof options.withLockedLease !== 'function') {
      throw new TypeError('revalidateLease function required');
    }
    this.revalidateLease = options.revalidateLease;
    this.withLockedLease = options.withLockedLease;
  }

  get bufferedCount(): number { return this.deltas.length; }
  isEmpty(): boolean { return this.deltas.length === 0; }
  getBufferedDeltas(): any[] { return [...this.deltas]; }
  bufferDelta(delta: any): void { this.deltas.push(delta); }
  emitProgress(event: any, emit: (event: any) => void): void { emit(event); }
  discard(): void { this.deltas = []; }

  async flushOnStepComplete(leaseId: string, emit: (delta: any) => Promise<unknown> | unknown, options: FlushOptions = {}): Promise<FlushSummary> {
    if (!leaseId?.trim() || typeof emit !== 'function') throw new TypeError('Valid lease ID and emitter required');
    if (options.signal?.aborted) {
      this.discard();
      throw options.signal.reason ?? new Error('Aborted');
    }
    try {
      if (this.withLockedLease) {
        return await this.withLockedLease(
          leaseId,
          async (validation) => {
            if (options.signal?.aborted) throw options.signal.reason ?? new Error('Aborted');
            if (!validation || validation.valid !== true || validation.status !== 'active') {
              throw new JiraStreamBufferRevokedError();
            }
            const deltas = this.deltas;
            this.deltas = [];
            for (const delta of deltas) {
              if (options.signal?.aborted) throw options.signal.reason ?? new Error('Aborted');
              await emit(delta);
            }
            return { flushedCount: deltas.length, deltas };
          },
          options
        );
      }

      const result = await this.revalidateLease!(leaseId, { signal: options.signal });
      if (options.signal?.aborted) throw options.signal.reason ?? new Error('Aborted');
      if (result !== true && !(typeof result === 'object' && result !== null && result.valid === true && result.status === 'active')) {
        throw new JiraStreamBufferRevokedError();
      }
      const deltas = this.deltas;
      this.deltas = [];
      for (const delta of deltas) {
        if (options.signal?.aborted) throw options.signal.reason ?? new Error('Aborted');
        await emit(delta);
      }
      return { flushedCount: deltas.length, deltas };
    } catch (error) {
      this.discard();
      throw error;
    }
  }
}
