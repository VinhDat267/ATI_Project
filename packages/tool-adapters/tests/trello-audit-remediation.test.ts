import { describe, it, expect, vi } from 'vitest';
import {
  TrelloBaseAdapter,
  TrelloReadTools,
  TrelloAdapter,
  SlackAdapter,
  StepError,
} from '../src/index.js';
import { StepRunner, ExecutionController } from '../../executor/src/index.js';
import { getToolDefinition } from '@wap/tool-schemas';

describe('Trello & Slack Audit Remediation Suite (Worker A: TRELLO-AUDIT-01..05, 08, R3)', () => {
  describe('TRELLO-AUDIT-01 (F1, P1) & T7: Resource ID validation & remove_member path substitution guard', () => {
    it('F1 / Lead T10: remove_member with memberId="../../FOREIGN" rejects with VALIDATION and sends 0 HTTP requests (never DELETE /1/cards/FOREIGN)', async () => {
      const calls: Array<{ method: string; path: string }> = [];
      const adapter = new TrelloAdapter({
        credentials: { accessToken: 'test-token' },
        allowedBoardIds: ['A'],
        allowedScope: { boards: ['A'] },
        baseUrl: 'http://127.0.0.1:9999/1',
        fetchFn: (async (input: RequestInfo | URL, init?: RequestInit) => {
          const u = new URL(String(input));
          calls.push({ method: init?.method || 'GET', path: u.pathname + u.search });
          return new Response(JSON.stringify({ id: 'C', idBoard: 'A', idMembers: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }) as typeof fetch,
      });

      await expect(
        adapter.execute(
          'trello.remove_member',
          { cardId: 'C', memberId: '../../FOREIGN' },
          { boardId: 'A' }
        )
      ).rejects.toMatchObject({
        category: 'VALIDATION',
        statusCode: 400,
        retryable: false,
        details: expect.objectContaining({ requestSent: false }),
      });

      expect(calls).toHaveLength(0);
    });

    it('declares strict resource ID pattern on trello.remove_member and all Trello resource ID schema fields', () => {
      const removeSchema = getToolDefinition('trello.remove_member')?.inputSchema;
      expect(removeSchema?.properties?.cardId?.pattern).toBeDefined();
      expect(removeSchema?.properties?.memberId?.pattern).toBeDefined();

      const memberPattern = new RegExp(removeSchema!.properties.memberId.pattern);
      expect(memberPattern.test('M1')).toBe(true);
      expect(memberPattern.test('5f4e3d2c1b0a9f8e7d6c5b4a')).toBe(true);
      expect(memberPattern.test('../../FOREIGN')).toBe(false);
      expect(memberPattern.test('../boards/SECRET')).toBe(false);
      expect(memberPattern.test('..%2f..%2fFOREIGN')).toBe(false);
      expect(memberPattern.test('a/b')).toBe(false);
      expect(memberPattern.test('a\\b')).toBe(false);
      expect(memberPattern.test('')).toBe(false);
      expect(memberPattern.test('   ')).toBe(false);
    });

    it('dispatches legitimate remove_member to DELETE /1/cards/:id/idMembers/:idMember', async () => {
      const calls: Array<{ method: string; path: string }> = [];
      const adapter = new TrelloAdapter({
        credentials: { accessToken: 'test-token' },
        allowedBoardIds: ['A'],
        allowedScope: { boards: ['A'] },
        baseUrl: 'http://127.0.0.1:9999/1',
        fetchFn: (async (input: RequestInfo | URL, init?: RequestInit) => {
          const u = new URL(String(input));
          const method = init?.method || 'GET';
          calls.push({ method, path: u.pathname + u.search });
          if (method === 'GET' && u.pathname === '/1/cards/C') {
            return new Response(JSON.stringify({ id: 'C', idBoard: 'A' }), { status: 200 });
          }
          if (method === 'DELETE' && u.pathname === '/1/cards/C/idMembers/M1') {
            return new Response(JSON.stringify([{ id: 'M2' }]), { status: 200 });
          }
          return new Response('unexpected', { status: 500 });
        }) as typeof fetch,
      });

      const res = await adapter.execute(
        'trello.remove_member',
        { cardId: 'C', memberId: 'M1' },
        { boardId: 'A' }
      );
      expect(res).toEqual({ id: 'C', idMembers: ['M2'] });
      expect(calls.some((c) => c.method === 'DELETE' && c.path === '/1/cards/C/idMembers/M1')).toBe(true);
    });

    it.each([
      '../boards/SECRET',
      '../../FOREIGN',
      '..%2f..%2fFOREIGN',
      '%2e%2e%2fSECRET',
      '%252e%252e%252fSECRET',
      'a/b',
      'a\\b',
      '.',
      '..',
      '',
      '   ',
      'card?fields=all',
      'card#hash',
      'http://127.0.0.1/1/cards/C',
      'card\u0000id',
      'card\nid',
    ])('T7: rejects malicious resource ID %j across Trello read/write tools with 0 HTTP requests', async (badId) => {
      const calls: string[] = [];
      const adapter = new TrelloAdapter({
        credentials: { accessToken: 'test-token' },
        allowedBoardIds: ['A', badId],
        allowedScope: { boards: ['A', badId] },
        baseUrl: 'http://127.0.0.1:9999/1',
        fetchFn: (async (input: RequestInfo | URL) => {
          calls.push(String(input));
          return new Response(JSON.stringify({ id: 'A', idBoard: 'A' }), { status: 200 });
        }) as typeof fetch,
      });

      await expect(adapter.getCard({ cardId: badId })).rejects.toMatchObject({ category: 'VALIDATION' });
      await expect(adapter.searchLists({ boardId: badId })).rejects.toMatchObject({ category: 'VALIDATION' });
      await expect(adapter.searchMembers({ boardId: badId, query: 'x' })).rejects.toMatchObject({ category: 'VALIDATION' });
      await expect(adapter.searchCards({ query: '', boardId: badId })).rejects.toMatchObject({ category: 'VALIDATION' });
      await expect(adapter.searchCards({ query: '', listId: badId })).rejects.toMatchObject({ category: 'VALIDATION' });
      await expect(adapter.createCard({ listId: badId, title: 'T' })).rejects.toMatchObject({ category: 'VALIDATION' });
      await expect(adapter.updateCard({ cardId: badId, title: 'T' })).rejects.toMatchObject({ category: 'VALIDATION' });
      await expect(adapter.addChecklist({ cardId: badId, title: 'Chk' })).rejects.toMatchObject({ category: 'VALIDATION' });
      await expect(adapter.addMember({ cardId: 'C', memberId: badId })).rejects.toMatchObject({ category: 'VALIDATION' });
      await expect(adapter.removeMember({ cardId: 'C', memberId: badId })).rejects.toMatchObject({ category: 'VALIDATION' });
      await expect(adapter.addComment({ cardId: badId, text: 'hi' })).rejects.toMatchObject({ category: 'VALIDATION' });
      await expect(adapter.createList({ boardId: badId, name: 'L' })).rejects.toMatchObject({ category: 'VALIDATION' });
      await expect(
        adapter.updateChecklistItem({ cardId: 'C', checkItemId: badId, itemName: 'item', state: 'complete' })
      ).rejects.toMatchObject({ category: 'VALIDATION' });
      await expect(adapter.setCardDueComplete({ cardId: badId, dueComplete: true })).rejects.toMatchObject({
        category: 'VALIDATION',
      });

      expect(calls).toHaveLength(0);
    });

    it('guards TrelloBaseAdapter.request directly against dot-segment path normalization', async () => {
      const calls: string[] = [];
      const base = new TrelloBaseAdapter({
        credentials: { accessToken: 'test-token' },
        baseUrl: 'http://127.0.0.1:9999/1',
        fetchFn: (async (input: RequestInfo | URL) => {
          calls.push(String(input));
          return new Response('{}', { status: 200 });
        }) as typeof fetch,
      });

      await expect(base.request('/cards/C/idMembers/../../FOREIGN', { method: 'DELETE' })).rejects.toMatchObject({
        category: 'VALIDATION',
      });
      await expect(base.request('/cards/../boards/SECRET')).rejects.toMatchObject({
        category: 'VALIDATION',
      });
      await expect(base.request('/cards/%2e%2e/boards/SECRET')).rejects.toMatchObject({
        category: 'VALIDATION',
      });
      expect(calls).toHaveLength(0);
    });
  });

  describe('TRELLO-AUDIT-02 (F2, P2): Pre-fetch scope validation for T1, T2, T3', () => {
    it('T1: get_card checks minimal card metadata (id,idBoard) first and never fetches ?checklists=all for out-of-scope card', async () => {
      const calls: string[] = [];
      const adapter = new TrelloAdapter({
        credentials: { accessToken: 'test-token' },
        allowedBoardIds: ['A'],
        allowedScope: { boards: ['A'] },
        baseUrl: 'http://127.0.0.1:9999/1',
        fetchFn: (async (input: RequestInfo | URL) => {
          const u = new URL(String(input));
          const pathWithQuery = u.pathname + u.search;
          calls.push(pathWithQuery);
          if (u.pathname === '/1/cards/foreign') {
            return new Response(
              JSON.stringify({
                id: 'foreign',
                idBoard: 'B',
                name: 'secret card',
                desc: 'secret description',
                checklists: [{ id: 'k', name: 'secret checklist', checkItems: [] }],
              }),
              { status: 200 }
            );
          }
          return new Response('{}', { status: 404 });
        }) as typeof fetch,
      });

      await expect(adapter.execute('trello.get_card', { cardId: 'foreign' }, { boardId: 'A' })).rejects.toMatchObject({
        category: 'AUTH_ERROR',
        statusCode: 403,
      });

      expect(calls).toEqual(['/1/cards/foreign?fields=id,idBoard']);
      expect(calls.some((c) => c.includes('checklists=all'))).toBe(false);
    });

    it('T2: search_cards with empty query and foreign listId checks /lists/:id?fields=id,idBoard first and never fetches /lists/:id/cards', async () => {
      const calls: string[] = [];
      const adapter = new TrelloAdapter({
        credentials: { accessToken: 'test-token' },
        allowedBoardIds: ['A'],
        allowedScope: { boards: ['A'] },
        baseUrl: 'http://127.0.0.1:9999/1',
        fetchFn: (async (input: RequestInfo | URL) => {
          const u = new URL(String(input));
          const pathWithQuery = u.pathname + u.search;
          calls.push(pathWithQuery);
          if (u.pathname === '/1/lists/foreign') {
            return new Response(JSON.stringify({ id: 'foreign', idBoard: 'B' }), { status: 200 });
          }
          if (u.pathname === '/1/lists/foreign/cards') {
            return new Response(
              JSON.stringify([{ id: 'c_secret', idBoard: 'B', idList: 'foreign', name: 'secret' }]),
              { status: 200 }
            );
          }
          return new Response('{}', { status: 404 });
        }) as typeof fetch,
      });

      await expect(
        adapter.execute('trello.search_cards', { query: '', listId: 'foreign' }, { boardId: 'A' })
      ).rejects.toMatchObject({
        category: 'AUTH_ERROR',
        statusCode: 403,
      });

      expect(calls).toEqual(['/1/lists/foreign?fields=id,idBoard']);
      expect(calls.some((c) => c.includes('/lists/foreign/cards'))).toBe(false);
    });

    it('T3: search_cards with non-empty query constrains /1/search with idBoards parameter', async () => {
      const calls: string[] = [];
      const adapter = new TrelloAdapter({
        credentials: { accessToken: 'test-token' },
        allowedBoardIds: ['A', 'B'],
        allowedScope: { boards: ['A', 'B'] },
        baseUrl: 'http://127.0.0.1:9999/1',
        fetchFn: (async (input: RequestInfo | URL) => {
          const u = new URL(String(input));
          calls.push(u.pathname + u.search);
          return new Response(
            JSON.stringify({
              cards: [{ id: 'c1', idBoard: 'A', idList: 'L', name: 'release v1', url: 'https://trello.com/c/c1' }],
            }),
            { status: 200 }
          );
        }) as typeof fetch,
      });

      await adapter.execute('trello.search_cards', { query: 'release', boardId: 'A' }, { boardId: 'A' });
      expect(calls).toHaveLength(1);
      const searchUrl = new URL('http://127.0.0.1:9999' + calls[0]!);
      expect(searchUrl.searchParams.get('idBoards')).toBe('A');

      calls.length = 0;
      await adapter.execute('trello.search_cards', { query: 'release' });
      expect(calls).toHaveLength(1);
      const multiSearchUrl = new URL('http://127.0.0.1:9999' + calls[0]!);
      expect(multiSearchUrl.searchParams.get('idBoards')).toBe('A,B');
    });
  });

  describe('TRELLO-AUDIT-03 (F3, P2): Compound checklist partial write & retry protection (T4 / T4_RETRY)', () => {
    it('T4 & T4_RETRY: marks add_checklist as status="unknown" when second checkItem fails with 403 and prevents ExecutionController.retryStep from duplicating checklist', async () => {
      let checklistPosts = 0;
      let itemPosts = 0;

      const adapter = new TrelloAdapter({
        credentials: { accessToken: 'test-token' },
        allowedBoardIds: ['A'],
        allowedScope: { boards: ['A'] },
        baseUrl: 'http://127.0.0.1:9999/1',
        fetchFn: (async (input: RequestInfo | URL, init?: RequestInit) => {
          const u = new URL(String(input));
          const method = init?.method || 'GET';
          if (u.pathname === '/1/cards/C' && method === 'GET') {
            return new Response(JSON.stringify({ id: 'C', idBoard: 'A' }), { status: 200 });
          }
          if (u.pathname === '/1/cards/C/checklists' && method === 'POST') {
            checklistPosts++;
            return new Response(JSON.stringify({ id: `chk${checklistPosts}`, name: 'Todo' }), { status: 200 });
          }
          if (u.pathname.startsWith('/1/checklists/') && u.pathname.endsWith('/checkItems') && method === 'POST') {
            itemPosts++;
            if (itemPosts === 1) {
              return new Response(JSON.stringify({ id: 'item1', name: 'one', state: 'incomplete' }), { status: 200 });
            }
            return new Response('forbidden on item 2', { status: 403 });
          }
          return new Response('not found', { status: 404 });
        }) as typeof fetch,
      });

      const runner = new StepRunner({ getAdapter: () => adapter as any });
      const steps = [
        {
          id: 's1',
          tool: 'trello.add_checklist',
          description: 'Add checklist with two items',
          args: { cardId: 'C', title: 'Todo', items: ['one', 'two'] },
          dependsOn: [],
        },
      ];

      const controller = new ExecutionController({ runner, steps: steps as any });
      const firstRun = await controller.runUntilPause();

      expect(checklistPosts).toBe(1);
      expect(itemPosts).toBe(2);
      expect(controller.getStepState('s1')?.status).toBe('unknown');
      expect(firstRun.status).toBe('partial');
      expect(controller.getStepState('s1')?.error?.details).toMatchObject({
        partialWrite: true,
        requestSent: true,
        checklistId: 'chk1',
        failedItemIndex: 1,
      });

      await expect(controller.retryStep('s1')).rejects.toThrow(/Cannot retry/);
      expect(checklistPosts).toBe(1);
    });
  });

  describe('TRELLO-AUDIT-04 (F4, P2): TrelloAdapter.execute("trello.search_cards") preserves args.boardId (T9)', () => {
    it('T9: preserves args.boardId when context or context.boardId is omitted', async () => {
      const calls: string[] = [];
      const adapter = new TrelloAdapter({
        credentials: { accessToken: 'test-token' },
        allowedBoardIds: ['A', 'B'],
        allowedScope: { boards: ['A', 'B'] },
        baseUrl: 'http://127.0.0.1:9999/1',
        fetchFn: (async (input: RequestInfo | URL) => {
          const u = new URL(String(input));
          calls.push(u.pathname);
          const board = u.pathname.includes('/boards/A/') ? 'A' : 'B';
          return new Response(
            JSON.stringify([{ id: `c_${board}`, name: `card_${board}`, idBoard: board, idList: `L_${board}`, url: 'https://trello.com/c/1' }]),
            { status: 200 }
          );
        }) as typeof fetch,
      });

      const res = await adapter.execute('trello.search_cards', { query: '', boardId: 'A' });
      expect(calls).toEqual(['/1/boards/A/cards']);
      expect(res.map((c: any) => c.boardId)).toEqual(['A']);

      calls.length = 0;
      const readTools = new TrelloReadTools({
        credentials: { accessToken: 'test-token' },
        allowedBoardIds: ['A', 'B'],
        allowedScope: { boards: ['A', 'B'] },
        baseUrl: 'http://127.0.0.1:9999/1',
        fetchFn: (async (input: RequestInfo | URL) => {
          const u = new URL(String(input));
          calls.push(u.pathname);
          const board = u.pathname.includes('/boards/A/') ? 'A' : 'B';
          return new Response(
            JSON.stringify([{ id: `c_${board}`, name: `card_${board}`, idBoard: board, idList: `L_${board}`, url: 'https://trello.com/c/1' }]),
            { status: 200 }
          );
        }) as typeof fetch,
      });

      const resRead = await readTools.execute('trello.search_cards', { query: '', boardId: 'A' });
      expect(calls).toEqual(['/1/boards/A/cards']);
      expect(resRead.map((c: any) => c.boardId)).toEqual(['A']);
    });

    it('rejects search_cards when args.boardId and context.boardId conflict', async () => {
      const calls: string[] = [];
      const adapter = new TrelloAdapter({
        credentials: { accessToken: 'test-token' },
        allowedBoardIds: ['A', 'B'],
        allowedScope: { boards: ['A', 'B'] },
        baseUrl: 'http://127.0.0.1:9999/1',
        fetchFn: (async (input: RequestInfo | URL) => {
          calls.push(String(input));
          return new Response('[]', { status: 200 });
        }) as typeof fetch,
      });

      await expect(
        adapter.execute('trello.search_cards', { query: '', boardId: 'B' }, { boardId: 'A' })
      ).rejects.toMatchObject({
        category: 'AUTH_ERROR',
        statusCode: 403,
      });
      expect(calls).toHaveLength(0);
    });
  });

  describe('TRELLO-AUDIT-05 (AUTO-01 / PROD-03, P2): Honest scan coverage metadata & card deduplication', () => {
    it('deduplicates duplicate card IDs and attaches honest non-enumerable scanMetadata on 50+ card boards', async () => {
      const fixtureCards = Array.from({ length: 60 }, (_, idx) => ({
        id: idx === 1 ? 'card_0' : `card_${idx}`, // card_0 is duplicated at index 0 and 1
        name: `Task ${idx}`,
        url: `https://trello.com/c/card_${idx}`,
        idList: 'L1',
        idBoard: 'A',
        due: null,
        dueComplete: false,
        idMembers: [],
        labels: [],
      }));

      const adapter = new TrelloAdapter({
        credentials: { accessToken: 'test-token' },
        allowedBoardIds: ['A'],
        allowedScope: { boards: ['A'] },
        baseUrl: 'http://127.0.0.1:9999/1',
        fetchFn: (async () => {
          return new Response(JSON.stringify(fixtureCards), { status: 200 });
        }) as typeof fetch,
      });

      const cards: any = await adapter.execute('trello.search_cards', { query: '', boardId: 'A', limit: 50 });
      expect(Array.isArray(cards)).toBe(true);
      const uniqueIds = new Set(cards.map((c: any) => c.id));
      expect(uniqueIds.size).toBe(cards.length);
      expect(cards).toHaveLength(50);

      expect(cards.scanMetadata).toBeDefined();
      expect(cards.scanMetadata).toMatchObject({
        available: 'UNKNOWN',
        prefixLimit: 50,
        scannedCount: 60,
        uniqueScannedCount: 59,
        duplicateCountDropped: 1,
        matchedCount: 59,
        displayedCount: 50,
        limitApplied: 50,
        prefixCapReached: true,
        truncatedByLimit: true,
        isComplete: false,
      });
    });
  });

  describe('TRELLO-AUDIT-08 (AUTO-04, P2): Slack send_message malformed 200 receipt invariant', () => {
    it('throws StepError(UNKNOWN) when Slack chat.postMessage returns ok:true without valid ts and marks step as unknown', async () => {
      const slackAdapter = new SlackAdapter({
        credentials: { botToken: 'xoxb-valid' },
        allowedScope: { channels: ['C1'] },
        fetchFn: (async (url: string | URL) => {
          const urlStr = String(url);
          if (urlStr.includes('/conversations.list')) {
            return new Response(
              JSON.stringify({ ok: true, channels: [{ id: 'C1', name: 'general', is_private: false }] }),
              { status: 200 }
            );
          }
          if (urlStr.includes('/chat.postMessage')) {
            return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
          }
          return new Response('not found', { status: 404 });
        }) as typeof fetch,
      });

      await expect(slackAdapter.sendMessage({ channel: 'C1', text: 'Digest' })).rejects.toMatchObject({
        category: 'UNKNOWN',
        retryable: false,
      });

      const runner = new StepRunner({ getAdapter: () => slackAdapter as any });
      const stepRes = await runner.executeStep(
        {
          id: 'slack_step',
          tool: 'slack.send_message',
          description: 'Send Slack digest',
          args: { channel: 'C1', text: 'Digest' },
          dependsOn: [],
        },
        new Map()
      );
      expect(stepRes.status).toBe('unknown');
      expect(stepRes.output).toBeNull();
    });
  });

  describe('R3: create_card idMembers board membership preflight consistency', () => {
    it('rejects create_card before POST /cards when any idMembers entry is not a member of the target board', async () => {
      const calls: Array<{ method: string; path: string }> = [];
      const adapter = new TrelloAdapter({
        credentials: { accessToken: 'test-token' },
        allowedBoardIds: ['A'],
        allowedScope: { boards: ['A'] },
        baseUrl: 'http://127.0.0.1:9999/1',
        fetchFn: (async (input: RequestInfo | URL, init?: RequestInit) => {
          const u = new URL(String(input));
          const method = init?.method || 'GET';
          calls.push({ method, path: u.pathname });
          if (method === 'GET' && u.pathname === '/1/lists/L1') {
            return new Response(JSON.stringify({ id: 'L1', idBoard: 'A' }), { status: 200 });
          }
          if (method === 'GET' && u.pathname === '/1/boards/A/members') {
            return new Response(JSON.stringify([{ id: 'M_ALLOWED' }]), { status: 200 });
          }
          if (method === 'POST' && u.pathname === '/1/cards') {
            return new Response(
              JSON.stringify({ id: 'C_NEW', name: 'Card', idList: 'L1', url: 'https://trello.com/c/C_NEW' }),
              { status: 200 }
            );
          }
          return new Response('not found', { status: 404 });
        }) as typeof fetch,
      });

      await expect(
        adapter.createCard({
          listId: 'L1',
          title: 'Card with unauthorized member',
          idMembers: ['M_STRANGER'],
        })
      ).rejects.toMatchObject({
        category: 'AUTH_ERROR',
        statusCode: 403,
        retryable: false,
      });

      expect(calls.some((c) => c.method === 'POST' && c.path === '/1/cards')).toBe(false);

      calls.length = 0;
      const created = await adapter.createCard({
        listId: 'L1',
        title: 'Card with authorized member',
        idMembers: ['M_ALLOWED'],
      });
      expect(created.id).toBe('C_NEW');
      expect(calls.some((c) => c.method === 'POST' && c.path === '/1/cards')).toBe(true);
    });
  });
});
