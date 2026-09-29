import { describe, it, expect, vi } from 'vitest';
import { TrelloReadTools } from '../src/index.js';

describe('packages/tool-adapters (Task 4b: Trello Read Tools & Allowed Scope Validation)', () => {
  const mockFetch = vi.fn().mockImplementation(async (url: string | URL) => {
    const urlStr = url.toString();

    if (urlStr.includes('/members/me/boards')) {
      return {
        ok: true,
        status: 200,
        json: async () => [
          { id: 'b1', name: 'Frontend Project', url: 'https://trello.com/b/b1' },
          { id: 'b2', name: 'Backend Project', url: 'https://trello.com/b/b2' },
          { id: 'b_secret', name: 'Secret Ops', url: 'https://trello.com/b/b_secret' },
        ],
      };
    }

    if (urlStr.includes('/boards/b1/lists')) {
      return {
        ok: true,
        status: 200,
        json: async () => [
          { id: 'l1', name: 'To Do', idBoard: 'b1' },
          { id: 'l2', name: 'In Progress', idBoard: 'b1' },
          { id: 'l3', name: 'Done', idBoard: 'b1' },
        ],
      };
    }

    if (urlStr.includes('/boards/b1/members')) {
      return {
        ok: true,
        status: 200,
        json: async () => [
          { id: 'm1', fullName: 'Minh Nguyen', username: 'minhn' },
          { id: 'm2', fullName: 'An Tran', username: 'ant' },
        ],
      };
    }

    if (urlStr.includes('/search')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          cards: [
            { id: 'c1', name: 'Fix homepage UI bug', url: 'https://trello.com/c/c1', idList: 'l1' },
          ],
        }),
      };
    }

    if (urlStr.includes('/cards/c1')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'c1',
          name: 'Fix homepage UI bug',
          desc: 'Urgent fix required',
          url: 'https://trello.com/c/c1',
          idList: 'l1',
          idMembers: ['m1'],
        }),
      };
    }

    return {
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: async () => 'Not found',
    };
  });

  it('searches boards and filters by query and allowedScope whitelist', async () => {
    const adapter = new TrelloReadTools({
      credentials: { apiKey: 'k', token: 't' },
      allowedScope: { boards: ['b1', 'b2'] },
      fetchFn: mockFetch as any,
    });

    const results = await adapter.searchBoards({ query: 'Project', limit: 5 });
    expect(results).toHaveLength(2);
    expect(results.map((b) => b.id)).toEqual(['b1', 'b2']);
    // Secret board is excluded
    expect(results.find((b) => b.id === 'b_secret')).toBeUndefined();
  });

  it('searches lists in an allowed board and rejects forbidden boards', async () => {
    const adapter = new TrelloReadTools({
      credentials: { apiKey: 'k', token: 't' },
      allowedScope: { boards: ['b1'] },
      fetchFn: mockFetch as any,
    });

    // Allowed board
    const lists = await adapter.searchLists({ boardId: 'b1', query: 'Progress' });
    expect(lists).toHaveLength(1);
    expect(lists[0]).toEqual({ id: 'l2', name: 'In Progress', boardId: 'b1' });

    // Forbidden board
    await expect(adapter.searchLists({ boardId: 'b_forbidden' })).rejects.toThrow(
      /Allowed scope restriction/i
    );
  });

  it('searches members in board and enforces scope', async () => {
    const adapter = new TrelloReadTools({
      credentials: { apiKey: 'k', token: 't' },
      allowedScope: { boards: ['b1'] },
      fetchFn: mockFetch as any,
    });

    const members = await adapter.searchMembers({ boardId: 'b1', query: 'Minh' });
    expect(members).toHaveLength(1);
    expect(members[0]).toEqual({ id: 'm1', fullName: 'Minh Nguyen', username: 'minhn' });

    await expect(adapter.searchMembers({ boardId: 'b_forbidden', query: 'Minh' })).rejects.toThrow(
      /Allowed scope restriction/i
    );
  });

  it('searches cards and gets card details', async () => {
    const adapter = new TrelloReadTools({
      credentials: { apiKey: 'k', token: 't' },
      fetchFn: mockFetch as any,
    });

    const cards = await adapter.searchCards({ query: 'homepage' });
    expect(cards).toHaveLength(1);
    expect(cards[0]?.id).toBe('c1');
    expect(cards[0]?.listId).toBe('l1');

    const card = await adapter.getCard({ cardId: 'c1' });
    expect(card.id).toBe('c1');
    expect(card.name).toBe('Fix homepage UI bug');
    expect(card.listId).toBe('l1');
    expect(card.idMembers).toContain('m1');
  });
});
