import { TrelloWriteTools } from './write-tools.js';
import { StepError } from '../base-adapter.js';

export * from './types.js';
export * from './base.js';
export * from './read-tools.js';
export * from './write-tools.js';

export class TrelloAdapter extends TrelloWriteTools {
  override async execute(toolName: string, args: Record<string, any>): Promise<any> {
    switch (toolName) {
      // 5 Read tools
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

      // 4 Write tools
      case 'trello.create_card':
        return this.createCard(args as any);
      case 'trello.update_card':
        return this.updateCard(args as any);
      case 'trello.add_member':
        return this.addMember(args as any);
      case 'trello.add_checklist':
        return this.addChecklist(args as any);

      default:
        throw new StepError({
          message: `Tool '${toolName}' is not supported by TrelloAdapter`,
          category: 'VALIDATION',
          retryable: false,
        });
    }
  }
}
