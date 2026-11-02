export interface RevalidateLeaseResult { valid: boolean; status?: string; reason?: string }
export type RevalidateLeaseFn = (leaseId: string, options?: { signal?: AbortSignal }) => Promise<RevalidateLeaseResult | boolean>;
export interface JiraStreamBufferOptions { revalidateLease: RevalidateLeaseFn }
export interface FlushOptions { signal?: AbortSignal }
export interface FlushSummary { flushedCount: number; deltas: any[] }

export class JiraStreamBufferRevokedError extends Error {
  constructor() { super('Jira authorization lease revoked or expired'); this.name = 'JiraStreamBufferRevokedError'; }
}

/** Isolated producer-side buffer. JIRA-08 wires it into streaming execution. */
export class JiraStreamBuffer {
  private readonly revalidateLease: RevalidateLeaseFn;
  private deltas: any[] = [];

  constructor(options: JiraStreamBufferOptions) {
    if (!options || typeof options.revalidateLease !== 'function') throw new TypeError('revalidateLease function required');
    this.revalidateLease = options.revalidateLease;
  }

  get bufferedCount(): number { return this.deltas.length; }
  isEmpty(): boolean { return this.deltas.length === 0; }
  getBufferedDeltas(): any[] { return [...this.deltas]; }
  bufferDelta(delta: any): void { this.deltas.push(delta); }
  emitProgress(event: any, emit: (event: any) => void): void { emit(event); }
  discard(): void { this.deltas = []; }

  async flushOnStepComplete(leaseId: string, emit: (delta: any) => void, options: FlushOptions = {}): Promise<FlushSummary> {
    if (!leaseId?.trim() || typeof emit !== 'function') throw new TypeError('Valid lease ID and emitter required');
    if (options.signal?.aborted) {
      this.discard();
      throw options.signal.reason ?? new Error('Aborted');
    }
    try {
      const result = await this.revalidateLease(leaseId, { signal: options.signal });
      if (options.signal?.aborted) throw options.signal.reason ?? new Error('Aborted');
      if (result !== true && !(typeof result === 'object' && result !== null && result.valid === true && result.status === 'active')) {
        throw new JiraStreamBufferRevokedError();
      }
      const deltas = this.deltas;
      this.deltas = [];
      for (const delta of deltas) {
        if (options.signal?.aborted) throw options.signal.reason ?? new Error('Aborted');
        emit(delta);
      }
      return { flushedCount: deltas.length, deltas };
    } catch (error) {
      this.discard();
      throw error;
    }
  }
}
