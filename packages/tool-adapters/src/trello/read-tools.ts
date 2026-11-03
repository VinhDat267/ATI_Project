import { TrelloBaseAdapter } from './base.js';
import { StepError } from '../base-adapter.js';

export class TrelloReadTools extends TrelloBaseAdapter {
  protected assertBoardInScope(boardId: string): void {
    this.assertAllowedScope('boards', boardId);
  }

  /**
   * Search boards by query, filtered by AllowedScope.
   */
  async searchBoards(
    args: { query: string; limit?: number },
    options?: { signal?: AbortSignal }
  ): Promise<Array<{ id: string; name: string; url: string }>> {
    const rawBoards = await this.request<any[]>('/members/me/boards', { signal: options?.signal });
    const queryLower = (args.query || '').toLowerCase();
    const limit = Math.min(Math.max(args.limit ?? 10, 1), 10);

    let filtered = rawBoards.filter((b) => this.allowedBoardIds.includes(b.id));
    filtered = filtered.filter((b) => (b.name || '').toLowerCase().includes(queryLower));

    return filtered.slice(0, limit).map((b) => ({
      id: String(b.id),
      name: String(b.name),
      url: String(b.url || ''),
    }));
  }

  /**
   * Search lists in a specific board.
   */
  async searchLists(
    args: { boardId: string; query?: string; limit?: number },
    options?: { signal?: AbortSignal; boardId?: string }
  ): Promise<Array<{ id: string; name: string; boardId: string }>> {
    if (options?.boardId) {
      this.assertBoardInScope(options.boardId);
      if (options.boardId !== args.boardId) {
        throw new StepError({
          message: `Board '${args.boardId}' does not match expected step board '${options.boardId}'`,
          category: 'AUTH_ERROR',
          statusCode: 403,
          retryable: false,
        });
      }
    }
    this.assertAllowedScope('boards', args.boardId);

    const rawLists = await this.request<any[]>(`/boards/${args.boardId}/lists`, { signal: options?.signal });
    const queryLower = (args.query || '').toLowerCase();
    const limit = Math.min(Math.max(args.limit ?? 10, 1), 10);

    let filtered = rawLists;
    if (queryLower) {
      filtered = filtered.filter((l) =>
        (l.name || '').toLowerCase().includes(queryLower)
      );
    }

    return filtered.slice(0, limit).map((l) => ({
      id: String(l.id),
      name: String(l.name),
      boardId: String(l.idBoard || args.boardId),
    }));
  }

  /**
   * Search members by query, optionally scoped to a board.
   */
  async searchMembers(
    args: { query: string; boardId?: string; limit?: number },
    options?: { signal?: AbortSignal; boardId?: string }
  ): Promise<Array<{ id: string; fullName: string; username: string }>> {
    if (options?.boardId) {
      this.assertBoardInScope(options.boardId);
      if (options.boardId !== args.boardId) {
        throw new StepError({
          message: `Board '${args.boardId}' does not match expected step board '${options.boardId}'`,
          category: 'AUTH_ERROR',
          statusCode: 403,
          retryable: false,
        });
      }
    }
    if (!args.boardId) {
      throw new StepError({
        message: 'A board ID is required to search members within an allowed board',
        category: 'AUTH_ERROR',
        statusCode: 403,
        retryable: false,
      });
    }
    this.assertAllowedScope('boards', args.boardId);
    const endpoint = `/boards/${args.boardId}/members`;

    const rawMembers = await this.request<any[]>(endpoint, { signal: options?.signal });
    const queryLower = (args.query || '').toLowerCase();
    const limit = Math.min(Math.max(args.limit ?? 10, 1), 10);

    const filtered = rawMembers.filter(
      (m) =>
        (m.fullName || '').toLowerCase().includes(queryLower) ||
        (m.username || '').toLowerCase().includes(queryLower)
    );

    return filtered.slice(0, limit).map((m) => ({
      id: String(m.id),
      fullName: String(m.fullName || ''),
      username: String(m.username || ''),
    }));
  }

