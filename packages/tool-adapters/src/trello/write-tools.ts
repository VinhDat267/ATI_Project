import { TrelloReadTools } from './read-tools.js';
import { StepError } from '../base-adapter.js';

export class TrelloWriteTools extends TrelloReadTools {
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
    if (options?.boardId) {
      this.assertBoardInScope(options.boardId);
    }
    const listInfo = await this.request<any>(`/lists/${args.listId}`, { signal: options?.signal });
    this.assertParentBoard(listInfo, options?.boardId);

    const body: Record<string, any> = {
      idList: args.listId,
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

    const out: { id: string; name: string; url: string; listId: string; dueComplete?: boolean } = {
      id: String(res.id),
      name: String(res.name),
      url: String(res.url || ''),
      listId: String(res.idList || args.listId),
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
    if (options?.boardId) {
      this.assertBoardInScope(options.boardId);
    }
    const cardInfo = await this.request<any>(`/cards/${args.cardId}`, { signal: options?.signal });
    this.assertParentBoard(cardInfo, options?.boardId);
    if (args.idList) {
      const listInfo = await this.request<any>(`/lists/${args.idList}`, { signal: options?.signal });
      this.assertParentBoard(listInfo, options?.boardId);
    }

    const body: Record<string, any> = {};
    if (args.title !== undefined) body.name = args.title;
    if (args.desc !== undefined) body.desc = args.desc;
    if (args.due !== undefined) body.due = args.due;
    if (args.dueComplete !== undefined) body.dueComplete = args.dueComplete;
    if (args.closed !== undefined) body.closed = args.closed;
    if (args.idList !== undefined) body.idList = args.idList;

    const res = await this.request<any>(`/cards/${args.cardId}`, {
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
    if (options?.boardId) {
      this.assertBoardInScope(options.boardId);
    }
    const cardInfo = await this.request<any>(`/cards/${args.cardId}`, { signal: options?.signal });
    this.assertParentBoard(cardInfo, options?.boardId);

    const boardMembers = await this.request<any[]>(`/boards/${cardInfo.idBoard}/members`, { signal: options?.signal });
    const isBoardMember = Array.isArray(boardMembers) && boardMembers.some((m) => m.id === args.memberId);
    if (!isBoardMember) {
      throw new StepError({
        message: `Member '${args.memberId}' is not a member of board '${cardInfo.idBoard}'`,
        category: 'AUTH_ERROR',
        statusCode: 403,
        retryable: false,
      });
    }

    const res = await this.request<any>(`/cards/${args.cardId}/idMembers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: args.memberId }),
      signal: options?.signal,
    });

    const members: string[] = Array.isArray(res?.idMembers)
      ? res.idMembers.map(String)
      : [args.memberId];

    return {
      id: String(res?.id || args.cardId),
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
    if (options?.boardId) {
      this.assertBoardInScope(options.boardId);
    }
    const cardInfo = await this.request<any>(`/cards/${args.cardId}`, { signal: options?.signal });
    this.assertParentBoard(cardInfo, options?.boardId);

    const checklistTitle = args.title || args.name || 'Checklist';
    const chkRes = await this.request<any>(`/cards/${args.cardId}/checklists`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: checklistTitle }),
      signal: options?.signal,
    });

    const chkId = String(chkRes.id);
    const createdItems: Array<{ id: string; name: string; state: string }> = [];

    if (Array.isArray(args.items)) {
      for (const item of args.items) {
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
    if (options?.boardId) {
      this.assertBoardInScope(options.boardId);
    }
    const cardInfo = await this.request<any>(`/cards/${args.cardId}`, { signal: options?.signal });
    this.assertParentBoard(cardInfo, options?.boardId);

    const res = await this.request<any>(`/cards/${args.cardId}/actions/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: args.text }),
      signal: options?.signal,
    });

    return {
      id: String(res?.id || ''),
      cardId: String(args.cardId),
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
    this.assertBoardInScope(args.boardId);

    const body: Record<string, any> = {
      idBoard: args.boardId,
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
      boardId: String(res?.idBoard || args.boardId),
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
    if (options?.boardId) {
      this.assertBoardInScope(options.boardId);
    }
    const cardInfo = await this.request<any>(`/cards/${args.cardId}`, { signal: options?.signal });
    this.assertParentBoard(cardInfo, options?.boardId);

    const res = await this.request<any>(`/cards/${args.cardId}/idMembers/${args.memberId}`, {
      method: 'DELETE',
      signal: options?.signal,
    });

    const members: string[] = Array.isArray(res)
      ? res.map((m: any) => String(typeof m === 'string' ? m : m?.id || '')).filter(Boolean)
      : Array.isArray(res?.idMembers)
        ? res.idMembers.map(String)
        : Array.isArray(cardInfo?.idMembers)
          ? cardInfo.idMembers.map(String).filter((id: string) => id !== args.memberId)
          : [];

    return {
      id: String(args.cardId),
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
    if (options?.boardId) {
      this.assertBoardInScope(options.boardId);
    }
    const cardInfo = await this.request<any>(`/cards/${args.cardId}`, { signal: options?.signal });
    this.assertParentBoard(cardInfo, options?.boardId);

    let targetCheckItemId = args.checkItemId;
    let matchedName = args.itemName;

    if (!targetCheckItemId) {
      const checklists = await this.request<any[]>(`/cards/${args.cardId}/checklists`, { signal: options?.signal });
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
      const exact = allItems.find((it) => it.name.trim().toLowerCase() === needle);
      const partial = exact ?? allItems.find((it) => it.name.toLowerCase().includes(needle) || needle.includes(it.name.toLowerCase()));
      if (!partial) {
        throw new StepError({
          message: `Checklist item '${args.itemName}' not found on card '${args.cardId}'`,
          category: 'NOT_FOUND',
          statusCode: 404,
          retryable: false,
        });
      }
      targetCheckItemId = partial.id;
      matchedName = partial.name;
    }

    const res = await this.request<any>(`/cards/${args.cardId}/checkItem/${targetCheckItemId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: args.state }),
      signal: options?.signal,
    });

    return {
      id: String(res?.id || targetCheckItemId),
      cardId: String(args.cardId),
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
    if (options?.boardId) {
      this.assertBoardInScope(options.boardId);
    }
    const cardInfo = await this.request<any>(`/cards/${args.cardId}`, { signal: options?.signal });
    this.assertParentBoard(cardInfo, options?.boardId);

    const res = await this.request<any>(`/cards/${args.cardId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dueComplete: Boolean(args.dueComplete) }),
      signal: options?.signal,
    });

    return {
      id: String(res?.id || args.cardId),
      name: String(res?.name || cardInfo?.name || ''),
      dueComplete: typeof res?.dueComplete === 'boolean' ? res.dueComplete : Boolean(args.dueComplete),
    };
  }
}
