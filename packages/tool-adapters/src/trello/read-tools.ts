import { TrelloBaseAdapter } from './base.js';
import { StepError } from '../base-adapter.js';
import { TRELLO_SEARCH_CARDS_MAX_LIMIT, TRELLO_SEARCH_LABELS_MAX_LIMIT } from '@wap/tool-schemas';

export const TRELLO_BOARD_CARDS_SCAN_PREFIX_LIMIT = 50;
/** Same bound as the `trello.search_cards` input schema. */
export const TRELLO_SEARCH_CARDS_ADAPTER_MAX_LIMIT = TRELLO_SEARCH_CARDS_MAX_LIMIT;
export const TRELLO_SEARCH_LABELS_ADAPTER_MAX_LIMIT = TRELLO_SEARCH_LABELS_MAX_LIMIT;
const TRELLO_CARD_SCAN_FIELDS = 'id,name,url,idList,idBoard,due,dueComplete,idMembers,labels,desc,dateLastActivity';

export interface TrelloLabelResultItem {
  id: string;
  name: string;
  color: string | null;
  boardId: string;
}

export interface TrelloBoardCardScanStat {
  boardId: string;
  fetchedCount: number;
  capReached: boolean;
}

export interface TrelloCardScanMetadata {
  available: 'UNKNOWN';
  prefixLimit: number;
  scannedCount: number;
  uniqueScannedCount: number;
  duplicateCountDropped: number;
  matchedCount: number;
  displayedCount: number;
  limitApplied: number;
  prefixCapReached: boolean;
  truncatedByLimit: boolean;
  isComplete: false;
  perBoard: TrelloBoardCardScanStat[];
}

export interface TrelloCardSearchResultItem {
  id: string;
  name: string;
  url: string;
  listId: string;
  boardId?: string;
  due?: string | null;
  dueComplete?: boolean;
  dateLastActivity?: string;
  idMembers?: string[];
  labels?: string[];
}

export type TrelloCardSearchResultArray = Array<TrelloCardSearchResultItem> & {
  readonly scanMetadata?: TrelloCardScanMetadata;
};

