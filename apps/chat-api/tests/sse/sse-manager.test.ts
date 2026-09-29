import { describe, it, expect, vi } from 'vitest';
import { SSEManager } from '../../src/sse/sse-manager.js';

describe('apps/chat-api (Task 17: SSE Stream Manager & Sequence Tracking)', () => {
  it('tracks sequential event IDs and replays missed events based on Last-Event-ID', () => {
    const manager = new SSEManager();
    const convId = 'conv-1';

    manager.emitEvent(convId, 'thinking', { text: 'Analyzing...' }); // id: 1
    manager.emitEvent(convId, 'gather_start', { tool: 'trello.search_boards' }); // id: 2
    manager.emitEvent(convId, 'gather_done', {}); // id: 3

    const missed = manager.getMissedEvents(convId, 1);
    expect(missed).toHaveLength(2);
    expect(missed[0]?.id).toBe(2);
    expect(missed[0]?.event).toBe('gather_start');
    expect(missed[1]?.id).toBe(3);
  });

  it('broadcasts emitted events to registered client response streams', () => {
    const manager = new SSEManager();
    const convId = 'conv-2';

    const writtenChunks: string[] = [];
    const mockRes: any = {
      write: vi.fn().mockImplementation((chunk: string) => {
        writtenChunks.push(chunk);
        return true;
      }),
    };

    const cleanup = manager.addClient(convId, mockRes);
    expect(manager.getClientCount(convId)).toBe(1);

    manager.emitEvent(convId, 'agent_state', { state: 'planning' });

    expect(mockRes.write).toHaveBeenCalled();
    const combined = writtenChunks.join('');
    expect(combined).toMatch(/id: [^:]+:1\n/);
    expect(combined).toContain('event: agent_state\n');
    expect(combined).toContain('"state":"planning"');

    cleanup();
    expect(manager.getClientCount(convId)).toBe(0);
  });

  it('handles client removal cleanly', () => {
    const manager = new SSEManager();
    const convId = 'conv-3';

    const mockRes: any = { write: vi.fn() };
    manager.addClient(convId, mockRes);
    expect(manager.getClientCount(convId)).toBe(1);

    manager.removeClient(convId, mockRes);
    expect(manager.getClientCount(convId)).toBe(0);

    // Emitting now does not write to mockRes
    manager.emitEvent(convId, 'agent_state', { state: 'idle' });
    expect(mockRes.write).not.toHaveBeenCalled();
  });

  it('replays from the beginning of the current buffer when a cursor belongs to a previous server epoch', () => {
    const oldServer = new SSEManager();
    const oldCursor = oldServer.formatSSE(oldServer.emitEvent('conv', 'text_delta', { delta: 'old' })).match(/^id: ([^\n]+)/)?.[1];
    const newServer = new SSEManager();
    newServer.emitEvent('conv', 'text_delta', { delta: 'new' });
    expect(newServer.getMissedEventsForCursor('conv', oldCursor)).toMatchObject([{ id: 1 }]);
  });
});
