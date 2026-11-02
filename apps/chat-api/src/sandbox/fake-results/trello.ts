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
    'trello.search_cards': (args) => {
      const boardId = args.boardId || 'b1';
      const listId = args.listId || 'list_1';
      const baseCard = {
        id: 'card_1',
        name: 'Thẻ hiện có',
        idBoard: boardId,
        boardId,
        idList: listId,
        listId,
        url: 'https://trello.com/c/card_1',
        due: null,
        dueComplete: false,
        idMembers: [],
        labels: ['bug'],
      };
      if (args.query === '') {
        return [
          baseCard,
          {
            id: 'card_overdue',
            name: 'Vá lỗi bảo mật OAuth',
            idBoard: boardId,
            boardId,
            idList: listId,
            listId,
            url: 'https://trello.com/c/card_overdue',
            due: new Date(Date.now() - 12 * 3600_000).toISOString(),
            dueComplete: false,
            idMembers: ['member_minh_dev'],
            labels: ['security'],
          },
          {
            id: 'card_due_soon',
            name: 'Hoàn thiện UI Kanban',
            idBoard: boardId,
            boardId,
            idList: listId,
            listId,
            url: 'https://trello.com/c/card_due_soon',
            due: new Date(Date.now() + 6 * 3600_000).toISOString(),
            dueComplete: false,
            idMembers: ['member_minh_dev'],
            labels: ['frontend'],
          },
        ];
      }
      return [{ id: 'card_1', name: 'Thẻ hiện có', idBoard: boardId, idList: listId }];
    },
    'trello.get_card': (args) => ({
      id: args.cardId || 'card_1',
      name: 'Thẻ sandbox',
      url: `https://trello.com/c/${args.cardId || 'card_1'}`,
      idBoard: 'b1',
      idList: 'list_1',
      desc: 'Mô tả thẻ sandbox',
      due: '2026-12-20T09:00:00.000Z',
      dueComplete: false,
      idMembers: ['member_minh_dev'],
      labels: ['bug'],
      checklists: [
        {
          id: 'chk_1',
          name: 'Checklist Nghiệm Thu',
          items: [
            { id: 'item_1', name: 'Kiểm tra unit test', state: 'complete' },
            { id: 'item_2', name: 'Kiểm tra giao diện', state: 'incomplete' },
          ],
        },
      ],
    }),
    'trello.create_card': (args) => ({
      id: 'card_' + Date.now(),
      name: args.title || 'Thẻ mới',
      url: 'https://trello.com/c/sandbox/card',
      listId: args.listId || 'list_1',
      desc: args.desc,
      ...(args.due !== undefined ? { due: args.due } : {}),
      ...(args.dueComplete !== undefined ? { dueComplete: Boolean(args.dueComplete) } : {}),
      ...(Array.isArray(args.idMembers) ? { idMembers: args.idMembers } : {}),
    }),
    'trello.update_card': (args) => ({
      id: args.cardId || 'card_1',
      name: args.title || 'Thẻ cập nhật',
      desc: args.desc,
      closed: args.closed,
      ...(args.due !== undefined ? { due: args.due } : {}),
      ...(args.dueComplete !== undefined ? { dueComplete: Boolean(args.dueComplete) } : {}),
      url: `https://trello.com/c/${args.cardId || 'card_1'}`,
    }),
    'trello.add_member': (args) => ({ id: args.cardId, idMembers: [args.memberId] }),
    'trello.remove_member': (args) => ({
      id: args.cardId || 'card_1',
      removedMemberId: args.memberId,
      idMembers: [],
    }),
    'trello.add_checklist': (args) => ({
      id: 'check_' + Date.now(),
      idCard: args.cardId,
      name: args.title || args.name || 'Checklist',
      items: Array.isArray(args.items)
        ? args.items.map((itemName: string, idx: number) => ({
            id: `item_${idx + 1}`,
            name: itemName,
            state: 'incomplete',
          }))
        : [],
    }),
    'trello.update_checklist_item': (args) => ({
      id: args.checkItemId || 'item_1',
      name: args.itemName || 'Kiểm tra unit test',
      state: args.state || 'complete',
    }),
    'trello.add_comment': (args) => ({
      id: 'comment_' + Date.now(),
      cardId: args.cardId || 'card_1',
      text: args.text || '',
      url: `https://trello.com/c/${args.cardId || 'card_1'}#comment-1`,
    }),
    'trello.create_list': (args) => ({
      id: 'list_' + Date.now(),
      name: args.name || 'Cột mới',
      idBoard: args.boardId || 'b1',
      closed: false,
    }),
    'trello.set_card_due_complete': (args) => ({
      id: args.cardId || 'card_1',
      name: args.name || 'Triển khai Trello OAuth',
      dueComplete: Boolean(args.dueComplete),
      url: `https://trello.com/c/${args.cardId || 'card_1'}`,
    }),
  },
};
