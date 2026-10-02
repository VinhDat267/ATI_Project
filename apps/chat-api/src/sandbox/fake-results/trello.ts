import type { FakeService } from './types.js';

export const TRELLO_FAKE: FakeService = {
  id: 'trello',
  tools: {
    'trello.create_card': args => ({
      id: 'card_' + Date.now(), name: args.title || 'Thẻ mới', url: 'https://trello.com/c/sandbox/card',
      listId: args.listId || 'list_1', desc: args.desc,
    }),
    'trello.add_member': args => ({ id: args.cardId, idMembers: [args.memberId] }),
    'trello.search_boards': (_args, scenario) => scenario === 'clarification' ? [{ id: 'board_frontend', name: 'Frontend' }] : [],
    'trello.search_members': (_args, scenario) => scenario === 'clarification' ? [
      { id: 'member_minh_nguyen', name: 'Minh Nguyễn' }, { id: 'member_minh_tran', name: 'Minh Trần' },
    ] : [],
  },
};
