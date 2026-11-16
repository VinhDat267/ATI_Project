import { describe, expect, it, vi } from 'vitest';
import { createTrelloDigestRunner } from '../../../src/services/schedules/trello-digest-runner.js';
import { computeTrelloDigestConfigHash } from '../../../src/services/schedules/trello-digest-candidate.js';

/** A transient Trello outage must fail one run (retryable), not pause the schedule. */
describe('Trello digest runner: transient connection lookup', () => {
  const userId = 'owner-1';
  const recurrence = { type: 'daily' as const, time: '08:30' };
  const config = {
    credentialId: 'cred-1',
    trelloMemberId: 'm1',
    username: 'alice',
    boards: [{ id: 'b1', name: 'Frontend' }],
    channelId: 'C1',
    channelName: 'ops',
    dueSoonHours: 24,
  };
  const run = {
    runId: 'run-1',
    scheduleId: 'sch-1',
    scheduleVersion: 1,
    userId,
    name: 'Bản tin',
    request: 'gửi bản tin trello',
    dueAt: new Date('2026-11-16T01:30:00Z'),
    trigger: 'scheduled',
    recurrence,
    digestConfig: config,
    digestConfigHash: computeTrelloDigestConfigHash({ config, recurrence, userId } as any),
  } as any;

  it('returns digest_failed (not blocked) when the lookup reports unavailable', async () => {
    const getAdapter = vi.fn();
    const runner = createTrelloDigestRunner({
      pool: {} as any,
      trelloConnection: async () => ({ status: 'unavailable', teamBoards: [], memberBoards: [] }),
      getAdapter,
    });
    const outcome = await runner(run, 'conv-1', new AbortController().signal);
    expect(outcome.state).toBe('digest_failed');
    expect(getAdapter).not.toHaveBeenCalled();
  });

  it('still blocks (pauses) when the grant is gone', async () => {
    const runner = createTrelloDigestRunner({
      pool: {} as any,
      trelloConnection: async () => ({ status: 'reconnect_required', teamBoards: [], memberBoards: [] }),
      getAdapter: vi.fn(),
    });
    const outcome = await runner(run, 'conv-1', new AbortController().signal);
    expect(outcome.state).toBe('blocked');
  });
});
