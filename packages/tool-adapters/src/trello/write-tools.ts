import { TrelloReadTools } from './read-tools.js';
import { StepError } from '../base-adapter.js';

export class TrelloWriteTools extends TrelloReadTools {
  private async preWriteRequest<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
    try {
      return await this.request<T>(endpoint, options);
    } catch (err: any) {
      if (err instanceof StepError) {
        throw new StepError({
          message: err.message,
          category: err.category,
          statusCode: err.statusCode,
          retryable: err.retryable,
          cause: err.cause ?? err,
          details: { ...(err.details ?? {}), requestSent: false },
        });
      }
      throw err;
    }
  }

  /**
   * Create a new card on a list.
   */
  async createCard(
    args: {
      listId: string;
      title: string;
      desc?: string;
      due?: string;
      dueComplete?: boolean;
      idMembers?: string[];
    },
    options?: { signal?: AbortSignal; boardId?: string }
  ): Promise<{ id: string; name: string; url: string; listId: string; dueComplete?: boolean }> {
    const safeListId = this.assertValidResourceId(args.listId, 'listId');
    if (args.idMembers !== undefined) {
      if (!Array.isArray(args.idMembers)) {
        throw new StepError({
          message: 'Invalid Trello resource ID array for idMembers',
          category: 'VALIDATION',
          statusCode: 400,
          retryable: false,
          details: { requestSent: false, field: 'idMembers' },
        });
      }
      for (const memberId of args.idMembers) {
        this.assertValidResourceId(memberId, 'idMembers');
      }
    }
    if (options?.boardId !== undefined) {
      this.assertBoardInScope(options.boardId);
    }
    const listInfo = await this.preWriteRequest<any>(`/lists/${safeListId}`, { signal: options?.signal });
    this.assertParentBoard(listInfo, options?.boardId);

    if (Array.isArray(args.idMembers) && args.idMembers.length > 0) {
      const boardMembers = await this.preWriteRequest<any[]>(`/boards/${listInfo.idBoard}/members`, {
        signal: options?.signal,
      });
      const allowedMemberIds = new Set(
        Array.isArray(boardMembers) ? boardMembers.map((m) => String(m?.id ?? '')) : []
      );
      for (const memberId of args.idMembers) {
        if (!allowedMemberIds.has(memberId)) {
          throw new StepError({
            message: `Member '${memberId}' is not a member of board '${listInfo.idBoard}'`,
            category: 'AUTH_ERROR',
            statusCode: 403,
            retryable: false,
            details: { requestSent: false },
          });
        }
      }
    }

    const body: Record<string, any> = {
      idList: safeListId,
      name: args.title,
    };
    if (args.desc !== undefined) body.desc = args.desc;
    if (args.due !== undefined) body.due = args.due;
    if (args.dueComplete !== undefined) body.dueComplete = args.dueComplete;
    if (args.idMembers !== undefined) body.idMembers = args.idMembers;

    const res = await this.request<any>('/cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: options?.signal,
    });

    if (typeof res.url !== 'string' || !res.url.trim()) {
      throw new StepError({
        message: 'Trello created the card without a url',
        category: 'UNKNOWN',
      });
    }
    const out: { id: string; name: string; url: string; listId: string; dueComplete?: boolean } = {
      id: String(res.id),
      name: String(res.name),
      url: res.url,
      listId: String(res.idList || safeListId),
    };
    if (typeof res.dueComplete === 'boolean') {
      out.dueComplete = res.dueComplete;
    } else if (typeof args.dueComplete === 'boolean') {
      out.dueComplete = args.dueComplete;
    }
    return out;
  }

  /**
   * Update an existing card.
   */
  async updateCard(
    args: {
      cardId: string;
      title?: string;
      desc?: string;
      due?: string;
      dueComplete?: boolean;
      closed?: boolean;
      idList?: string;
    },
    options?: { signal?: AbortSignal; boardId?: string }
  ): Promise<{ id: string; name: string; url: string; listId: string }> {
    const safeCardId = this.assertValidResourceId(args.cardId, 'cardId');
    if (args.idList !== undefined) {
      this.assertValidResourceId(args.idList, 'idList');
    }
    if (options?.boardId !== undefined) {
      this.assertBoardInScope(options.boardId);
    }
    const cardInfo = await this.preWriteRequest<any>(`/cards/${safeCardId}`, { signal: options?.signal });
    this.assertParentBoard(cardInfo, options?.boardId);
    if (args.idList) {
      const listInfo = await this.preWriteRequest<any>(`/lists/${args.idList}`, { signal: options?.signal });
      this.assertParentBoard(listInfo, options?.boardId);
    }

    const body: Record<string, any> = {};
    if (args.title !== undefined) body.name = args.title;
    if (args.desc !== undefined) body.desc = args.desc;
    if (args.due !== undefined) body.due = args.due;
    if (args.dueComplete !== undefined) body.dueComplete = args.dueComplete;
    if (args.closed !== undefined) body.closed = args.closed;
    if (args.idList !== undefined) body.idList = args.idList;

    const res = await this.request<any>(`/cards/${safeCardId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: options?.signal,
    });

    return {
      id: String(res.id),
      name: String(res.name),
      url: String(res.url || ''),
      listId: String(res.idList || ''),
    };
  }

  /**
   * Add member to a card.
   */
  async addMember(
    args: {
      cardId: string;
      memberId: string;
    },
    options?: { signal?: AbortSignal; boardId?: string }
  ): Promise<{ id: string; idMembers: string[] }> {
    const safeCardId = this.assertValidResourceId(args.cardId, 'cardId');
    const safeMemberId = this.assertValidResourceId(args.memberId, 'memberId');
    if (options?.boardId !== undefined) {
      this.assertBoardInScope(options.boardId);
    }
    const cardInfo = await this.preWriteRequest<any>(`/cards/${safeCardId}`, { signal: options?.signal });
    this.assertParentBoard(cardInfo, options?.boardId);

    const boardMembers = await this.preWriteRequest<any[]>(`/boards/${cardInfo.idBoard}/members`, { signal: options?.signal });
    const isBoardMember = Array.isArray(boardMembers) && boardMembers.some((m) => m.id === safeMemberId);
    if (!isBoardMember) {
      throw new StepError({
        message: `Member '${safeMemberId}' is not a member of board '${cardInfo.idBoard}'`,
        category: 'AUTH_ERROR',
        statusCode: 403,
        retryable: false,
        details: { requestSent: false },
      });
    }

    const res = await this.request<any>(`/cards/${safeCardId}/idMembers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: safeMemberId }),
      signal: options?.signal,
    });

    const members: string[] = Array.isArray(res?.idMembers)
      ? res.idMembers.map(String)
      : [safeMemberId];

    return {
      id: String(res?.id || safeCardId),
      idMembers: members,
    };
  }

  /**
   * Add a checklist with optional checklist items to a card.
   */
  async addChecklist(
    args: {
      cardId: string;
      title: string;
      name?: string;
      items?: string[];
    },
    options?: { signal?: AbortSignal; boardId?: string }
  ): Promise<{
    id: string;
    name: string;
    items: Array<{ id: string; name: string; state: string }>;
  }> {
    const safeCardId = this.assertValidResourceId(args.cardId, 'cardId');
    if (options?.boardId !== undefined) {
      this.assertBoardInScope(options.boardId);
    }
    let cardInfo: any;
    try {
      cardInfo = await this.request<any>(`/cards/${safeCardId}`, { signal: options?.signal });
    } catch (err: any) {
      if (err instanceof StepError) {
        throw new StepError({
          message: err.message,
          category: err.category,
          statusCode: err.statusCode,
          retryable: err.retryable,
          cause: err.cause ?? err,
          details: { ...(err.details ?? {}), requestSent: false },
        });
      }
      throw err;
    }
    this.assertParentBoard(cardInfo, options?.boardId);

    const checklistTitle = args.title || args.name || 'Checklist';
    const chkRes = await this.request<any>(`/cards/${safeCardId}/checklists`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: checklistTitle }),
      signal: options?.signal,
    });

    const rawChkId = typeof chkRes?.id === 'string' || typeof chkRes?.id === 'number' ? String(chkRes.id).trim() : '';
    if (!rawChkId) {
      throw new StepError({
        message: 'Trello created checklist without a valid checklist id',
        category: 'UNKNOWN',
        retryable: false,
        details: { requestSent: true, partialWrite: true },
      });
    }
    const chkId = this.assertValidResourceId(rawChkId, 'checklistId');
    const createdItems: Array<{ id: string; name: string; state: string }> = [];

    if (Array.isArray(args.items)) {
      for (let idx = 0; idx < args.items.length; idx++) {
        const item = args.items[idx]!;
        try {
          const itemRes = await this.request<any>(`/checklists/${chkId}/checkItems`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: item }),
            signal: options?.signal,
          });
          createdItems.push({
            id: String(itemRes.id || `item_${createdItems.length + 1}`),
            name: String(itemRes.name || item),
            state: String(itemRes.state || 'incomplete'),
          });
        } catch (err: any) {
          throw new StepError({
            message: `Checklist '${chkId}' was created (${createdItems.length}/${args.items.length} items added), but adding item ${idx + 1} ('${item}') failed: ${err?.message || err}`,
            category: 'UNKNOWN',
            statusCode: typeof err?.statusCode === 'number' ? err.statusCode : undefined,
            retryable: false,
            cause: err,
            details: {
              requestSent: true,
              partialWrite: true,
              checklistId: chkId,
              checklistName: String(chkRes.name || checklistTitle),
              createdItems,
              failedItemIndex: idx,
              failedItemName: item,
              originalCategory: err?.category ?? 'UNKNOWN',
            },
          });
        }
      }
    }

    return {
      id: chkId,
      name: String(chkRes.name || checklistTitle),
      items: createdItems,
    };
  }

  /**
   * Add a comment to a card.
   */
  async addComment(
    args: {
      cardId: string;
      text: string;
    },
    options?: { signal?: AbortSignal; boardId?: string }
  ): Promise<{ id: string; cardId: string; text: string }> {
    const safeCardId = this.assertValidResourceId(args.cardId, 'cardId');
    if (options?.boardId !== undefined) {
      this.assertBoardInScope(options.boardId);
    }
    const cardInfo = await this.preWriteRequest<any>(`/cards/${safeCardId}`, { signal: options?.signal });
    this.assertParentBoard(cardInfo, options?.boardId);

    const res = await this.request<any>(`/cards/${safeCardId}/actions/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: args.text }),
      signal: options?.signal,
    });

    return {
      id: String(res?.id || ''),
      cardId: String(safeCardId),
      text: String(res?.data?.text ?? args.text),
    };
  }

  /**
   * Create a new list (column) on a board.
   */
  async createList(
    args: {
      boardId: string;
      name: string;
      pos?: 'top' | 'bottom';
    },
    options?: { signal?: AbortSignal; boardId?: string }
  ): Promise<{ id: string; name: string; boardId: string }> {
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

    const body: Record<string, any> = {
      idBoard: safeBoardId,
      name: args.name,
    };
    if (args.pos !== undefined) body.pos = args.pos;

    const res = await this.request<any>('/lists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: options?.signal,
    });

    return {
      id: String(res?.id || ''),
      name: String(res?.name || args.name),
      boardId: String(res?.idBoard || safeBoardId),
    };
  }

  /**
   * Remove a member from a card.
   */
  async removeMember(
    args: {
      cardId: string;
      memberId: string;
    },
    options?: { signal?: AbortSignal; boardId?: string }
  ): Promise<{ id: string; idMembers: string[] }> {
    const safeCardId = this.assertValidResourceId(args.cardId, 'cardId');
    const safeMemberId = this.assertValidResourceId(args.memberId, 'memberId');
    if (options?.boardId !== undefined) {
      this.assertBoardInScope(options.boardId);
    }
    const cardInfo = await this.preWriteRequest<any>(`/cards/${safeCardId}`, { signal: options?.signal });
    this.assertParentBoard(cardInfo, options?.boardId);

    const deleteEndpoint = `/cards/${encodeURIComponent(safeCardId)}/idMembers/${encodeURIComponent(safeMemberId)}`;
    const segments = deleteEndpoint.split('/').filter(Boolean);
    if (
      segments.length !== 4 ||
      segments[0] !== 'cards' ||
      segments[1] !== safeCardId ||
      segments[2] !== 'idMembers' ||
      segments[3] !== safeMemberId
    ) {
      throw new StepError({
        message: 'Invalid remove_member endpoint path structure',
        category: 'VALIDATION',
        statusCode: 400,
        retryable: false,
        details: { requestSent: false },
      });
    }

    const res = await this.request<any>(deleteEndpoint, {
      method: 'DELETE',
      signal: options?.signal,
    });

    const members: string[] = Array.isArray(res)
      ? res.map((m: any) => String(typeof m === 'string' ? m : m?.id || '')).filter(Boolean)
      : Array.isArray(res?.idMembers)
        ? res.idMembers.map(String)
        : Array.isArray(cardInfo?.idMembers)
          ? cardInfo.idMembers.map(String).filter((id: string) => id !== safeMemberId)
          : [];

    return {
      id: String(safeCardId),
      idMembers: members,
    };
  }

  /**
   * Update a checklist item state ('complete' | 'incomplete') by itemName or checkItemId.
   */
  async updateChecklistItem(
    args: {
      cardId: string;
      itemName: string;
      state: 'complete' | 'incomplete';
      checkItemId?: string;
    },
    options?: { signal?: AbortSignal; boardId?: string }
  ): Promise<{ id: string; cardId: string; name: string; state: string }> {
    const safeCardId = this.assertValidResourceId(args.cardId, 'cardId');
    if (args.checkItemId !== undefined) {
      this.assertValidResourceId(args.checkItemId, 'checkItemId');
    }
    if (options?.boardId !== undefined) {
      this.assertBoardInScope(options.boardId);
    }
    const cardInfo = await this.preWriteRequest<any>(`/cards/${safeCardId}`, { signal: options?.signal });
    this.assertParentBoard(cardInfo, options?.boardId);

    const checklists = await this.preWriteRequest<any[]>(`/cards/${safeCardId}/checklists`, { signal: options?.signal });
    const needle = (args.itemName || '').trim().toLowerCase();
    const allItems: Array<{ id: string; name: string; state: string }> = [];
    if (Array.isArray(checklists)) {
      for (const chk of checklists) {
        const items = Array.isArray(chk?.checkItems) ? chk.checkItems : Array.isArray(chk?.items) ? chk.items : [];
        for (const it of items) {
          if (it?.id && it?.name) {
            allItems.push({ id: String(it.id), name: String(it.name), state: String(it.state || 'incomplete') });
          }
        }
      }
    }

    let targetCheckItemId =
      typeof args.checkItemId === 'string' && args.checkItemId.trim()
        ? args.checkItemId.trim()
        : undefined;
    let matchedName = args.itemName;

    if (targetCheckItemId) {
      const byId = allItems.find((it) => it.id === targetCheckItemId);
      if (!byId) {
        throw new StepError({
          message: `Checklist item '${targetCheckItemId}' not found on card '${safeCardId}'`,
          category: 'NOT_FOUND',
          statusCode: 404,
          retryable: false,
          details: { requestSent: false },
        });
      }
      if (needle) {
        const itemLower = byId.name.trim().toLowerCase();
        const exactMatch = itemLower === needle;
        const partialMatches = allItems.filter(
          (it) => it.name.toLowerCase().includes(needle) || needle.includes(it.name.toLowerCase()),
        );
        const unambiguousPartial =
          partialMatches.length === 1 && partialMatches[0]!.id === byId.id;
        if (!exactMatch && !unambiguousPartial) {
          throw new StepError({
            message: `Checklist item ID '${targetCheckItemId}' ('${byId.name}') does not match itemName '${args.itemName}'`,
            category: 'VALIDATION',
            statusCode: 400,
            retryable: false,
            details: { requestSent: false },
          });
        }
      }
      matchedName = byId.name;
    } else {
      const exactMatches = allItems.filter((it) => it.name.trim().toLowerCase() === needle);
      if (exactMatches.length > 1) {
        throw new StepError({
          message: `Checklist item '${args.itemName}' is ambiguous (${exactMatches.length} exact matches) on card '${safeCardId}'`,
          category: 'VALIDATION',
          statusCode: 400,
          retryable: false,
          details: { requestSent: false },
        });
      }
      if (exactMatches.length === 1) {
        targetCheckItemId = exactMatches[0]!.id;
        matchedName = exactMatches[0]!.name;
      } else {
        const partialMatches = allItems.filter(
          (it) => it.name.toLowerCase().includes(needle) || needle.includes(it.name.toLowerCase()),
        );
        if (partialMatches.length === 0) {
          throw new StepError({
            message: `Checklist item '${args.itemName}' not found on card '${safeCardId}'`,
            category: 'NOT_FOUND',
            statusCode: 404,
            retryable: false,
            details: { requestSent: false },
          });
        }
        if (partialMatches.length > 1) {
          throw new StepError({
            message: `Checklist item '${args.itemName}' is ambiguous (${partialMatches.length} matches) on card '${safeCardId}'`,
            category: 'VALIDATION',
            statusCode: 400,
            retryable: false,
            details: { requestSent: false },
          });
        }
        targetCheckItemId = partialMatches[0]!.id;
        matchedName = partialMatches[0]!.name;
      }
    }

    const safeCheckItemId = this.assertValidResourceId(targetCheckItemId, 'checkItemId');

    const res = await this.request<any>(`/cards/${safeCardId}/checkItem/${safeCheckItemId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: args.state }),
      signal: options?.signal,
    });

    return {
      id: String(res?.id || safeCheckItemId),
      cardId: String(safeCardId),
      name: String(res?.name || matchedName),
      state: String(res?.state || args.state),
    };
  }

  /**
   * Mark a card's due date as complete or incomplete without archiving the card.
   */
  async setCardDueComplete(
    args: {
      cardId: string;
      dueComplete: boolean;
    },
    options?: { signal?: AbortSignal; boardId?: string }
  ): Promise<{ id: string; name: string; dueComplete: boolean }> {
    const safeCardId = this.assertValidResourceId(args.cardId, 'cardId');
    if (options?.boardId !== undefined) {
      this.assertBoardInScope(options.boardId);
    }
    const cardInfo = await this.preWriteRequest<any>(`/cards/${safeCardId}`, { signal: options?.signal });
    this.assertParentBoard(cardInfo, options?.boardId);

    const res = await this.request<any>(`/cards/${safeCardId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dueComplete: Boolean(args.dueComplete) }),
      signal: options?.signal,
    });

    return {
      id: String(res?.id || safeCardId),
      name: String(res?.name || cardInfo?.name || ''),
      dueComplete: typeof res?.dueComplete === 'boolean' ? res.dueComplete : Boolean(args.dueComplete),
    };
  }
}
