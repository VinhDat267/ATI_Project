import { describe, it, expect, vi } from 'vitest';
import { TrelloAdapter } from '../src/index.js';

describe('packages/tool-adapters (Task 4c: Trello Write Tools & Unified Adapter)', () => {
  const mockFetch = vi.fn().mockImplementation(async (url: string | URL, options?: RequestInit) => {
    const urlStr = url.toString();
    const method = options?.method || 'GET';

    if (method === 'POST' && urlStr.includes('/lists')) {
      const body = options?.body ? JSON.parse(options.body as string) : {};
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'list_sprint_15',
          name: body.name || 'New List',
          idBoard: body.idBoard || 'b1',
        }),
      };
    }

    if (method === 'POST' && urlStr.includes('/cards') && !urlStr.includes('/idMembers') && !urlStr.includes('/checklists') && !urlStr.includes('/actions/comments')) {
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

    if (method === 'PUT' && urlStr.includes('/cards/card_created_1/checkItem/item_1')) {
      const body = options?.body ? JSON.parse(options.body as string) : {};
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'item_1',
          name: 'Viết unit test',
          state: body.state || 'complete',
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
          dueComplete: body.dueComplete ?? false,
        }),
      };
    }

    if (method === 'DELETE' && urlStr.includes('/cards/card_created_1/idMembers/member_1')) {
      return {
        ok: true,
        status: 200,
        json: async () => [{ id: 'member_2' }],
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

    if (method === 'POST' && urlStr.includes('/cards/card_created_1/actions/comments')) {
      const body = options?.body ? JSON.parse(options.body as string) : {};
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'comment_1',
          data: { text: body.text || '' },
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

    if (method === 'GET' && urlStr.includes('/lists/l1')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'l1', idBoard: 'b1' }),
      };
    }

    if (method === 'GET' && urlStr.includes('/cards/card_created_1/checklists')) {
      return {
        ok: true,
        status: 200,
        json: async () => [
          {
            id: 'chk_1',
            name: 'Definition of Done',
            checkItems: [
              { id: 'item_1', name: 'Viết unit test', state: 'incomplete' },
              { id: 'item_2', name: 'Review code', state: 'incomplete' },
              { id: 'item_3', name: 'Viết integration test', state: 'incomplete' },
            ],
          },
        ],
      };
    }

    if (method === 'GET' && urlStr.includes('/cards/card_created_1')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'card_created_1', idBoard: 'b1', idList: 'l1' }),
      };
    }

    if (method === 'GET' && urlStr.includes('/boards/b1/members')) {
      return {
        ok: true,
        status: 200,
        json: async () => [{ id: 'member_1' }, { id: 'member_2' }],
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
      credentials: { accessToken: 't' },
      allowedBoardIds: ['b1'],
      allowedScope: { boards: ['b1'] },
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
      credentials: { accessToken: 't' },
      allowedBoardIds: ['b1'],
      allowedScope: { boards: ['b1'] },
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

    // Add comment dispatch
    const comment = await adapter.execute('trello.add_comment', {
      cardId: 'card_created_1',
      text: 'PR #228 đã merge thành công',
    });
    expect(comment).toEqual({
      id: 'comment_1',
      cardId: 'card_created_1',
      text: 'PR #228 đã merge thành công',
    });

    // Create list dispatch
    const newList = await adapter.execute('trello.create_list', {
      boardId: 'b1',
      name: 'Sprint 15 - Cần làm',
      pos: 'top',
    });
    expect(newList).toEqual({
      id: 'list_sprint_15',
      name: 'Sprint 15 - Cần làm',
      boardId: 'b1',
    });

    // Remove member dispatch
    const afterRemove = await adapter.execute('trello.remove_member', {
      cardId: 'card_created_1',
      memberId: 'member_1',
    });
    expect(afterRemove).toEqual({
      id: 'card_created_1',
      idMembers: ['member_2'],
    });

    // Update checklist item by itemName dispatch
    const updatedItem = await adapter.execute('trello.update_checklist_item', {
      cardId: 'card_created_1',
      itemName: 'viết unit test',
      state: 'complete',
    });
    expect(updatedItem).toEqual({
      id: 'item_1',
      cardId: 'card_created_1',
      name: 'Viết unit test',
      state: 'complete',
    });

    // Set card due complete dispatch
    const dueCompleted = await adapter.execute('trello.set_card_due_complete', {
      cardId: 'card_created_1',
      dueComplete: true,
    });
    expect(dueCompleted).toEqual({
      id: 'card_created_1',
      name: 'Updated Title',
      dueComplete: true,
    });

    // Add checklist with legacy 'name' fallback if 'title' is omitted
    const fallbackChk = await adapter.execute('trello.add_checklist', {
      cardId: 'card_created_1',
      name: 'Definition of Done',
      items: ['Viết unit test'],
    });
    expect(fallbackChk.name).toBe('Definition of Done');
    expect(fallbackChk.items).toHaveLength(1);

    // Rejects update_checklist_item when checkItemId does not match itemName
    await expect(
      adapter.execute('trello.update_checklist_item', {
        cardId: 'card_created_1',
        checkItemId: 'item_1',
        itemName: 'Deploy production',
        state: 'complete',
      })
    ).rejects.toMatchObject({ category: 'VALIDATION', statusCode: 400 });

    // Rejects update_checklist_item when itemName partially matches multiple items (" test" matches both "Viết unit test" and "Chạy integration test")
    await expect(
      adapter.execute('trello.update_checklist_item', {
        cardId: 'card_created_1',
        itemName: 'test',
        state: 'complete',
      })
    ).rejects.toMatchObject({ category: 'VALIDATION', statusCode: 400 });
  });
});
