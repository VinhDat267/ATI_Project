import { describe, it, expect, vi } from 'vitest';
import { TrelloAdapter } from '../src/index.js';
import { StepError } from '../src/base-adapter.js';

describe('Trello OAuth & Scope Whitelisting (Task 7)', () => {
  const allowedBoardId = 'board-allowed-1';
  const unallowedBoardId = 'board-forbidden-2';
  const token = 'oauth-bearer-access-token-xyz';

  const mockDatabase: Record<string, any> = {
    boards: [
      { id: allowedBoardId, name: 'Project Alpha', url: 'https://trello.com/b/allowed' },
      { id: unallowedBoardId, name: 'Secret Beta', url: 'https://trello.com/b/forbidden' },
    ],
    lists: [
      { id: 'list-allowed-1', name: 'To Do', idBoard: allowedBoardId },
      { id: 'list-forbidden-2', name: 'Private List', idBoard: unallowedBoardId },
    ],
    cards: [
      { id: 'card-allowed-1', name: 'Card 1', idBoard: allowedBoardId, idList: 'list-allowed-1' },
      { id: 'card-forbidden-2', name: 'Card 2', idBoard: unallowedBoardId, idList: 'list-forbidden-2' },
    ],
    members: [
      { id: 'member-allowed-1', fullName: 'Alice Member', username: 'alice', idBoard: allowedBoardId },
    ],
  };

  const createAdapter = (recordedCalls: Array<{ url: string; method: string; headers: any; body?: any }>) => {
    const mockFetch = vi.fn().mockImplementation(async (rawUrl: string | URL, init: RequestInit = {}) => {
      const urlStr = rawUrl.toString();
      const headers = new Headers(init.headers as any);
      recordedCalls.push({
        url: urlStr,
        method: init.method || 'GET',
        headers: Object.fromEntries(headers.entries()),
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      });

      if (init.signal?.aborted) {
        throw new Error('This operation was aborted');
      }

      if (urlStr.includes('/members/me/boards')) {
        return {
          ok: true,
          status: 200,
          json: async () => mockDatabase.boards,
        };
      }

      if (urlStr.includes(`/boards/${allowedBoardId}/lists`)) {
        return {
          ok: true,
          status: 200,
          json: async () => mockDatabase.lists.filter((l: any) => l.idBoard === allowedBoardId),
        };
      }

      if (urlStr.includes(`/boards/${allowedBoardId}/members`)) {
        return {
          ok: true,
          status: 200,
          json: async () => mockDatabase.members.filter((m: any) => m.idBoard === allowedBoardId),
        };
      }

      if (urlStr.includes('/lists/list-allowed-1')) {
        return {
          ok: true,
          status: 200,
          json: async () => mockDatabase.lists[0],
        };
      }

      if (urlStr.includes('/lists/list-forbidden-2')) {
        return {
          ok: true,
          status: 200,
          json: async () => mockDatabase.lists[1],
        };
      }

      if (urlStr.includes('/cards/card-allowed-1')) {
        return {
          ok: true,
          status: 200,
          json: async () => mockDatabase.cards[0],
        };
      }

      if (urlStr.includes('/cards/card-forbidden-2')) {
        return {
          ok: true,
          status: 200,
          json: async () => mockDatabase.cards[1],
        };
      }

      if (urlStr.includes('/search')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            cards: mockDatabase.cards,
          }),
        };
      }

      if (urlStr.endsWith('/cards') && init.method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'card-new', name: 'Created Card' }),
        };
      }

      if (urlStr.includes('/cards/card-allowed-1') && init.method === 'PUT') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'card-allowed-1', name: 'Updated Card' }),
        };
      }

      if (urlStr.includes('/checklists') && init.method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'chk-1', name: 'Checklist 1' }),
        };
      }

      if (urlStr.includes('/idMembers') && init.method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'card-allowed-1', idMembers: ['member-allowed-1'] }),
        };
      }

      return {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => 'Not found',
      };
    });

    return new (TrelloAdapter as any)({
      credentials: { accessToken: token },
      allowedBoardIds: [allowedBoardId],
      allowedScope: { boards: [allowedBoardId] },
      fetchFn: mockFetch as any,
    });
  };

  it('calls API with Authorization: Bearer, without key or token query params, and filters search_boards by allowedBoardIds', async () => {
    const calls: Array<{ url: string; method: string; headers: any }> = [];
    const adapter = createAdapter(calls);

    const boards = await adapter.searchBoards({ query: 'Project' });
    expect(boards).toEqual([
      { id: allowedBoardId, name: 'Project Alpha', url: 'https://trello.com/b/allowed' },
    ]);

    expect(calls.length).toBe(1);
    const firstCall = calls[0]!;
    expect(firstCall.headers['authorization']).toBe(`Bearer ${token}`);
    expect(firstCall.url).not.toContain('key=');
    expect(firstCall.url).not.toContain('token=');
  });

  it('returns empty result when query does not match any allowed board name', async () => {
    const calls: Array<{ url: string; method: string; headers: any }> = [];
    const adapter = createAdapter(calls);

    // "Secret Beta" exists on Trello but is not in allowedBoardIds
    const boards = await adapter.searchBoards({ query: 'Secret' });
    expect(boards).toEqual([]);
  });

  it('rejects create_card when listId belongs to an unallowed board with 403 AUTH_ERROR and does not send POST', async () => {
    const calls: Array<{ url: string; method: string; headers: any }> = [];
    const adapter = createAdapter(calls);

    await expect(
      adapter.createCard({ listId: 'list-forbidden-2', title: 'Forbidden Card' })
    ).rejects.toMatchObject({
      category: 'AUTH_ERROR',
      statusCode: 403,
    });

    const postCall = calls.find((c) => c.method === 'POST' && c.url.includes('/cards'));
    expect(postCall).toBeUndefined();
  });

  it('rejects update_card moving card to an unallowed list with 403 AUTH_ERROR and does not send PUT', async () => {
    const calls: Array<{ url: string; method: string; headers: any }> = [];
    const adapter = createAdapter(calls);

    await expect(
      adapter.updateCard({ cardId: 'card-allowed-1', idList: 'list-forbidden-2' })
    ).rejects.toMatchObject({
      category: 'AUTH_ERROR',
      statusCode: 403,
    });

    const putCall = calls.find((c) => c.method === 'PUT');
    expect(putCall).toBeUndefined();
  });

  it('probe: previewed on A, fixture moves card to B (both A and B allowed), execution rejects step and does not send PUT to B', async () => {
    const calls: Array<{ url: string; method: string; headers: any }> = [];
    const boardA = 'board-A';
    const boardB = 'board-B';
    const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      const method = init?.method || 'GET';
      calls.push({ url, method, headers: (init?.headers as any) || {} });

      // Fixture: card-1 has been moved to board B
      if (url.includes('/cards/card-1') && method === 'GET') {
        return new Response(JSON.stringify({
          id: 'card-1',
          name: 'Task 1',
          idBoard: boardB,
          idList: 'list-B',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      if (url.includes('/cards/card-1') && method === 'PUT') {
        return new Response(JSON.stringify({
          id: 'card-1',
          name: 'Updated Task',
          idBoard: boardB,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
    };

    const adapter = new TrelloAdapter({
      credentials: { accessToken: 'token-abc' },
      allowedBoardIds: [boardA, boardB],
      allowedScope: { boards: [boardA, boardB] },
      fetchFn: fakeFetch as any,
    });

    await expect(
      adapter.execute('trello.update_card', { cardId: 'card-1', title: 'Updated Task' }, { boardId: boardA })
    ).rejects.toMatchObject({
      category: 'AUTH_ERROR',
      statusCode: 403,
    });

    const putCall = calls.find((c) => c.method === 'PUT');
    expect(putCall).toBeUndefined();
  });

  it('rejects get_card when card belongs to an unallowed board with 403 AUTH_ERROR', async () => {
    const calls: Array<{ url: string; method: string; headers: any }> = [];
    const adapter = createAdapter(calls);

    await expect(
      adapter.getCard({ cardId: 'card-forbidden-2' })
    ).rejects.toMatchObject({
      category: 'AUTH_ERROR',
      statusCode: 403,
    });
  });

  it('filters out cards on unallowed boards from search_cards', async () => {
    const calls: Array<{ url: string; method: string; headers: any }> = [];
    const adapter = createAdapter(calls);

    const cards = await adapter.searchCards({ query: 'Card' });
    expect(cards).toHaveLength(1);
    expect(cards[0].id).toBe('card-allowed-1');
  });

  it('rejects search_lists on unallowed board with 403 AUTH_ERROR', async () => {
    const calls: Array<{ url: string; method: string; headers: any }> = [];
    const adapter = createAdapter(calls);

    await expect(
      adapter.searchLists({ boardId: unallowedBoardId })
    ).rejects.toMatchObject({
      category: 'AUTH_ERROR',
      statusCode: 403,
    });
  });

  it('rejects search_members on unallowed board with 403 AUTH_ERROR', async () => {
    const calls: Array<{ url: string; method: string; headers: any }> = [];
    const adapter = createAdapter(calls);

    await expect(
      adapter.searchMembers({ query: 'Alice', boardId: unallowedBoardId })
    ).rejects.toMatchObject({
      category: 'AUTH_ERROR',
      statusCode: 403,
    });
  });

  it('rejects add_checklist when card belongs to unallowed board with 403 and does not send POST', async () => {
    const calls: Array<{ url: string; method: string; headers: any }> = [];
    const adapter = createAdapter(calls);

    await expect(
      adapter.addChecklist({ cardId: 'card-forbidden-2', title: 'Forbidden Checklist' })
    ).rejects.toMatchObject({
      category: 'AUTH_ERROR',
      statusCode: 403,
    });

    const postCall = calls.find((c) => c.method === 'POST' && c.url.includes('/checklists'));
    expect(postCall).toBeUndefined();
  });

  it('rejects add_member when member is not a member of the board with 403 and does not send POST', async () => {
    const calls: Array<{ url: string; method: string; headers: any }> = [];
    const adapter = createAdapter(calls);

    await expect(
      adapter.addMember({ cardId: 'card-allowed-1', memberId: 'stranger-id' })
    ).rejects.toMatchObject({
      category: 'AUTH_ERROR',
      statusCode: 403,
    });

    const postCall = calls.find((c) => c.method === 'POST' && c.url.includes('/idMembers'));
    expect(postCall).toBeUndefined();
  });

  it('throws NETWORK error when signal is aborted and does not swallow into empty result', async () => {
    const calls: Array<{ url: string; method: string; headers: any }> = [];
    const adapter = createAdapter(calls);

    const controller = new AbortController();
    controller.abort();

    await expect(
      adapter.searchBoards({ query: 'Project' }, { signal: controller.signal })
    ).rejects.toMatchObject({
      category: 'NETWORK',
    });
  });

  it('rejects get_card, create_card, update_card, add_member, and add_checklist before making any HTTP call when options.boardId is not in allowedBoardIds', async () => {
    const calls: Array<{ url: string; method: string; headers: any }> = [];
    const adapter = createAdapter(calls);

    await expect(
      adapter.execute('trello.get_card', { cardId: 'card-allowed-1' }, { boardId: unallowedBoardId })
    ).rejects.toMatchObject({
      category: 'AUTH_ERROR',
      statusCode: 403,
    });
    expect(calls).toHaveLength(0);

    await expect(
      adapter.execute('trello.create_card', { listId: 'list-allowed-1', title: 'X' }, { boardId: unallowedBoardId })
    ).rejects.toMatchObject({
      category: 'AUTH_ERROR',
      statusCode: 403,
    });
    expect(calls).toHaveLength(0);

    await expect(
      adapter.execute('trello.update_card', { cardId: 'card-allowed-1', title: 'X' }, { boardId: unallowedBoardId })
    ).rejects.toMatchObject({
      category: 'AUTH_ERROR',
      statusCode: 403,
    });
    expect(calls).toHaveLength(0);

    await expect(
      adapter.execute('trello.add_member', { cardId: 'card-allowed-1', memberId: 'member-allowed-1' }, { boardId: unallowedBoardId })
    ).rejects.toMatchObject({
      category: 'AUTH_ERROR',
      statusCode: 403,
    });
    expect(calls).toHaveLength(0);

    await expect(
      adapter.execute('trello.add_checklist', { cardId: 'card-allowed-1', title: 'Chk' }, { boardId: unallowedBoardId })
    ).rejects.toMatchObject({
      category: 'AUTH_ERROR',
      statusCode: 403,
    });
    expect(calls).toHaveLength(0);
  });
});