  /**
   * Search cards across boards and lists.
   * Supports empty query ('') by listing open cards directly from allowed boards/lists.
   */
  async searchCards(args: {
    query: string;
    boardId?: string;
    listId?: string;
    limit?: number;
  }): Promise<Array<{
    id: string;
    name: string;
    url: string;
    listId: string;
    boardId?: string;
    due?: string | null;
    dueComplete?: boolean;
    idMembers?: string[];
    labels?: string[];
  }>> {
    if (args.boardId) {
      this.assertAllowedScope('boards', args.boardId);
    }

    const signal = (args as any).signal as AbortSignal | undefined;
    const queryTrimmed = (args.query ?? '').trim();
    let rawCards: any[] = [];

    if (!queryTrimmed) {
      if (args.listId) {
        const res = await this.request<any[]>(
          `/lists/${args.listId}/cards?fields=id,name,url,idList,idBoard,due,dueComplete,idMembers,labels,desc`,
          { signal }
        );
        rawCards = Array.isArray(res) ? res : [];
      } else {
        const targetBoards = args.boardId ? [args.boardId] : this.allowedBoardIds;
        for (const bId of targetBoards) {
          this.assertAllowedScope('boards', bId);
          const res = await this.request<any[]>(
            `/boards/${bId}/cards?fields=id,name,url,idList,idBoard,due,dueComplete,idMembers,labels,desc`,
            { signal }
          );
          if (Array.isArray(res)) {
            rawCards.push(...res.map((c) => ({ ...c, idBoard: c.idBoard || bId })));
          }
        }
      }
    } else {
      const res = await this.request<any>(
        `/search?query=${encodeURIComponent(queryTrimmed)}&modelTypes=cards&card_fields=id,name,url,idList,idBoard,due,dueComplete,idMembers,labels,desc`,
        { signal }
      );
      rawCards = Array.isArray(res?.cards) ? res.cards : Array.isArray(res) ? res : [];
    }

    const limit = Math.min(Math.max(args.limit ?? 10, 1), 50);

    let filtered = rawCards.filter((c) => typeof c.idBoard === 'string' && this.allowedBoardIds.includes(c.idBoard));
    if (args.boardId) {
      filtered = filtered.filter((c) => c.idBoard === args.boardId);
    }
    if (args.listId) {
      filtered = filtered.filter((c) => c.idList === args.listId);
    }

    return filtered.slice(0, limit).map((c) => {
      const item: {
        id: string;
        name: string;
        url: string;
        listId: string;
        boardId?: string;
        due?: string | null;
        dueComplete?: boolean;
        idMembers?: string[];
        labels?: string[];
      } = {
        id: String(c.id),
        name: String(c.name),
        url: String(c.url || ''),
        listId: String(c.idList || ''),
      };
      if (typeof c.idBoard === 'string' && c.idBoard) item.boardId = c.idBoard;
      if (c.due !== undefined) item.due = c.due ? String(c.due) : null;
      if (typeof c.dueComplete === 'boolean') item.dueComplete = c.dueComplete;
      if (Array.isArray(c.idMembers)) item.idMembers = c.idMembers.map(String);
      if (Array.isArray(c.labels)) {
        item.labels = c.labels
          .map((l: any) => (typeof l === 'string' ? l : String(l?.name || l?.color || '')))
          .filter(Boolean);
      }
      return item;
    });
  }

  /**
   * Get detail of a specific card by cardId.
   */
  async getCard(
    args: { cardId: string },
    options?: { signal?: AbortSignal; boardId?: string }
  ): Promise<{
    id: string;
    name: string;
    desc: string;
    url: string;
    listId: string;
    boardId?: string;
    idMembers: string[];
    due?: string | null;
    dueComplete?: boolean;
    labels?: string[];
    checklists?: Array<{
      id: string;
      name: string;
      items: Array<{ id: string; name: string; state: string }>;
    }>;
  }> {
    if (options?.boardId) {
      this.assertBoardInScope(options.boardId);
    }
    const card = await this.request<any>(`/cards/${args.cardId}?checklists=all`, { signal: options?.signal });
    this.assertParentBoard(card, options?.boardId);

    const result: {
      id: string;
      name: string;
      desc: string;
      url: string;
      listId: string;
      boardId?: string;
      idMembers: string[];
      due?: string | null;
      dueComplete?: boolean;
      labels?: string[];
      checklists?: Array<{
        id: string;
        name: string;
        items: Array<{ id: string; name: string; state: string }>;
      }>;
    } = {
      id: String(card.id),
      name: String(card.name),
      desc: String(card.desc || ''),
      url: String(card.url || ''),
      listId: String(card.idList || ''),
      idMembers: Array.isArray(card.idMembers) ? card.idMembers.map(String) : [],
    };
    if (typeof card.idBoard === 'string' && card.idBoard) result.boardId = card.idBoard;
    if (card.due !== undefined) result.due = card.due ? String(card.due) : null;
    if (typeof card.dueComplete === 'boolean') result.dueComplete = card.dueComplete;
    if (Array.isArray(card.labels)) {
      result.labels = card.labels
        .map((l: any) => (typeof l === 'string' ? l : String(l?.name || l?.color || '')))
        .filter(Boolean);
    }
    if (Array.isArray(card.checklists)) {
      result.checklists = card.checklists.map((chk: any) => ({
        id: String(chk.id || ''),
        name: String(chk.name || ''),
        items: Array.isArray(chk.checkItems || chk.items)
          ? (chk.checkItems || chk.items).map((it: any) => ({
              id: String(it.id || ''),
              name: String(it.name || ''),
              state: String(it.state || 'incomplete'),
            }))
          : [],
      }));
    }
    return result;
  }

  override async execute(
    toolName: string,
    args: Record<string, any>,
    context?: { signal?: AbortSignal; boardId?: string }
  ): Promise<any> {
    const opts = { signal: context?.signal, boardId: context?.boardId };
    switch (toolName) {
      case 'trello.search_boards':
        return this.searchBoards(args as any, opts);
      case 'trello.search_lists':
        return this.searchLists(args as any, opts);
      case 'trello.search_members':
        return this.searchMembers(args as any, opts);
      case 'trello.search_cards':
        return this.searchCards({ ...args, ...opts } as any);
      case 'trello.get_card':
        return this.getCard(args as any, opts);
      default:
        throw new StepError({
          message: `Unknown or unhandled tool '${toolName}' in TrelloReadTools`,
          category: 'VALIDATION',
          retryable: false,
        });
    }
  }
}
