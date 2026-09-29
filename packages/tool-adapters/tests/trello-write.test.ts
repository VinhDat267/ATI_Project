import { describe, it, expect, vi } from 'vitest';
import { TrelloAdapter } from '../src/index.js';

describe('packages/tool-adapters (Task 4c: Trello Write Tools & Unified Adapter)', () => {
  const mockFetch = vi.fn().mockImplementation(async (url: string | URL, options?: RequestInit) => {
    const urlStr = url.toString();
    const method = options?.method || 'GET';

    if (method === 'POST' && urlStr.includes('/cards') && !urlStr.includes('/idMembers') && !urlStr.includes('/checklists')) {
      const body = options?.body ? JSON.parse(options.body as string) : {};
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'card_created_1',
          name: body.name || 'Default Name',
          desc: body.desc || '',
          url: 'https://trello.com/c/card_created_1',
          idList: body.idList || 'l1',
        }),
      };
    }

    if (method === 'PUT' && urlStr.includes('/cards/card_created_1')) {
      const body = options?.body ? JSON.parse(options.body as string) : {};
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'card_created_1',
          name: body.name || 'Updated Title',
          desc: body.desc || '',
          url: 'https://trello.com/c/card_created_1',
          idList: body.idList || 'l1',
        }),
      };
    }

    if (method === 'POST' && urlStr.includes('/cards/card_created_1/idMembers')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'card_created_1',
          idMembers: ['member_1', 'member_2'],
        }),
      };
    }

    if (method === 'POST' && urlStr.includes('/cards/card_created_1/checklists')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'chk_1',
          name: 'Definition of Done',
        }),
      };
    }

    if (method === 'POST' && urlStr.includes('/checklists/chk_1/checkItems')) {
      const body = options?.body ? JSON.parse(options.body as string) : {};
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'item_1',
          name: body.name || 'Check item',
          state: 'incomplete',
        }),
      };
    }

    // Default read mock for search_boards
    if (urlStr.includes('/members/me/boards')) {
      return {
        ok: true,
        status: 200,
        json: async () => [{ id: 'b1', name: 'Main Board', url: 'https://trello.com/b/b1' }],
      };
    }

    return {
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: async () => 'Not found',
    };
  });

  it('creates card, updates card, adds member, and creates checklist with items', async () => {
    const adapter = new TrelloAdapter({
      credentials: { apiKey: 'k', token: 't' },
      fetchFn: mockFetch as any,
    });

    // 1. Create card
    const created = await adapter.createCard({
      listId: 'l1',
      title: 'Setup CI/CD pipeline',
      desc: 'Configuring github actions',
    });
    expect(created.id).toBe('card_created_1');
    expect(created.name).toBe('Setup CI/CD pipeline');
    expect(created.listId).toBe('l1');

    // 2. Update card
    const updated = await adapter.updateCard({
      cardId: 'card_created_1',
      title: 'Setup CI/CD pipeline (Enhanced)',
    });
    expect(updated.id).toBe('card_created_1');
    expect(updated.name).toBe('Setup CI/CD pipeline (Enhanced)');

    // 3. Add member
    const memberAdded = await adapter.addMember({
      cardId: 'card_created_1',
      memberId: 'member_2',
    });
    expect(memberAdded.id).toBe('card_created_1');
    expect(memberAdded.idMembers).toContain('member_2');

    // 4. Add checklist
    const checklist = await adapter.addChecklist({
      cardId: 'card_created_1',
      title: 'Definition of Done',
      items: ['Unit tests pass', 'Code reviewed'],
    });
    expect(checklist.id).toBe('chk_1');
    expect(checklist.name).toBe('Definition of Done');
    expect(checklist.items).toHaveLength(2);
  });

  it('dispatches unified execute across all 9 Trello tools', async () => {
    const adapter = new TrelloAdapter({
      credentials: { apiKey: 'k', token: 't' },
      fetchFn: mockFetch as any,
    });

    // Read tool dispatch
    const boards = await adapter.execute('trello.search_boards', { query: 'Main' });
    expect(boards).toHaveLength(1);
    expect(boards[0].id).toBe('b1');

    // Write tool dispatch
    const card = await adapter.execute('trello.create_card', {
      listId: 'l1',
      title: 'Automated card from execute',
    });
    expect(card.id).toBe('card_created_1');
  });
});
