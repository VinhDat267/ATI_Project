import type { FakeService } from './types.js';

export const TRELLO_FAKE: FakeService = {
  id: 'trello',
  tools: {
    'trello.search_boards': (_args, scenario) =>
      scenario === 'clarification'
        ? [{ id: 'board_frontend', name: 'Frontend' }]
        : [{ id: 'b1', name: 'Sprint Board' }, { id: 'b2', name: 'Bug Tracker' }],
    'trello.search_lists': (args) => [
      { id: 'list_1', name: 'To Do', boardId: args.boardId || 'b1' },
      { id: 'list_2', name: 'In Progress', boardId: args.boardId || 'b1' },
      { id: 'list_3', name: 'Done', boardId: args.boardId || 'b1' },
    ],
    'trello.search_members': (_args, scenario) =>
      scenario === 'clarification'
        ? [
            { id: 'member_minh_nguyen', name: 'Minh Nguyễn' },
            { id: 'member_minh_tran', name: 'Minh Trần' },
          ]
        : [{ id: 'member_minh_dev', name: 'Minh Dev' }],
    'trello.search_cards': (args) => [
      { id: 'card_1', name: 'Thẻ hiện có', idBoard: args.boardId || 'b1', idList: args.listId || 'list_1' },
    ],
    'trello.get_card': (args) => ({
      id: args.cardId || 'card_1',
      name: 'Thẻ sandbox',
      url: `https://trello.com/c/${args.cardId || 'card_1'}`,
      idBoard: 'b1',
      idList: 'list_1',
      desc: 'Mô tả thẻ sandbox',
    }),
    'trello.create_card': (args) => ({
      id: 'card_' + Date.now(),
      name: args.title || 'Thẻ mới',
      url: 'https://trello.com/c/sandbox/card',
      listId: args.listId || 'list_1',
      desc: args.desc,
    }),
    'trello.update_card': (args) => ({
      id: args.cardId || 'card_1',
      name: args.title || 'Thẻ cập nhật',
      desc: args.desc,
      closed: args.closed,
    }),
    'trello.add_member': (args) => ({ id: args.cardId, idMembers: [args.memberId] }),
    'trello.add_checklist': (args) => ({
      id: 'check_' + Date.now(),
      idCard: args.cardId,
      name: args.name || 'Checklist',
    }),
  },
};
