import { TrelloBaseAdapter } from './base.js';
import { StepError } from '../base-adapter.js';

export class TrelloReadTools extends TrelloBaseAdapter {
  /**
   * Search boards by query, filtered by AllowedScope.
   */
  async searchBoards(args: {
    query: string;
    limit?: number;
  }): Promise<Array<{ id: string; name: string; url: string }>> {
    const rawBoards = await this.request<any[]>('/members/me/boards');
    const queryLower = (args.query || '').toLowerCase();
    const limit = Math.min(Math.max(args.limit ?? 10, 1), 10);

    let filtered = rawBoards.filter((b) =>
      (b.name || '').toLowerCase().includes(queryLower)
    );

    // Apply AllowedScope board whitelist if configured
    if (this.allowedScope?.boards && this.allowedScope.boards.length > 0) {
      filtered = filtered.filter((b) => this.allowedScope!.boards!.includes(b.id));
    }

    return filtered.slice(0, limit).map((b) => ({
      id: String(b.id),
      name: String(b.name),
      url: String(b.url || ''),
    }));
  }

  /**
   * Search lists in a specific board.
   */
  async searchLists(args: {
    boardId: string;
    query?: string;
    limit?: number;
  }): Promise<Array<{ id: string; name: string; boardId: string }>> {
    this.assertAllowedScope('board', args.boardId);

    const rawLists = await this.request<any[]>(`/boards/${args.boardId}/lists`);
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
  async searchMembers(args: {
    query: string;
    boardId?: string;
    limit?: number;
  }): Promise<Array<{ id: string; fullName: string; username: string }>> {
    if (args.boardId) {
      this.assertAllowedScope('board', args.boardId);
    }

    const endpoint = args.boardId
      ? `/boards/${args.boardId}/members`
      : `/search/members?query=${encodeURIComponent(args.query)}`;

    const rawMembers = await this.request<any[]>(endpoint);
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
   */
  async searchCards(args: {
    query: string;
    boardId?: string;
    listId?: string;
    limit?: number;
  }): Promise<Array<{ id: string; name: string; url: string; listId: string }>> {
    if (args.boardId) {
      this.assertAllowedScope('board', args.boardId);
    }

    const res = await this.request<any>(
      `/search?query=${encodeURIComponent(args.query)}&modelTypes=cards&card_fields=id,name,url,idList`
    );

    const rawCards: any[] = Array.isArray(res?.cards) ? res.cards : Array.isArray(res) ? res : [];
    const limit = Math.min(Math.max(args.limit ?? 10, 1), 10);

    let filtered = rawCards;
    if (args.listId) {
      filtered = filtered.filter((c) => c.idList === args.listId);
    }

    return filtered.slice(0, limit).map((c) => ({
      id: String(c.id),
      name: String(c.name),
      url: String(c.url || ''),
      listId: String(c.idList || ''),
    }));
  }

  /**
   * Get detail of a specific card by cardId.
   */
  async getCard(args: {
    cardId: string;
  }): Promise<{
    id: string;
    name: string;
    desc: string;
    url: string;
    listId: string;
    idMembers: string[];
  }> {
    const card = await this.request<any>(`/cards/${args.cardId}`);
    if (card.idBoard) {
      this.assertAllowedScope('board', card.idBoard);
    }

    return {
      id: String(card.id),
      name: String(card.name),
      desc: String(card.desc || ''),
      url: String(card.url || ''),
      listId: String(card.idList || ''),
      idMembers: Array.isArray(card.idMembers) ? card.idMembers.map(String) : [],
    };
  }

  override async execute(toolName: string, args: Record<string, any>): Promise<any> {
    switch (toolName) {
      case 'trello.search_boards':
        return this.searchBoards(args as any);
      case 'trello.search_lists':
        return this.searchLists(args as any);
      case 'trello.search_members':
        return this.searchMembers(args as any);
      case 'trello.search_cards':
        return this.searchCards(args as any);
      case 'trello.get_card':
        return this.getCard(args as any);
      default:
        throw new StepError({
          message: `Unknown or unhandled tool '${toolName}' in TrelloReadTools`,
          category: 'VALIDATION',
          retryable: false,
        });
    }
  }
}