export function getTrelloSearchScanMetadata(cards: unknown): TrelloCardScanMetadata | undefined {
  if (!Array.isArray(cards)) return undefined;
  return (cards as TrelloCardSearchResultArray).scanMetadata;
}

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
    this.assertValidResourceId(args.boardId, 'boardId');
    if (options?.boardId !== undefined) {
      this.assertBoardInScope(options.boardId);
      if (options.boardId !== args.boardId) {
        throw new StepError({
          message: `Board '${args.boardId}' does not match expected step board '${options.boardId}'`,
          category: 'AUTH_ERROR',
          statusCode: 403,
          retryable: false,
          details: { requestSent: false },
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
    if (args.boardId !== undefined) {
      this.assertValidResourceId(args.boardId, 'boardId');
    }
    if (options?.boardId !== undefined) {
      this.assertBoardInScope(options.boardId);
      if (args.boardId !== undefined && options.boardId !== args.boardId) {
        throw new StepError({
          message: `Board '${args.boardId}' does not match expected step board '${options.boardId}'`,
          category: 'AUTH_ERROR',
          statusCode: 403,
          retryable: false,
          details: { requestSent: false },
        });
      }
    }
    const targetBoardId = args.boardId ?? options?.boardId;
    if (!targetBoardId) {
      throw new StepError({
        message: 'A board ID is required to search members within an allowed board',
        category: 'AUTH_ERROR',
        statusCode: 403,
        retryable: false,
        details: { requestSent: false },
      });
    }
    this.assertAllowedScope('boards', targetBoardId);
    const endpoint = `/boards/${targetBoardId}/members`;

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
   * Search cards across boards and lists with explicit scan/coverage metadata.
   */
  async searchCardsWithMetadata(
    args: {
      query: string;
      boardId?: string;
      listId?: string;
      limit?: number;
    },
    options?: { signal?: AbortSignal; boardId?: string }
  ): Promise<{ cards: TrelloCardSearchResultArray; scanMetadata: TrelloCardScanMetadata }> {
    const cards = await this.searchCards(args, options);
    const scanMetadata = getTrelloSearchScanMetadata(cards)!;
    return { cards, scanMetadata };
  }

  /**
   * Search cards across boards and lists.
   * Supports empty query ('') by listing open cards directly from allowed boards/lists.
   */
  async searchCards(
    args: {
      query: string;
      boardId?: string;
      listId?: string;
      limit?: number;
    },
    options?: { signal?: AbortSignal; boardId?: string }
  ): Promise<TrelloCardSearchResultArray> {
    if (args.boardId !== undefined) {
      this.assertValidResourceId(args.boardId, 'boardId');
    }
    if (args.listId !== undefined) {
      this.assertValidResourceId(args.listId, 'listId');
    }
    if (options?.boardId !== undefined) {
      this.assertBoardInScope(options.boardId);
      if (args.boardId !== undefined && options.boardId !== args.boardId) {
        throw new StepError({
          message: `Board '${args.boardId}' does not match expected step board '${options.boardId}'`,
          category: 'AUTH_ERROR',
          statusCode: 403,
          retryable: false,
          details: { requestSent: false },
        });
      }
    }

    const effectiveBoardId = args.boardId ?? options?.boardId;
    if (effectiveBoardId !== undefined) {
      this.assertAllowedScope('boards', effectiveBoardId);
    }

    const signal = options?.signal ?? ((args as any).signal as AbortSignal | undefined);
    const queryTrimmed = (args.query ?? '').trim();
    let rawCards: any[] = [];
    const perBoard: TrelloBoardCardScanStat[] = [];
    let searchCapReached = false;

    if (args.listId !== undefined) {
      const listMeta = await this.request<any>(`/lists/${args.listId}?fields=id,idBoard`, { signal });
      this.assertParentBoard(listMeta, effectiveBoardId);
    }

    if (!queryTrimmed) {
      // These endpoints return every open card; nothing is capped, so capReached stays false.
      if (args.listId) {
        const res = await this.request<any[]>(
          `/lists/${args.listId}/cards?fields=${TRELLO_CARD_SCAN_FIELDS}`,
          { signal }
        );
        rawCards = Array.isArray(res) ? res : [];
        const inferredBoardId =
          effectiveBoardId ?? (typeof rawCards[0]?.idBoard === 'string' ? rawCards[0].idBoard : '');
        perBoard.push({
          boardId: inferredBoardId,
          fetchedCount: rawCards.length,
          capReached: false,
        });
      } else {
        const targetBoards = effectiveBoardId ? [effectiveBoardId] : [...this.allowedBoardIds];
        for (const bId of targetBoards) {
          this.assertAllowedScope('boards', bId);
          const boardCards = await this.request<unknown>(
            `/boards/${bId}/cards?fields=${TRELLO_CARD_SCAN_FIELDS}`,
            { signal }
          );
          if (!Array.isArray(boardCards)) {
            throw new StepError({
              message: 'Trello returned an invalid board cards response',
              category: 'SERVER_ERROR',
              retryable: false,
              details: { requestSent: false },
            });
          }
          perBoard.push({
            boardId: bId,
            fetchedCount: boardCards.length,
            capReached: false,
          });
          rawCards.push(...boardCards.map((c) => ({ ...c, idBoard: c.idBoard || bId })));
        }
      }
    } else {
      const targetBoards = effectiveBoardId ? [effectiveBoardId] : [...this.allowedBoardIds];
      if (targetBoards.length === 0) {
        throw new StepError({
          message: 'Allowed scope restriction: no allowed Trello boards configured for search',
          category: 'AUTH_ERROR',
          statusCode: 403,
          retryable: false,
          details: { requestSent: false },
        });
      }
      for (const bId of targetBoards) {
        this.assertAllowedScope('boards', bId);
      }
      const idBoardsParam = encodeURIComponent(targetBoards.join(','));
      // Ask for one extra card so a capped result is detected exactly instead of guessed.
      const res = await this.request<any>(
        `/search?query=${encodeURIComponent(queryTrimmed)}&idBoards=${idBoardsParam}&modelTypes=cards&cards_limit=${TRELLO_BOARD_CARDS_SCAN_PREFIX_LIMIT + 1}&card_fields=${TRELLO_CARD_SCAN_FIELDS}`,
        { signal }
      );
      rawCards = Array.isArray(res?.cards) ? res.cards : Array.isArray(res) ? res : [];
      if (rawCards.length > TRELLO_BOARD_CARDS_SCAN_PREFIX_LIMIT) {
        searchCapReached = true;
        rawCards = rawCards.slice(0, TRELLO_BOARD_CARDS_SCAN_PREFIX_LIMIT);
      }
    }

    const scannedCount = rawCards.length;
    const seenCardIds = new Set<string>();
    const uniqueRawCards: any[] = [];
    let duplicateCountDropped = 0;

    for (const c of rawCards) {
      const cardId = typeof c?.id === 'string' || typeof c?.id === 'number' ? String(c.id).trim() : '';
      if (!cardId) continue;
      if (seenCardIds.has(cardId)) {
        duplicateCountDropped++;
        continue;
      }
      seenCardIds.add(cardId);
      uniqueRawCards.push(c);
    }

    const limit = Math.min(Math.max(args.limit ?? 10, 1), TRELLO_SEARCH_CARDS_ADAPTER_MAX_LIMIT);

    let filtered = uniqueRawCards.filter(
      (c) => typeof c.idBoard === 'string' && this.allowedBoardIds.includes(c.idBoard)
    );
    if (effectiveBoardId) {
      filtered = filtered.filter((c) => c.idBoard === effectiveBoardId);
    }
    if (args.listId) {
      filtered = filtered.filter((c) => c.idList === args.listId);
    }

    const matchedCount = filtered.length;
    const items: TrelloCardSearchResultArray = filtered.slice(0, limit).map((c) => {
      const item: TrelloCardSearchResultItem = {
        id: String(c.id),
        name: String(c.name),
        url: String(c.url || ''),
        listId: String(c.idList || ''),
      };
      if (typeof c.idBoard === 'string' && c.idBoard) item.boardId = c.idBoard;
      if (c.due !== undefined) item.due = c.due ? String(c.due) : null;
      if (typeof c.dueComplete === 'boolean') item.dueComplete = c.dueComplete;
      if (typeof c.dateLastActivity === 'string' && c.dateLastActivity) item.dateLastActivity = c.dateLastActivity;
      if (Array.isArray(c.idMembers)) item.idMembers = c.idMembers.map(String);
      if (Array.isArray(c.labels)) {
        item.labels = c.labels
          .map((l: any) => (typeof l === 'string' ? l : String(l?.name || l?.color || '')))
          .filter(Boolean);
      }
      return item;
    });

    const prefixCapReached = searchCapReached || perBoard.some((b) => b.capReached);
    const scanMetadata: TrelloCardScanMetadata = {
      available: 'UNKNOWN',
      prefixLimit: TRELLO_BOARD_CARDS_SCAN_PREFIX_LIMIT,
      scannedCount,
      uniqueScannedCount: uniqueRawCards.length,
      duplicateCountDropped,
      matchedCount,
      displayedCount: items.length,
      limitApplied: limit,
      prefixCapReached,
      truncatedByLimit: matchedCount > items.length,
      isComplete: false,
      perBoard,
    };

    Object.defineProperty(items, 'scanMetadata', {
      value: scanMetadata,
      enumerable: false,
      configurable: true,
      writable: false,
    });

    return items;
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
    this.assertValidResourceId(args.cardId, 'cardId');
    if (options?.boardId !== undefined) {
      this.assertBoardInScope(options.boardId);
    }
    const cardMeta = await this.request<any>(`/cards/${args.cardId}?fields=id,idBoard`, {
      signal: options?.signal,
    });
    this.assertParentBoard(cardMeta, options?.boardId);

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

  /**
   * List labels of one allowed board, optionally filtered by name or color.
   */
  async searchLabels(
    args: { boardId: string; query?: string; limit?: number },
    options?: { signal?: AbortSignal; boardId?: string }
  ): Promise<TrelloLabelResultItem[]> {
    const safeBoardId = this.assertValidResourceId(args.boardId, 'boardId');
    if (options?.boardId !== undefined) {
      this.assertBoardInScope(options.boardId);
      if (options.boardId !== safeBoardId) {
        throw new StepError({
          message: `Board '${safeBoardId}' does not match expected step board '${options.boardId}'`,
          category: 'AUTH_ERROR',
          statusCode: 403,
          retryable: false,
          details: { requestSent: false },
        });
      }
    }
    this.assertBoardInScope(safeBoardId);

    const rawLabels = await this.request<any[]>(`/boards/${safeBoardId}/labels?fields=id,name,color,idBoard&limit=1000`, {
      signal: options?.signal,
    });
    const queryLower = (typeof args.query === 'string' ? args.query : '').trim().toLowerCase();
    const limit = Math.min(Math.max(args.limit ?? TRELLO_SEARCH_LABELS_ADAPTER_MAX_LIMIT, 1), TRELLO_SEARCH_LABELS_ADAPTER_MAX_LIMIT);

    let labels = (Array.isArray(rawLabels) ? rawLabels : []).filter(
      (l) => typeof l?.id === 'string' && (l.idBoard === undefined || l.idBoard === safeBoardId)
    );
    if (queryLower) {
      labels = labels.filter(
        (l) =>
          String(l.name || '').toLowerCase().includes(queryLower) ||
          String(l.color || '').toLowerCase().includes(queryLower)
      );
    }
    return labels.slice(0, limit).map((label) => {
      const color = typeof label.color === 'string' ? label.color.trim() || null : null;
      const name = typeof label.name === 'string' && label.name.trim()
        ? label.name
        : color ?? `Nhãn ${label.id}`;
      return { id: label.id, name, color, boardId: safeBoardId };
    });
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
        return this.searchCards(args as any, opts);
      case 'trello.get_card':
        return this.getCard(args as any, opts);
      case 'trello.search_labels':
        return this.searchLabels(args as any, opts);
      default:
        throw new StepError({
          message: `Unknown or unhandled tool '${toolName}' in TrelloReadTools`,
          category: 'VALIDATION',
          retryable: false,
        });
    }
  }
}
