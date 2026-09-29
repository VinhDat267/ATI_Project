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
      idMembers?: string[];
    },
    options?: { signal?: AbortSignal }
  ): Promise<{ id: string; name: string; url: string; listId: string }> {
    if (this.allowedScope?.boards && this.allowedScope.boards.length > 0) {
      const listInfo = await this.request<any>(`/lists/${args.listId}`, { signal: options?.signal });
      this.assertParentBoard(listInfo);
    }

    const body: Record<string, any> = {
      idList: args.listId,
      name: args.title,
    };
    if (args.desc !== undefined) body.desc = args.desc;
    if (args.due !== undefined) body.due = args.due;
    if (args.idMembers !== undefined) body.idMembers = args.idMembers;

    const res = await this.request<any>('/cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: options?.signal,
    });

    return {
      id: String(res.id),
      name: String(res.name),
      url: String(res.url || ''),
      listId: String(res.idList || args.listId),
    };
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
      closed?: boolean;
      idList?: string;
    },
    options?: { signal?: AbortSignal }
  ): Promise<{ id: string; name: string; url: string; listId: string }> {
    if (this.allowedScope?.boards && this.allowedScope.boards.length > 0) {
      const cardInfo = await this.request<any>(`/cards/${args.cardId}`, { signal: options?.signal });
      this.assertParentBoard(cardInfo);
      if (args.idList) {
        const listInfo = await this.request<any>(`/lists/${args.idList}`, { signal: options?.signal });
        this.assertParentBoard(listInfo);
      }
    }

    const body: Record<string, any> = {};
    if (args.title !== undefined) body.name = args.title;
    if (args.desc !== undefined) body.desc = args.desc;
    if (args.due !== undefined) body.due = args.due;
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
    options?: { signal?: AbortSignal }
  ): Promise<{ id: string; idMembers: string[] }> {
    if (this.allowedScope?.boards && this.allowedScope.boards.length > 0) {
      const cardInfo = await this.request<any>(`/cards/${args.cardId}`, { signal: options?.signal });
      this.assertParentBoard(cardInfo);
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
      items?: string[];
    },
    options?: { signal?: AbortSignal }
  ): Promise<{
    id: string;
    name: string;
    items: Array<{ id: string; name: string; state: string }>;
  }> {
    if (this.allowedScope?.boards && this.allowedScope.boards.length > 0) {
      const cardInfo = await this.request<any>(`/cards/${args.cardId}`, { signal: options?.signal });
      this.assertParentBoard(cardInfo);
    }

    const chkRes = await this.request<any>(`/cards/${args.cardId}/checklists`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: args.title }),
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
      name: String(chkRes.name || args.title),
      items: createdItems,
    };
  }
}
