import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { refreshExecutionSnapshot } from '../src/services/execution-snapshot';
import { apiClient } from '../src/services/api-client';
import { useChatStore } from '../src/store/chat-store';
import type { ExecutionSnapshot } from '../src/types';

const snapshot: ExecutionSnapshot = {
  plan: { id: 'p1', convId: 'c1', status: 'reconciliation_required', steps: [] },
  execution: { status: 'reconciliation_required', pausedStepId: 'step_1' },
  steps: [{ stepId: 'step_1', tool: 'trello.create_card', status: 'unknown' }], recoveryActions: ['skip', 'stop'],
};
beforeEach(() => { useChatStore.getState().reset(); useChatStore.getState().setConversationId('c1'); });
afterEach(() => vi.restoreAllMocks());
describe('snapshot reads against newer selection/SSE state', () => {
  it('ignores a snapshot that finishes after switching conversations', async () => {
    let finish!: (value: ExecutionSnapshot) => void;
    vi.spyOn(apiClient, 'getLatestExecutionSnapshot').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = refreshExecutionSnapshot('c1');
    useChatStore.getState().reset(); useChatStore.getState().setConversationId('c2');
    finish(snapshot); await pending;
    expect(useChatStore.getState().executionSnapshot).toBeNull();
  });
  it('ignores an older read when live execution has advanced', async () => {
    let finish!: (value: ExecutionSnapshot) => void;
    vi.spyOn(apiClient, 'getLatestExecutionSnapshot').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = refreshExecutionSnapshot('c1');
    useChatStore.getState().updateStepStatus('step_1', 'succeeded');
    finish(snapshot); await pending;
    expect(useChatStore.getState().stepStatuses.step_1).toBe('succeeded');
    expect(useChatStore.getState().executionSnapshot).toBeNull();
  });
  it('keeps the latest read if concurrent responses finish in reverse order', async () => {
    let first!: (value: ExecutionSnapshot) => void;
    vi.spyOn(apiClient, 'getLatestExecutionSnapshot')
      .mockImplementationOnce(() => new Promise(resolve => { first = resolve; }))
      .mockResolvedValueOnce({ ...snapshot, execution: { status: 'stopped' }, recoveryActions: [] });
    const old = refreshExecutionSnapshot('c1'); await refreshExecutionSnapshot('c1');
    first(snapshot); await old;
    expect(useChatStore.getState().planStatus).toBe('stopped');
  });
  it('preserves evidence and exposes a failed read without fabricating completion', async () => {
    useChatStore.getState().setExecutionSnapshot(snapshot);
    vi.spyOn(apiClient, 'getLatestExecutionSnapshot').mockRejectedValue(new Error('Snapshot unavailable'));
    await expect(refreshExecutionSnapshot('c1')).rejects.toThrow('Snapshot unavailable');
    expect(useChatStore.getState().executionLoadError).toBe('Snapshot unavailable');
    expect(useChatStore.getState().stepStatuses.step_1).toBe('unknown');
  });
});
