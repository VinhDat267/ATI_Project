/**
 * Fixed workspace the golden set is labelled against. Search behaves like the
 * real adapters (case-insensitive name match, lists and members scoped to a
 * board) so gather resolves names exactly as it would against live services.
 */
export const BOARDS = [
  { id: 'board_fe', name: 'Frontend' },
  { id: 'board_be', name: 'Backend' },
  { id: 'board_mkt', name: 'Marketing' },
];

export const LISTS = [
  { id: 'list_fe_todo', name: 'To Do', boardId: 'board_fe' },
  { id: 'list_fe_doing', name: 'Doing', boardId: 'board_fe' },
  { id: 'list_fe_done', name: 'Done', boardId: 'board_fe' },
  { id: 'list_be_todo', name: 'To Do', boardId: 'board_be' },
  { id: 'list_be_backlog', name: 'Backlog', boardId: 'board_be' },
  { id: 'list_mkt_ideas', name: 'Ideas', boardId: 'board_mkt' },
];

export const MEMBERS = [
  { id: 'member_minh', name: 'Minh', boardIds: ['board_fe'] },
  { id: 'member_lan', name: 'Lan', boardIds: ['board_fe'] },
  { id: 'member_huy', name: 'Huy', boardIds: ['board_be'] },
  { id: 'member_minh_anh', name: 'Minh Anh', boardIds: ['board_mkt'] },
  { id: 'member_minh_chau', name: 'Minh Châu', boardIds: ['board_mkt'] },
];

export const CARDS = [
  { id: 'card_fe_login', name: 'Lỗi đăng nhập Safari', url: 'https://trello.com/c/fixture-login', boardId: 'board_fe', listId: 'list_fe_todo' },
];

export const CHANNELS = [
  { id: 'C_FE', name: 'frontend' },
  { id: 'C_GEN', name: 'general' },
  { id: 'C_BE', name: 'backend' },
  { id: 'C_RELEASE', name: 'release' },
];

export const REPOS = [
  { id: 'repo_web', name: 'web', fullName: 'acme/web', url: 'https://github.com/acme/web' },
  { id: 'repo_api', name: 'api', fullName: 'acme/api', url: 'https://github.com/acme/api' },
];

const ENTITIES: Record<string, Array<{ id: string }>> = {
  board: BOARDS, list: LISTS, member: MEMBERS, card: CARDS, channel: CHANNELS, repository: REPOS,
};

/** Every value a resource argument may legitimately take, by x-resource name. */
export function knownResourceValues(resource: string, field = 'id'): Set<string> {
  return new Set((ENTITIES[resource] ?? []).map((entity) => String((entity as any)[field])));
}

/** Builds working memory for resources resolved in earlier turns. */
export function buildMemory(refs: Record<string, string> = {}): Record<string, unknown> {
  return Object.fromEntries(Object.entries(refs).map(([key, id]) => {
    const entity = ENTITIES[key]?.find((candidate) => candidate.id === id);
    if (!entity) throw new Error(`Unknown fixture ${key}=${id}`);
    return [key, structuredClone(entity)];
  }));
}

const matches = (name: string, query: unknown) =>
  typeof query !== 'string' || name.toLocaleLowerCase('vi').includes(query.toLocaleLowerCase('vi'));

/** Fixture implementation of the planner's gather search. */
export async function fixtureSearch({ tool, args }: { tool: string; args: Record<string, unknown> }): Promise<unknown[]> {
  switch (tool) {
    case 'trello.search_boards': return BOARDS.filter((b) => matches(b.name, args.query));
    case 'trello.search_lists': return LISTS.filter((l) => l.boardId === args.boardId && matches(l.name, args.query));
    case 'trello.search_members': return MEMBERS
      .filter((m) => (!args.boardId || m.boardIds.includes(String(args.boardId))) && matches(m.name, args.query))
      .map(({ boardIds: _boardIds, ...member }) => member);
    case 'trello.search_cards': return CARDS.filter((c) => matches(c.name, args.query));
    case 'slack.search_channels': return CHANNELS.filter((c) => matches(c.name, args.query));
    case 'github.search_repos': return REPOS.filter((r) => matches(r.fullName, args.query));
    default: return [];
  }
}
