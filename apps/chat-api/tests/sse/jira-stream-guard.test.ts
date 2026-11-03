import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  JiraStreamBuffer,
  type JiraStreamBufferOptions,
  type RevalidateLeaseFn,
  type RevalidateLeaseResult,
  type FlushOptions,
  type FlushSummary,
  JiraStreamBufferRevokedError,
} from '../../src/sse/jira-stream-guard.js';

describe('JiraStreamBuffer (JIRA-05 Task 6 Standalone Component)', () => {
  let revalidateLeaseMock: ReturnType<typeof vi.fn<RevalidateLeaseFn>>;
  let emitMock: ReturnType<typeof vi.fn<(chunk: any) => void>>;
  let progressEmitMock: ReturnType<typeof vi.fn<(event: any) => void>>;

  beforeEach(() => {
    revalidateLeaseMock = vi.fn<RevalidateLeaseFn>();
    emitMock = vi.fn<(chunk: any) => void>();
    progressEmitMock = vi.fn<(event: any) => void>();
  });

  // ==========================================================================
  // Suite 1: Progress Events Direct Pass-Through
  // ==========================================================================
  describe('Suite 1: Progress Events Direct Pass-Through (emitProgress)', () => {
    it('emits progress event immediately to emit callback without buffering', () => {
      const buffer = new JiraStreamBuffer({ revalidateLease: revalidateLeaseMock });
      const progressEvent = { type: 'progress', step: 1, message: 'Validating issue key...' };

      buffer.emitProgress(progressEvent, progressEmitMock);

      expect(progressEmitMock).toHaveBeenCalledTimes(1);
      expect(progressEmitMock).toHaveBeenCalledWith(progressEvent);
      expect(buffer.bufferedCount).toBe(0);
      expect(buffer.isEmpty()).toBe(true);
    });

    it('does not store progress events into the internal delta buffer', () => {
      const buffer = new JiraStreamBuffer({ revalidateLease: revalidateLeaseMock });

      buffer.emitProgress({ type: 'status', text: 'Connecting to Jira' }, progressEmitMock);
      buffer.emitProgress({ type: 'step_started', stepIndex: 0 }, progressEmitMock);

      expect(progressEmitMock).toHaveBeenCalledTimes(2);
      expect(buffer.getBufferedDeltas()).toEqual([]);
      expect(buffer.bufferedCount).toBe(0);
    });

    it('handles various event types (string, object, number, null) directly', () => {
      const buffer = new JiraStreamBuffer({ revalidateLease: revalidateLeaseMock });
      const events = ['step-1-init', { pct: 50 }, 100, null];

      for (const evt of events) {
        buffer.emitProgress(evt, progressEmitMock);
      }

      expect(progressEmitMock).toHaveBeenCalledTimes(4);
      expect(progressEmitMock.mock.calls.map(([arg]) => arg)).toEqual(events);
    });

    it('allows interleaved progress emission while deltas are buffered without releasing deltas', () => {
      const buffer = new JiraStreamBuffer({ revalidateLease: revalidateLeaseMock });

      buffer.bufferDelta('Issue description start: ');
      buffer.emitProgress({ type: 'progress', message: 'Chunk 1 received' }, progressEmitMock);
      buffer.bufferDelta('Found Jira issue ATI-101.');
      buffer.emitProgress({ type: 'progress', message: 'Chunk 2 received' }, progressEmitMock);

      // Progress events should be delivered immediately
      expect(progressEmitMock).toHaveBeenCalledTimes(2);
      expect(progressEmitMock).toHaveBeenNthCalledWith(1, { type: 'progress', message: 'Chunk 1 received' });
      expect(progressEmitMock).toHaveBeenNthCalledWith(2, { type: 'progress', message: 'Chunk 2 received' });

      // Deltas remain safely buffered, not emitted to progressEmitMock
      expect(buffer.bufferedCount).toBe(2);
      expect(buffer.getBufferedDeltas()).toEqual([
        'Issue description start: ',
        'Found Jira issue ATI-101.',
      ]);
    });
  });

  // ==========================================================================
  // Suite 2: Jira Content Delta Buffering
  // ==========================================================================
  describe('Suite 2: Jira Content Delta Buffering (bufferDelta)', () => {
    it('buffers Jira content deltas in memory without prematurely emitting', () => {
      const buffer = new JiraStreamBuffer({ revalidateLease: revalidateLeaseMock });

      buffer.bufferDelta('Sensitive Jira ticket summary: Project Alpha status');

      expect(emitMock).not.toHaveBeenCalled();
      expect(buffer.bufferedCount).toBe(1);
      expect(buffer.isEmpty()).toBe(false);
      expect(buffer.getBufferedDeltas()).toEqual([
        'Sensitive Jira ticket summary: Project Alpha status',
      ]);
    });

    it('accumulates multiple delta chunks in buffer without leaking to emit callback', () => {
      const buffer = new JiraStreamBuffer({ revalidateLease: revalidateLeaseMock });

      buffer.bufferDelta('chunk-1: ');
      buffer.bufferDelta('chunk-2: ');
      buffer.bufferDelta('chunk-3');

      expect(emitMock).not.toHaveBeenCalled();
      expect(buffer.bufferedCount).toBe(3);
      expect(buffer.getBufferedDeltas()).toEqual(['chunk-1: ', 'chunk-2: ', 'chunk-3']);
    });

    it('preserves empty string or whitespace deltas accurately', () => {
      const buffer = new JiraStreamBuffer({ revalidateLease: revalidateLeaseMock });

      buffer.bufferDelta('');
      buffer.bufferDelta(' ');
      buffer.bufferDelta('\n\n');

      expect(buffer.bufferedCount).toBe(3);
      expect(buffer.getBufferedDeltas()).toEqual(['', ' ', '\n\n']);
    });
  });

  // ==========================================================================
  // Suite 3: Flush on Step Complete with Valid Lease
  // ==========================================================================
  describe('Suite 3: Flush on Step Complete with Valid Lease (flushOnStepComplete)', () => {
    it('flushes buffered deltas when revalidateLease returns valid: true with active status', async () => {
      revalidateLeaseMock.mockResolvedValue({ valid: true, status: 'active' });
      const buffer = new JiraStreamBuffer({ revalidateLease: revalidateLeaseMock });

      buffer.bufferDelta('ATI-101: ');
      buffer.bufferDelta('Fix bug in auth provider');

      const summary = await buffer.flushOnStepComplete('lease-valid-1', emitMock);

      expect(revalidateLeaseMock).toHaveBeenCalledTimes(1);
      expect(revalidateLeaseMock).toHaveBeenCalledWith('lease-valid-1', expect.anything());

      expect(emitMock).toHaveBeenCalledTimes(2);
      expect(emitMock).toHaveBeenNthCalledWith(1, 'ATI-101: ');
      expect(emitMock).toHaveBeenNthCalledWith(2, 'Fix bug in auth provider');

      // Buffer must be cleared after successful flush
      expect(buffer.bufferedCount).toBe(0);
      expect(buffer.isEmpty()).toBe(true);
      expect(buffer.getBufferedDeltas()).toEqual([]);

      expect(summary).toEqual({
        flushedCount: 2,
        deltas: ['ATI-101: ', 'Fix bug in auth provider'],
      });
    });

    it('accepts boolean true return value from revalidateLease', async () => {
      revalidateLeaseMock.mockResolvedValue(true);
      const buffer = new JiraStreamBuffer({ revalidateLease: revalidateLeaseMock });

      buffer.bufferDelta('Simple delta chunk');
      await buffer.flushOnStepComplete('lease-bool-true', emitMock);

      expect(emitMock).toHaveBeenCalledTimes(1);
      expect(emitMock).toHaveBeenCalledWith('Simple delta chunk');
      expect(buffer.isEmpty()).toBe(true);
    });

    it('clears buffer so subsequent flushOnStepComplete flushes nothing', async () => {
      revalidateLeaseMock.mockResolvedValue({ valid: true, status: 'active' });
      const buffer = new JiraStreamBuffer({ revalidateLease: revalidateLeaseMock });

      buffer.bufferDelta('First step Jira payload');
      await buffer.flushOnStepComplete('lease-1', emitMock);
      expect(emitMock).toHaveBeenCalledTimes(1);

      // Second flush on same buffer without new deltas
      const secondEmitMock = vi.fn();
      const secondSummary = await buffer.flushOnStepComplete('lease-1', secondEmitMock);

      expect(secondEmitMock).not.toHaveBeenCalled();
      expect(secondSummary).toEqual({
        flushedCount: 0,
        deltas: [],
      });
    });

    it('handles empty buffer gracefully without emitting when lease is valid', async () => {
      revalidateLeaseMock.mockResolvedValue({ valid: true, status: 'active' });
      const buffer = new JiraStreamBuffer({ revalidateLease: revalidateLeaseMock });

      const summary = await buffer.flushOnStepComplete('lease-empty', emitMock);

      expect(revalidateLeaseMock).toHaveBeenCalledWith('lease-empty', expect.anything());
      expect(emitMock).not.toHaveBeenCalled();
      expect(summary).toEqual({
        flushedCount: 0,
        deltas: [],
      });
    });
  });

  // ==========================================================================
  // Suite 4: Discard and Revocation Defense - No Leaks
  // ==========================================================================
  describe('Suite 4: Discard and Revocation Defense - No Leaks', () => {
    it('discards buffer and throws JiraStreamBufferRevokedError when lease is revoked', async () => {
      revalidateLeaseMock.mockResolvedValue({ valid: false, status: 'revoked', reason: 'Membership revoked' });
      const buffer = new JiraStreamBuffer({ revalidateLease: revalidateLeaseMock });

      buffer.bufferDelta('Leaked ticket secret #1');
      buffer.bufferDelta('Leaked ticket secret #2');

      await expect(
        buffer.flushOnStepComplete('lease-revoked-id', emitMock)
      ).rejects.toThrow(JiraStreamBufferRevokedError);

      // Crucial: emitMock MUST NEVER have been called!
      expect(emitMock).not.toHaveBeenCalled();

      // Buffer must be thoroughly wiped out
      expect(buffer.bufferedCount).toBe(0);
      expect(buffer.isEmpty()).toBe(true);
      expect(buffer.getBufferedDeltas()).toEqual([]);
    });

    it('discards buffer and throws when lease is expired', async () => {
      revalidateLeaseMock.mockResolvedValue({ valid: false, status: 'expired', reason: 'TTL elapsed' });
      const buffer = new JiraStreamBuffer({ revalidateLease: revalidateLeaseMock });

      buffer.bufferDelta('Confidential issue details');

      await expect(
        buffer.flushOnStepComplete('lease-expired-id', emitMock)
      ).rejects.toThrow(/revoked|expired/i);

      expect(emitMock).not.toHaveBeenCalled();
      expect(buffer.bufferedCount).toBe(0);
      expect(buffer.isEmpty()).toBe(true);
    });

    it('discards buffer and throws when revalidateLease returns boolean false or invalid', async () => {
      revalidateLeaseMock.mockResolvedValue(false);
      const buffer = new JiraStreamBuffer({ revalidateLease: revalidateLeaseMock });

      buffer.bufferDelta('Payload with false lease');

      await expect(
        buffer.flushOnStepComplete('lease-false', emitMock)
      ).rejects.toThrow();

      expect(emitMock).not.toHaveBeenCalled();
      expect(buffer.bufferedCount).toBe(0);
    });

    it('explicit discard() clears all deltas immediately without invoking emit', () => {
      const buffer = new JiraStreamBuffer({ revalidateLease: revalidateLeaseMock });

      buffer.bufferDelta('Draft Jira issue text 1');
      buffer.bufferDelta('Draft Jira issue text 2');
      expect(buffer.bufferedCount).toBe(2);

      buffer.discard();

      expect(emitMock).not.toHaveBeenCalled();
      expect(buffer.bufferedCount).toBe(0);
      expect(buffer.isEmpty()).toBe(true);
      expect(buffer.getBufferedDeltas()).toEqual([]);
    });

    it('subsequent flush after explicit discard() emits nothing even with valid lease', async () => {
      revalidateLeaseMock.mockResolvedValue({ valid: true, status: 'active' });
      const buffer = new JiraStreamBuffer({ revalidateLease: revalidateLeaseMock });

      buffer.bufferDelta('Data to be discarded');
      buffer.discard();

      const summary = await buffer.flushOnStepComplete('lease-after-discard', emitMock);

      expect(emitMock).not.toHaveBeenCalled();
      expect(summary.flushedCount).toBe(0);
    });

    it('ensures data is not retained if revalidateLease throws an error', async () => {
      revalidateLeaseMock.mockRejectedValue(new Error('PostgreSQL connection dropped'));
      const buffer = new JiraStreamBuffer({ revalidateLease: revalidateLeaseMock });

      buffer.bufferDelta('Data during DB failure');

      await expect(
        buffer.flushOnStepComplete('lease-db-err', emitMock)
      ).rejects.toThrow('PostgreSQL connection dropped');

      expect(emitMock).not.toHaveBeenCalled();
      // Fail-closed: buffer must be discarded to prevent leaking later
      expect(buffer.bufferedCount).toBe(0);
      expect(buffer.isEmpty()).toBe(true);
    });
  });

  // ==========================================================================
  // Suite 5: Multiple Deltas Ordering & Data Integrity
  // ==========================================================================
  describe('Suite 5: Multiple Deltas Ordering & Data Integrity', () => {
    it('preserves strict FIFO ordering when flushing streaming token deltas', async () => {
      revalidateLeaseMock.mockResolvedValue({ valid: true, status: 'active' });
      const buffer = new JiraStreamBuffer({ revalidateLease: revalidateLeaseMock });

      const tokens = [
        'Issue ',
        'KEY-456 ',
        'has been updated ',
        'with comment: ',
        '"Deployment scheduled for 18:00 UTC".',
      ];

      for (const token of tokens) {
        buffer.bufferDelta(token);
      }

      const receivedTokens: string[] = [];
      await buffer.flushOnStepComplete('lease-ordering', (chunk) => {
        receivedTokens.push(chunk);
      });

      expect(receivedTokens).toEqual(tokens);
      expect(receivedTokens.join('')).toBe(
        'Issue KEY-456 has been updated with comment: "Deployment scheduled for 18:00 UTC".'
      );
    });

    it('preserves structured object deltas without mutation', async () => {
      revalidateLeaseMock.mockResolvedValue({ valid: true, status: 'active' });
      const buffer = new JiraStreamBuffer({ revalidateLease: revalidateLeaseMock });

      const objDelta1 = { type: 'issue_header', key: 'ATI-99', id: '10099' };
      const objDelta2 = { type: 'issue_field', field: 'status', value: 'In Progress' };
      const objDelta3 = { type: 'issue_footer', syncedAt: '2026-11-02T14:00:00Z' };

      buffer.bufferDelta(objDelta1);
      buffer.bufferDelta(objDelta2);
      buffer.bufferDelta(objDelta3);

      const receivedObjects: any[] = [];
      await buffer.flushOnStepComplete('lease-objects', (chunk) => {
        receivedObjects.push(chunk);
      });

      expect(receivedObjects).toHaveLength(3);
      expect(receivedObjects[0]).toBe(objDelta1);
      expect(receivedObjects[1]).toBe(objDelta2);
      expect(receivedObjects[2]).toBe(objDelta3);
    });

    it('supports multiple sequential step buffering and flushing cycles cleanly', async () => {
      revalidateLeaseMock.mockResolvedValue({ valid: true, status: 'active' });
      const buffer = new JiraStreamBuffer({ revalidateLease: revalidateLeaseMock });

      // Step 1
      buffer.bufferDelta('Step 1: Finding project');
      buffer.bufferDelta(' -> Found PROJ');
      const step1Deltas: string[] = [];
      await buffer.flushOnStepComplete('lease-step-1', (c) => step1Deltas.push(c));
      expect(step1Deltas).toEqual(['Step 1: Finding project', ' -> Found PROJ']);
      expect(buffer.isEmpty()).toBe(true);

      // Step 2
      buffer.bufferDelta('Step 2: Creating ticket');
      buffer.bufferDelta(' -> Created PROJ-42');
      const step2Deltas: string[] = [];
      await buffer.flushOnStepComplete('lease-step-2', (c) => step2Deltas.push(c));
      expect(step2Deltas).toEqual(['Step 2: Creating ticket', ' -> Created PROJ-42']);
      expect(buffer.isEmpty()).toBe(true);
    });
  });

  // ==========================================================================
  // Suite 6: AbortSignal Handling & Cancellation
  // ==========================================================================
  describe('Suite 6: AbortSignal Handling & Cancellation', () => {
    it('rejects immediately and discards buffer if signal is pre-aborted', async () => {
      const buffer = new JiraStreamBuffer({ revalidateLease: revalidateLeaseMock });
      buffer.bufferDelta('Should not be emitted');

      const controller = new AbortController();
      controller.abort(new Error('Pre-aborted stream request'));

      await expect(
        buffer.flushOnStepComplete('lease-pre-abort', emitMock, { signal: controller.signal })
      ).rejects.toThrow(/pre-aborted|abort/i);

      // Neither revalidate nor emit should have been called
      expect(revalidateLeaseMock).not.toHaveBeenCalled();
      expect(emitMock).not.toHaveBeenCalled();

      // Buffer must be discarded to prevent leaking
      expect(buffer.bufferedCount).toBe(0);
      expect(buffer.isEmpty()).toBe(true);
    });

    it('forwards AbortSignal to revalidateLease call', async () => {
      revalidateLeaseMock.mockResolvedValue({ valid: true, status: 'active' });
      const buffer = new JiraStreamBuffer({ revalidateLease: revalidateLeaseMock });
      buffer.bufferDelta('Valid payload');

      const controller = new AbortController();
      await buffer.flushOnStepComplete('lease-with-signal', emitMock, { signal: controller.signal });

      expect(revalidateLeaseMock).toHaveBeenCalledWith('lease-with-signal', {
        signal: controller.signal,
      });
      expect(emitMock).toHaveBeenCalledWith('Valid payload');
    });

    it('discards buffer and does not emit if signal aborts while revalidateLease is in-flight', async () => {
      const controller = new AbortController();

      // Simulate an async revalidateLease that checks signal
      revalidateLeaseMock.mockImplementation(
        async (_leaseId, options) => {
          return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              resolve({ valid: true, status: 'active' });
            }, 100);

            if (options?.signal) {
              options.signal.addEventListener('abort', () => {
                clearTimeout(timeout);
                reject(options.signal?.reason || new Error('Aborted'));
              });
            }
          });
        }
      );

      const buffer = new JiraStreamBuffer({ revalidateLease: revalidateLeaseMock });
      buffer.bufferDelta('In-flight abort target chunk');

      const flushPromise = buffer.flushOnStepComplete('lease-inflight', emitMock, {
        signal: controller.signal,
      });

      // Abort while revalidation is in-flight
      controller.abort(new Error('Client disconnected during flush'));

      await expect(flushPromise).rejects.toThrow(/disconnected|abort/i);

      // Critical: emit MUST NOT be called after abort!
      expect(emitMock).not.toHaveBeenCalled();

      // Buffer must be discarded
      expect(buffer.bufferedCount).toBe(0);
      expect(buffer.isEmpty()).toBe(true);
    });
  });

  // ==========================================================================
  // Suite 7: Input Validation & Constructor Contracts
  // ==========================================================================
  describe('Suite 7: Input Validation & Constructor Contracts', () => {
    it('throws TypeError if constructor options or revalidateLease is missing/invalid', () => {
      expect(() => new JiraStreamBuffer(undefined as any)).toThrow(TypeError);
      expect(() => new JiraStreamBuffer({} as any)).toThrow(TypeError);
      expect(() => new JiraStreamBuffer({ revalidateLease: 'not-a-function' as any })).toThrow(TypeError);
    });

    it('throws TypeError if flushOnStepComplete is called with invalid arguments', async () => {
      const buffer = new JiraStreamBuffer({ revalidateLease: revalidateLeaseMock });

      await expect(buffer.flushOnStepComplete('', emitMock)).rejects.toThrow(TypeError);
      await expect(buffer.flushOnStepComplete('   ', emitMock)).rejects.toThrow(TypeError);
      await expect(buffer.flushOnStepComplete('valid-id', undefined as any)).rejects.toThrow(TypeError);
      await expect(buffer.flushOnStepComplete('valid-id', 'not-fn' as any)).rejects.toThrow(TypeError);
    });
  });
});
