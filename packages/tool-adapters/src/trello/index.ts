import { TrelloWriteTools } from './write-tools.js';
import { StepError } from '../base-adapter.js';

export * from './types.js';
export * from './base.js';
export * from './read-tools.js';
export * from './write-tools.js';

export class TrelloAdapter extends TrelloWriteTools {
  override async execute(
    toolName: string,
    args: Record<string, any>,
    context?: { signal?: AbortSignal; boardId?: string }
  ): Promise<any> {
    const opts = { signal: context?.signal, boardId: context?.boardId };
    switch (toolName) {
      // 5 Read tools
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

      // 4 Write tools
      case 'trello.create_card':
        return this.createCard(args as any, opts);
      case 'trello.update_card':
        return this.updateCard(args as any, opts);
      case 'trello.add_member':
        return this.addMember(args as any, opts);
      case 'trello.add_checklist':
        return this.addChecklist(args as any, opts);
      case 'trello.add_comment':
        return this.addComment(args as any, opts);
      case 'trello.create_list':
        return this.createList(args as any, opts);
      case 'trello.remove_member':
        return this.removeMember(args as any, opts);
      case 'trello.update_checklist_item':
        return this.updateChecklistItem(args as any, opts);
      case 'trello.set_card_due_complete':
        return this.setCardDueComplete(args as any, opts);

      default:
        throw new StepError({
          message: `Tool '${toolName}' is not supported by TrelloAdapter`,
          category: 'VALIDATION',
          retryable: false,
        });
    }
  }
}
