import { describe, expect, it } from 'vitest';
import { TrelloAdapter } from '../src/index.js';

type Call = { method: string; path: string; search: URLSearchParams; body?: any };

const CARDS: Record<string, any> = {
  C1: { id: 'C1', idBoard: 'B1', name: 'Card one', idMembers: ['M1'], idLabels: ['LB1'], desc: 'secret-ish' },
  CX: { id: 'CX', idBoard: 'BX', name: 'Foreign card', idMembers: ['MX'], idLabels: ['LBX'], desc: 'foreign data' },
};
const LISTS: Record<string, any> = {
  L1: { id: 'L1', idBoard: 'B1', name: 'To Do' },
  L2: { id: 'L2', idBoard: 'B2', name: 'Other board list' },
  LX: { id: 'LX', idBoard: 'BX', name: 'Foreign list' },
};
const LABELS: Record<string, any> = {
  LB1: { id: 'LB1', idBoard: 'B1', name: 'Bug', color: 'red' },
  LB2: { id: 'LB2', idBoard: 'B1', name: 'Ưu tiên cao', color: 'orange' },
  LBB2: { id: 'LBB2', idBoard: 'B2', name: 'Other board label', color: 'green' },
  LBX: { id: 'LBX', idBoard: 'BX', name: 'Foreign label', color: 'blue' },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Projects a resource to the requested `fields`, like Trello does. */
function project(resource: any, search: URLSearchParams): any {
  const fields = search.get('fields');
  if (!fields) return resource;
  return Object.fromEntries(fields.split(',').filter((f) => f in resource).map((f) => [f, resource[f]]));
}

function makeAdapter(overrides: (call: Call) => Response | Promise<Response> | undefined = () => undefined) {
  const calls: Call[] = [];
  const fetchFn = (async (input: string | URL, init?: RequestInit) => {
    const u = new URL(String(input));
    const call: Call = {
      method: init?.method ?? 'GET',
      path: u.pathname.replace(/^\/1/, ''),
      search: u.searchParams,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const overridden = await overrides(call);
    if (overridden) return overridden;
    const seg = call.path.split('/').filter(Boolean);
    if (call.method === 'GET') {
      if (seg[0] === 'cards' && seg.length === 2 && CARDS[seg[1]!]) return json(project(CARDS[seg[1]!], call.search));
      if (seg[0] === 'cards' && seg[2] === 'checklists') {
        return json([{ id: 'chk1', checkItems: [{ id: 'item1', name: 'Write tests', state: 'incomplete' }] }]);
      }
      if (seg[0] === 'lists' && seg.length === 2 && LISTS[seg[1]!]) return json(project(LISTS[seg[1]!], call.search));
      if (seg[0] === 'labels' && seg.length === 2 && LABELS[seg[1]!]) return json(project(LABELS[seg[1]!], call.search));
      if (seg[0] === 'boards' && seg[2] === 'members') return json([{ id: 'M1' }, { id: 'M2' }]);
      if (seg[0] === 'boards' && seg[2] === 'labels') {
        return json(Object.values(LABELS).filter((l) => l.idBoard === seg[1]).map((l) => project(l, call.search)));
      }
      return json({ message: 'not found' }, 404);
    }
    if (call.method === 'POST' && call.path === '/cards') {
      return json({ id: 'NEW', name: call.body?.name, url: 'https://trello.com/c/NEW', idList: call.body?.idList });
    }
    if (call.method === 'POST' && seg[2] === 'idLabels') return json([...(CARDS[seg[1]!]?.idLabels ?? []), call.body?.value]);
    if (call.method === 'DELETE' && seg[2] === 'idLabels') return json([]);
    if (call.method === 'PUT' && seg[0] === 'cards') return json({ id: seg[1], name: 'Card one', url: 'u', idList: call.body?.idList ?? 'L1' });
    if (call.method === 'POST' && seg[2] === 'actions') return json({ id: 'act1', data: { text: call.body?.text } });
    if (call.method === 'POST' && call.path === '/lists') return json({ id: 'LNEW', name: call.body?.name, idBoard: call.body?.idBoard });
    return json({});
  }) as typeof fetch;
  const adapter = new TrelloAdapter({
    credentials: { accessToken: 'tok' },
    allowedBoardIds: ['B1', 'B2'],
    baseUrl: 'http://trello.test/1',
    fetchFn,
  });
  return { adapter, calls };
}

const writes = (calls: Call[]) => calls.filter((c) => c.method !== 'GET');

async function rejection(promise: Promise<unknown>): Promise<any> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('expected the call to reject');
}

describe('Trello write tools: scope rejection never sends a write', () => {
  const foreignCardCases: Array<[string, Record<string, any>]> = [
    ['trello.update_card', { cardId: 'CX', title: 'x' }],
    ['trello.add_member', { cardId: 'CX', memberId: 'M1' }],
    ['trello.remove_member', { cardId: 'CX', memberId: 'MX' }],
    ['trello.add_checklist', { cardId: 'CX', title: 'chk', items: ['a'] }],
    ['trello.add_comment', { cardId: 'CX', text: 'hello' }],
    ['trello.update_checklist_item', { cardId: 'CX', itemName: 'Write tests', state: 'complete' }],
    ['trello.set_card_due_complete', { cardId: 'CX', dueComplete: true }],
    ['trello.add_label', { cardId: 'CX', labelId: 'LBX' }],
    ['trello.remove_label', { cardId: 'CX', labelId: 'LBX' }],
  ];

  for (const [tool, args] of foreignCardCases) {
    it(`${tool} on a card of a foreign board → AUTH_ERROR, requestSent:false, only a minimal GET`, async () => {
      const { adapter, calls } = makeAdapter();
      const err = await rejection(adapter.execute(tool, args));
      expect(err).toMatchObject({ category: 'AUTH_ERROR', details: { requestSent: false } });
      expect(writes(calls)).toHaveLength(0);
      expect(calls).toHaveLength(1);
      expect(calls[0]!.path).toBe('/cards/CX');
      // Only id/idBoard (+ fields the tool needs) are requested, never the full foreign card.
      const fields = calls[0]!.search.get('fields')!.split(',');
      expect(fields.slice(0, 2)).toEqual(['id', 'idBoard']);
      expect(fields).not.toContain('desc');
      expect(JSON.stringify(err)).not.toContain('foreign data');
    });
  }

  it('trello.create_card on a list of a foreign board → AUTH_ERROR without POST', async () => {
    const { adapter, calls } = makeAdapter();
    const err = await rejection(adapter.execute('trello.create_card', { listId: 'LX', title: 'x' }));
    expect(err).toMatchObject({ category: 'AUTH_ERROR', details: { requestSent: false } });
    expect(writes(calls)).toHaveLength(0);
    expect(calls.map((c) => [c.path, c.search.get('fields')])).toEqual([['/lists/LX', 'id,idBoard']]);
  });

  it('trello.create_list with a foreign boardId → AUTH_ERROR without any request', async () => {
    const { adapter, calls } = makeAdapter();
    const err = await rejection(adapter.execute('trello.create_list', { boardId: 'BX', name: 'Sprint' }));
    expect(err).toMatchObject({ category: 'AUTH_ERROR', details: { requestSent: false } });
    expect(calls).toHaveLength(0);
  });

  it('a step bound to another allowed board rejects before writing', async () => {
    const { adapter, calls } = makeAdapter();
    const err = await rejection(adapter.execute('trello.add_comment', { cardId: 'C1', text: 'hi' }, { boardId: 'B2' }));
    expect(err).toMatchObject({ category: 'AUTH_ERROR', details: { requestSent: false } });
    expect(writes(calls)).toHaveLength(0);
  });
});

describe('Trello write tools: requestSent semantics around dispatch', () => {
  it('classifies a response-body disconnect as network failure without claiming the write was unsent', async () => {
    const { adapter } = makeAdapter((call) => {
      if (call.method !== 'POST') return undefined;
      return new Response(new ReadableStream({
        start(controller) {
          controller.error(new TypeError('Connection interrupted while reading response'));
        },
      }));
    });

    const error = await rejection(adapter.execute('trello.add_comment', { cardId: 'C1', text: 'hi' }));
    expect(error).toMatchObject({ category: 'NETWORK' });
    expect(error.details?.requestSent).not.toBe(false);
  });

  it('a failing pre-check GET (5xx) carries requestSent:false and sends no write', async () => {
    const { adapter, calls } = makeAdapter((c) => (c.method === 'GET' ? json({ message: 'boom' }, 503) : undefined));
    const err = await rejection(adapter.execute('trello.add_comment', { cardId: 'C1', text: 'hi' }));
    expect(err).toMatchObject({ category: 'SERVER_ERROR', details: { requestSent: false } });
    expect(writes(calls)).toHaveLength(0);
  });

  it('a pre-check network failure carries requestSent:false', async () => {
    const { adapter, calls } = makeAdapter((c) => {
      if (c.method === 'GET') throw new TypeError('socket hang up');
      return undefined;
    });
    const err = await rejection(adapter.execute('trello.set_card_due_complete', { cardId: 'C1', dueComplete: true }));
    expect(err).toMatchObject({ category: 'NETWORK', details: { requestSent: false } });
    expect(writes(calls)).toHaveLength(0);
  });

  it('a 5xx on the write itself does NOT claim requestSent:false (outcome unknown)', async () => {
    const { adapter, calls } = makeAdapter((c) => (c.method === 'POST' ? json({ message: 'boom' }, 502) : undefined));
    const err = await rejection(adapter.execute('trello.add_comment', { cardId: 'C1', text: 'hi' }));
    expect(err).toMatchObject({ category: 'SERVER_ERROR', retryable: false });
    expect(err.details?.requestSent).not.toBe(false);
    expect(writes(calls)).toHaveLength(1);
  });

  it('a network failure on the write itself does NOT claim requestSent:false', async () => {
    const { adapter } = makeAdapter((c) => {
      if (c.method === 'PUT') throw new TypeError('connection reset');
      return undefined;
    });
    const err = await rejection(adapter.execute('trello.update_card', { cardId: 'C1', title: 'New' }));
    expect(err).toMatchObject({ category: 'NETWORK' });
    expect(err.details?.requestSent).not.toBe(false);
  });
});

describe('trello.update_card list moves', () => {
  it('rejects a move to a list on another allowed board with VALIDATION and no PUT', async () => {
    const { adapter, calls } = makeAdapter();
    const err = await rejection(adapter.execute('trello.update_card', { cardId: 'C1', idList: 'L2' }));
    expect(err).toMatchObject({ category: 'VALIDATION', details: { requestSent: false, field: 'idList' } });
    expect(writes(calls)).toHaveLength(0);
    expect(calls.find((c) => c.path === '/lists/L2')!.search.get('fields')).toBe('id,idBoard');
  });

  it('rejects a move to a list on a foreign board with AUTH_ERROR and no PUT', async () => {
    const { adapter, calls } = makeAdapter();
    const err = await rejection(adapter.execute('trello.update_card', { cardId: 'C1', idList: 'LX' }));
    expect(err).toMatchObject({ category: 'AUTH_ERROR', details: { requestSent: false } });
    expect(writes(calls)).toHaveLength(0);
  });

  it('moves within the same board', async () => {
    const { adapter, calls } = makeAdapter();
    const out = await adapter.execute('trello.update_card', { cardId: 'C1', idList: 'L1', closed: true });
    expect(out).toMatchObject({ id: 'C1', listId: 'L1' });
    expect(writes(calls)).toEqual([expect.objectContaining({ method: 'PUT', path: '/cards/C1', body: { idList: 'L1', closed: true } })]);
  });
});

describe('Trello labels', () => {
  it('search_labels lists labels of an allowed board and filters by name or color', async () => {
    const { adapter, calls } = makeAdapter();
    const all = await adapter.execute('trello.search_labels', { boardId: 'B1' });
    expect(all).toEqual([
      { id: 'LB1', name: 'Bug', color: 'red', boardId: 'B1' },
      { id: 'LB2', name: 'Ưu tiên cao', color: 'orange', boardId: 'B1' },
    ]);
    expect(calls[0]!.path).toBe('/boards/B1/labels');
    const byColor = await adapter.execute('trello.search_labels', { boardId: 'B1', query: 'ORANGE' });
    expect(byColor.map((l: any) => l.id)).toEqual(['LB2']);
  });

  it('search_labels refuses a foreign board without any request', async () => {
    const { adapter, calls } = makeAdapter();
    const err = await rejection(adapter.execute('trello.search_labels', { boardId: 'BX' }));
    expect(err).toMatchObject({ category: 'AUTH_ERROR', details: { requestSent: false } });
    expect(calls).toHaveLength(0);
  });

  it('add_label verifies the label belongs to the card board, then POSTs idLabels', async () => {
    const { adapter, calls } = makeAdapter();
    const out = await adapter.execute('trello.add_label', { cardId: 'C1', labelId: 'LB2' });
    expect(out).toEqual({ id: 'C1', labelId: 'LB2', idLabels: ['LB1', 'LB2'] });
    const labelGet = calls.find((c) => c.path === '/labels/LB2')!;
    expect(labelGet.search.get('fields')).toBe('id,idBoard,name,color');
    expect(writes(calls)).toEqual([expect.objectContaining({ method: 'POST', path: '/cards/C1/idLabels', body: { value: 'LB2' } })]);
  });

  it('add_label rejects a label from another board with VALIDATION and no POST', async () => {
    for (const labelId of ['LBB2', 'LBX']) {
      const { adapter, calls } = makeAdapter();
      const err = await rejection(adapter.execute('trello.add_label', { cardId: 'C1', labelId }));
      expect(err).toMatchObject({ category: 'VALIDATION', details: { requestSent: false, field: 'labelId' } });
      expect(writes(calls)).toHaveLength(0);
    }
  });

  it('add_label is a no-op when the label is already on the card', async () => {
    const { adapter, calls } = makeAdapter();
    const out = await adapter.execute('trello.add_label', { cardId: 'C1', labelId: 'LB1' });
    expect(out).toMatchObject({ id: 'C1', labelId: 'LB1', alreadyPresent: true });
    expect(writes(calls)).toHaveLength(0);
  });

  it('remove_label DELETEs a label that is on the card', async () => {
    const { adapter, calls } = makeAdapter();
    const out = await adapter.execute('trello.remove_label', { cardId: 'C1', labelId: 'LB1' });
    expect(out).toEqual({ id: 'C1', labelId: 'LB1' });
    expect(writes(calls)).toEqual([expect.objectContaining({ method: 'DELETE', path: '/cards/C1/idLabels/LB1' })]);
  });

  it('remove_label of a label not on the card → NOT_FOUND without DELETE', async () => {
    const { adapter, calls } = makeAdapter();
    const err = await rejection(adapter.execute('trello.remove_label', { cardId: 'C1', labelId: 'LB2' }));
    expect(err).toMatchObject({ category: 'NOT_FOUND', details: { requestSent: false } });
    expect(writes(calls)).toHaveLength(0);
  });

  it('create_card attaches idLabels of the list board', async () => {
    const { adapter, calls } = makeAdapter();
    await adapter.execute('trello.create_card', { listId: 'L1', title: 'Fix', idLabels: ['LB1', 'LB2'] });
    expect(writes(calls)).toEqual([
      expect.objectContaining({ method: 'POST', path: '/cards', body: { idList: 'L1', name: 'Fix', idLabels: ['LB1', 'LB2'] } }),
    ]);
  });

  it('create_card rejects idLabels from another board without POST', async () => {
    const { adapter, calls } = makeAdapter();
    const err = await rejection(adapter.execute('trello.create_card', { listId: 'L1', title: 'Fix', idLabels: ['LBX'] }));
    expect(err).toMatchObject({ category: 'VALIDATION', details: { requestSent: false, field: 'idLabels' } });
    expect(writes(calls)).toHaveLength(0);
  });
});

describe('Trello adapter-side input bounds', () => {
  const cases: Array<[string, string, Record<string, any>]> = [
    ['title over 512', 'trello.create_card', { listId: 'L1', title: 'x'.repeat(513) }],
    ['empty title', 'trello.create_card', { listId: 'L1', title: '   ' }],
    ['desc over 16384', 'trello.create_card', { listId: 'L1', title: 't', desc: 'x'.repeat(16385) }],
    ['due not ISO date-time', 'trello.create_card', { listId: 'L1', title: 't', due: 'tomorrow' }],
    ['due without timezone', 'trello.update_card', { cardId: 'C1', due: '2026-10-02T17:00:00' }],
    ['update title over 512', 'trello.update_card', { cardId: 'C1', title: 'x'.repeat(513) }],
    ['comment over 16384', 'trello.add_comment', { cardId: 'C1', text: 'x'.repeat(16385) }],
    ['empty comment', 'trello.add_comment', { cardId: 'C1', text: '' }],
    ['101 checklist items', 'trello.add_checklist', { cardId: 'C1', title: 'c', items: Array.from({ length: 101 }, (_, i) => `i${i}`) }],
    ['checklist item over 512', 'trello.add_checklist', { cardId: 'C1', title: 'c', items: ['x'.repeat(513)] }],
    ['list name over 512', 'trello.create_list', { boardId: 'B1', name: 'x'.repeat(513) }],
  ];
  for (const [label, tool, args] of cases) {
    it(`${tool}: ${label} → VALIDATION before any request`, async () => {
      const { adapter, calls } = makeAdapter();
      const err = await rejection(adapter.execute(tool, args));
      expect(err).toMatchObject({ category: 'VALIDATION', details: { requestSent: false } });
      expect(calls).toHaveLength(0);
    });
  }

  it('accepts boundary values', async () => {
    const { adapter, calls } = makeAdapter();
    await adapter.execute('trello.create_card', {
      listId: 'L1',
      title: 'x'.repeat(512),
      desc: 'd'.repeat(16384),
      due: '2026-10-02T17:00:00+07:00',
    });
    expect(writes(calls)).toHaveLength(1);
  });
});

describe('trello.search_cards scan coverage', () => {
  const cards = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `card_${i}`, name: `Task ${i}`, idList: 'L1', idBoard: 'B1', dateLastActivity: '2026-11-01T00:00:00.000Z' }));

  it('flags prefixCapReached only when /search returned more than the prefix limit', async () => {
    const { adapter, calls } = makeAdapter((c) => (c.path === '/search' ? json({ cards: cards(51) }) : undefined));
    const result: any = await adapter.execute('trello.search_cards', { query: 'task', boardId: 'B1', limit: 50 });
    expect(calls[0]!.search.get('cards_limit')).toBe('51');
    expect(result).toHaveLength(50);
    expect(result.scanMetadata).toMatchObject({ scannedCount: 50, prefixCapReached: true, truncatedByLimit: false });
    expect(result[0].dateLastActivity).toBe('2026-11-01T00:00:00.000Z');
  });

  it('does not flag a cap when exactly the prefix limit was returned', async () => {
    const { adapter } = makeAdapter((c) => (c.path === '/search' ? json({ cards: cards(50) }) : undefined));
    const result: any = await adapter.execute('trello.search_cards', { query: 'task', boardId: 'B1', limit: 50 });
    expect(result.scanMetadata).toMatchObject({ scannedCount: 50, prefixCapReached: false });
  });

  it('never flags a cap for a full board listing, and requests dateLastActivity', async () => {
    const { adapter, calls } = makeAdapter((c) => (c.path === '/boards/B1/cards' ? json(cards(80)) : undefined));
    const result: any = await adapter.execute('trello.search_cards', { query: '', boardId: 'B1', limit: 10 });
    expect(calls[0]!.search.get('fields')).toContain('dateLastActivity');
    expect(result).toHaveLength(10);
    expect(result.scanMetadata).toMatchObject({ scannedCount: 80, prefixCapReached: false, truncatedByLimit: true });
    expect(result.scanMetadata.perBoard).toEqual([{ boardId: 'B1', fetchedCount: 80, capReached: false }]);
  });

  it('does not describe a malformed board-card response as a complete empty scan', async () => {
    const { adapter } = makeAdapter((call) =>
      call.path === '/boards/B1/cards' ? json({ message: 'Unexpected response' }) : undefined
    );

    await expect(adapter.execute('trello.search_cards', { query: '', boardId: 'B1' }))
      .rejects.toMatchObject({ category: 'SERVER_ERROR' });
  });

  it('clamps limit to 50, matching the input schema', async () => {
    const { adapter } = makeAdapter((c) => (c.path === '/boards/B1/cards' ? json(cards(80)) : undefined));
    const result: any = await adapter.execute('trello.search_cards', { query: '', boardId: 'B1', limit: 500 });
    expect(result).toHaveLength(50);
  });
});
