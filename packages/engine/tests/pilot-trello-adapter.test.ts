import { expect, it, describe, vi, afterEach } from 'vitest';
import {
  trelloListLists,
  trelloListMembers,
  trelloGetCard,
} from '../src/pilot/adapters/trello-read.js';
import { trelloCreateCard } from '../src/pilot/adapters/trello-write.js';
import type { PilotPolicy } from '../src/pilot/policy.js';
import type { PilotConfig } from '../src/pilot/config.js';

describe('pilot/adapters/trello', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const samplePolicy: PilotPolicy = {
    enabled: true,
    principals: ['operator-a'],
    spreadsheetId: 'sheet-123',
    tabId: 'Requests',
    boardId: 'board-456',
  };

  const sampleConfig: PilotConfig = {
    ...samplePolicy,
    trello: {
      apiKey: 'trello-test-key',
      apiToken: 'trello-test-token',
    },
  };

  it('lists lists on the board', async () => {
    const mockLists = [
      { id: 'list-1', name: 'To Do', closed: false },
      { id: 'list-2', name: 'Doing', closed: false },
    ];

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockLists), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    const lists = await trelloListLists({
      config: sampleConfig,
      policy: samplePolicy,
      principalId: 'operator-a',
      boardId: 'board-456',
    });

    expect(lists).toEqual(mockLists);
  });

  it('lists members on the board', async () => {
    const mockMembers = [
      { id: 'mem-1', fullName: 'Alice Designer', username: 'alice' },
    ];

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockMembers), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    const members = await trelloListMembers({
      config: sampleConfig,
      policy: samplePolicy,
      principalId: 'operator-a',
      boardId: 'board-456',
    });

    expect(members).toEqual(mockMembers);
  });

  it('gets card and validates board ownership', async () => {
    const mockCard = {
      id: 'card-1',
      idBoard: 'board-456',
      idList: 'list-1',
      name: 'Card Title',
      desc: 'Card Description',
      due: '2026-10-20',
      idMembers: ['mem-1'],
      url: 'https://trello.com/c/card-1',
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockCard), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    const card = await trelloGetCard({
      config: sampleConfig,
      policy: samplePolicy,
      principalId: 'operator-a',
      cardId: 'card-1',
    });

    expect(card.id).toBe('card-1');
    expect(card.url).toBe('https://trello.com/c/card-1');
  });

  it('creates card after resolving list name to list ID', async () => {
    const mockLists = [{ id: 'list-1', name: 'To Do', closed: false }];
    const mockCreatedCard = {
      id: 'new-card-99',
      idList: 'list-1',
      name: 'New Task',
      desc: 'Task desc',
      url: 'https://trello.com/c/new-card-99',
    };

    // 1st fetch: list_lists
    // 2nd fetch: create_card POST
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(mockLists), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(mockCreatedCard), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const receipt = await trelloCreateCard({
      config: sampleConfig,
      policy: samplePolicy,
      principalId: 'operator-a',
      boardId: 'board-456',
      listName: 'To Do',
      title: 'New Task',
      description: 'Task desc',
      intentKey: 'k'.repeat(64),
    });

    expect(receipt.cardId).toBe('new-card-99');
    expect(receipt.url).toBe('https://trello.com/c/new-card-99');
    expect(receipt.boardId).toBe('board-456');
    expect(receipt.intentKey).toBe('k'.repeat(64));
  });

  it('throws error if target list name is not found on board', async () => {
    const mockLists = [{ id: 'list-1', name: 'In Progress', closed: false }];

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockLists), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    await expect(
      trelloCreateCard({
        config: sampleConfig,
        policy: samplePolicy,
        principalId: 'operator-a',
        boardId: 'board-456',
        listName: 'NonExistentList',
        title: 'Task',
        intentKey: 'k'.repeat(64),
      }),
    ).rejects.toThrow('LIST_NOT_FOUND');
  });
});
