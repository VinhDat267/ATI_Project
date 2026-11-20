import { describe, expect, it, vi } from 'vitest';
import {
  computeTrelloDigestConfigHash,
  evaluateTrelloDigestCandidate,
} from '../../src/services/schedules/trello-digest-candidate.js';
import { createTrelloDigestRunner } from '../../src/services/schedules/trello-digest-runner.js';

// TRELLO-G0: deliberately RED on main. These are behavior contracts, not live-provider tests.
const userId = 'gate0-owner';
const recurrence = { type: 'daily' as const, time: '08:30' };
const config = {
  credentialId: 'cred-gate0',
  trelloMemberId: 'mem-gate0',
  username: 'owner',
  boards: [{ id: 'b1', name: 'Frontend' }],
  channelId: 'C_DEV',
  channelName: 'dev',
  dueSoonHours: 24,
};

function connected() {
  return {
    status: 'connected',
    connection: {
      credentialId: config.credentialId,
      memberId: config.trelloMemberId,
      username: config.username,
      boardIds: ['b1'],
    },
    memberBoards: [{ boardId: 'b1', boardName: 'Frontend' }],
  };
}

function destination() {
  return {
    execute: vi.fn(async (tool: string) =>
      tool === 'slack.search_channels' ? [{ id: 'C_DEV', name: 'dev' }] : { ts: '1700000000.001' }),
  };
}

describe('TRELLO-G0 — trusted scope (RED contracts)', () => {
  it('resolves a personal schedule candidate using the personal scope, never default', async () => {
    const scopeId = 'personal:' + userId;
    const lookup = vi.fn(async (_uid: string, actualScope?: string) =>
      actualScope === scopeId ? connected() : { status: 'needs_scope' },
    );
    // Future input contract under review: actor-scoped candidate, not user-supplied authorization.
    const input: Parameters<typeof evaluateTrelloDigestCandidate>[0] & { scopeId: string } = {
      userId,
      scopeId,
      request: 'Mỗi sáng tổng hợp thẻ quá hạn bảng Frontend vào #dev',
      services: ['trello', 'slack'],
      recurrence,
      trelloConnection: lookup,
      getAdapter: async () => destination(),
    };

    const result = await evaluateTrelloDigestCandidate(input);
    expect(lookup).toHaveBeenCalledWith(userId, scopeId);
    expect(result.canAutoDigest).toBe(true);
  });

  it('does not silently select other boards when the requested board cannot be resolved', async () => {
    const result = await evaluateTrelloDigestCandidate({
      userId,
      request: 'Mỗi sáng báo cáo bảng Finance vào #dev',
      services: ['trello', 'slack'],
      recurrence,
      trelloConnection: async () => ({
        ...connected(),
        connection: { ...connected().connection, boardIds: ['b1', 'b2'] },
        memberBoards: [
          { boardId: 'b1', boardName: 'Frontend' },
          { boardId: 'b2', boardName: 'Backend' },
        ],
      }),
      getAdapter: async () => destination(),
    });

    expect(result.canAutoDigest).toBe(false);
    expect(result.disabledReason).toMatch(/bảng|board|không tìm thấy|chọn/i);
  });

  it('passes the organization scope to both Trello lookup and execution adapter', async () => {
    const lookup = vi.fn(async () => connected());
    const getAdapter = vi.fn(async (serviceName: string) =>
      serviceName === 'trello'
        ? { execute: vi.fn(async () => []) }
        : destination(),
    );
    const runner = createTrelloDigestRunner({
      pool: {
        query: vi.fn(async () => ({ rows: [{ version: 1, status: 'active' }], rowCount: 1 })),
      } as any,
      trelloConnection: lookup,
      getAdapter,
    });
    const result = await runner({
      runId: 'fixture-non-uuid',
      scheduleId: 'fixture-schedule',
      scheduleVersion: 1,
      userId,
      name: 'Gate 0 Trello',
      request: 'Báo cáo Trello vào #dev',
      dueAt: new Date('2026-11-09T01:30:00.000Z'),
      trigger: 'scheduled',
      workspaceMode: 'organization',
      workspaceId: 'org-123',
      recurrence,
      digestConfig: config,
      digestConfigHash: computeTrelloDigestConfigHash({ config, recurrence, userId }),
    }, 'fixture-conv', new AbortController().signal);

    expect(result.state).toBe('digest_sent');
    expect(lookup).toHaveBeenCalledWith(userId, 'org-123');
    expect(getAdapter).toHaveBeenCalledWith(
      'trello',
      expect.objectContaining({
        workspaceMode: 'organization',
        workspaceId: 'org-123',
      }),
    );
  });
});
