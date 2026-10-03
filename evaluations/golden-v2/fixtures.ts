/**
 * Fixed workspace the golden set is labelled against. Search behaves like the
 * real adapters (case-insensitive name match, lists and members scoped to a
 * board) so gather resolves names exactly as it would against live services.
 */
import { ALL_TOOLS } from '@wap/tool-schemas';
import { validateSchemaValue } from '@wap/planner';

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

export const ISSUES = [
  { id: 'issue_api_42', number: 42, title: 'Webhook retries drop events', url: 'https://github.com/acme/api/issues/42', repo: 'acme/api', body: 'Retries after a 5xx are not re-queued.', labels: [] as string[] },
  { id: 'issue_web_42', number: 42, title: 'Footer overlaps on small screens', url: 'https://github.com/acme/web/issues/42', repo: 'acme/web', body: 'The footer covers the last form field.', labels: [] as string[] },
];

export const SPREADSHEETS = [
  { id: 'spreadsheet_frontend_2026', title: 'Frontend', url: 'https://docs.google.com/spreadsheets/d/spreadsheet_frontend_2026/edit' },
  { id: 'spreadsheet_backend_2026', title: 'Backend', url: 'https://docs.google.com/spreadsheets/d/spreadsheet_backend_2026/edit' },
];
export const SHEETS = [
  { id: 0, title: 'Tasks', spreadsheetId: SPREADSHEETS[0]!.id },
  { id: 1, title: 'History', spreadsheetId: SPREADSHEETS[0]!.id },
  { id: 0, title: 'Tasks', spreadsheetId: SPREADSHEETS[1]!.id },
];
export const CALENDARS = [
  { id: 'team@example.test', title: 'Team', timeZone: 'Asia/Ho_Chi_Minh' },
  { id: 'release@example.test', title: 'Release', timeZone: 'Asia/Ho_Chi_Minh' },
];
export const EVENTS = [
  { calendarId: CALENDARS[0]!.id, id: 'event_standup', title: 'Standup', start: '2026-09-30T09:00:00+07:00', end: '2026-09-30T09:30:00+07:00', url: 'https://calendar.google.com/calendar/event?eid=fixture_standup' },
];
export const DATABASES = [
  { id: '11111111-1111-4111-8111-111111111111', title: 'Frontend', url: 'https://www.notion.so/11111111111141118111111111111111' },
  { id: '22222222-2222-4222-8222-222222222222', title: 'Backend', url: 'https://www.notion.so/22222222222242228222222222222222' },
];
export const PAGES = [
  { databaseId: DATABASES[0]!.id, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: 'Release notes', url: 'https://www.notion.so/aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa', properties: { Name: 'Release notes', Status: 'Draft' } },
];
export const CHATS = [
  { id: '-1001234567890', title: 'frontend', type: 'supergroup' },
  { id: '-1009876543210', title: 'release', type: 'group' },
];
export const PROJECTS = [
  { id: '10001', key: 'FE', name: 'Frontend' },
  { id: '10002', key: 'API', name: 'Backend' },
];
export const JIRA_ISSUES = [
  { projectKey: 'FE', id: '10142', key: 'FE-42', title: 'Footer overlaps on small screens', status: 'To Do', url: 'https://fixture.atlassian.net/browse/FE-42' },
  { projectKey: 'API', id: '10242', key: 'API-42', title: 'Webhook retries drop events', status: 'In Progress', url: 'https://fixture.atlassian.net/browse/API-42' },
];
const GRIDS: Record<string, string[][]> = {
  'spreadsheet_frontend_2026:Tasks': [['Task', 'Status'], ['Fix footer', 'To Do']],
  'spreadsheet_frontend_2026:History': [['Event', 'Link']],
  'spreadsheet_backend_2026:Tasks': [['Task', 'Status'], ['Retry webhook', 'Doing']],
};
const ENTITIES: Record<string, Array<{ id: string | number }>> = {
  board: BOARDS, list: LISTS, member: MEMBERS, card: CARDS, channel: CHANNELS, repository: REPOS, issue: ISSUES,
  spreadsheet: SPREADSHEETS, sheet: SHEETS, calendar: CALENDARS, database: DATABASES, page: PAGES,
  chat: CHATS, project: PROJECTS, jira_issue: JIRA_ISSUES,
};

/** Every value a resource argument may legitimately take, by x-resource name. */
export function knownResourceValues(resource: string, field = 'id'): Set<string> {
  return new Set((ENTITIES[resource] ?? []).map((entity) => String((entity as any)[field])));
}

/** Builds working memory for resources resolved in earlier turns. */
export function buildMemory(refs: Record<string, string> = {}): Record<string, unknown> {
  return Object.fromEntries(Object.entries(refs).map(([key, id]) => {
    const entity = ENTITIES[key]?.find((candidate) => String(candidate.id) === id);
    if (!entity) throw new Error(`Unknown fixture ${key}=${id}`);
    return [key, structuredClone(entity)];
  }));
}

const matches = (name: string, query: unknown) =>
  typeof query !== 'string' || name.toLocaleLowerCase('vi').includes(query.toLocaleLowerCase('vi'));

/** Fixture implementation of the planner's gather search; get_* tools return one object like the adapters. */
export async function fixtureSearch({ tool, args }: { tool: string; args: Record<string, unknown> }): Promise<any> {
  const definition = ALL_TOOLS.find(candidate => candidate.name === tool);
  if (!definition || definition.sideEffect !== 'read') throw new Error(`Fixture search does not support ${tool}`);
  // Preserve legacy search behavior; validate every new-service call at the real schema boundary.
  if (['sheets', 'calendar', 'notion', 'telegram', 'jira'].includes(definition.service)) {
    const error = validateSchemaValue(args, definition.inputSchema, 'args');
    if (error) throw new Error(error);
  }
  const bounded = <T>(items: T[], maximum: number) => structuredClone(items.slice(0, Number(args.limit ?? maximum)));
  const requireParent = (resource: string, id: unknown, field = 'id') => {
    if (!knownResourceValues(resource, field).has(String(id))) throw new Error(`Unknown fixture ${resource}=${String(id)}`);
  };
  switch (tool) {
    case 'sheets.list_spreadsheets': return bounded(SPREADSHEETS.filter(item => matches(item.title, args.query)), 10);
    case 'sheets.list_sheets':
      requireParent('spreadsheet', args.spreadsheetId);
      return bounded(SHEETS.filter(item => item.spreadsheetId === args.spreadsheetId && matches(item.title, args.query)), 10);
    case 'sheets.read_range': {
      requireParent('spreadsheet', args.spreadsheetId);
      const range = String(args.range);
      const parts = /^(?:(?:'((?:[^']|'')+)'|([^!]+))!)?([A-Z]+)([1-9]\d*)(?::([A-Z]+)([1-9]\d*))?$/.exec(range);
      if (!parts) throw new Error('Fixture range must be bounded A1 notation');
      const title = parts[1]?.replaceAll("''", "'") ?? parts[2] ?? SHEETS.find(item => item.spreadsheetId === args.spreadsheetId)!.title;
      const grid = GRIDS[`${String(args.spreadsheetId)}:${title}`];
      if (!grid) throw new Error(`Unknown fixture tab ${title}`);
      const column = (letters: string) => [...letters].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
      const first = Number(parts[4]) - 1, last = Number(parts[6] ?? parts[4]);
      const left = column(parts[3]!), right = column(parts[5] ?? parts[3]!) + 1;
      if (last <= first || right <= left) throw new Error('Fixture range is reversed');
      return { range, values: bounded(grid.slice(first, last).map(row => row.slice(left, right)), 50) };
    }
    case 'calendar.list_calendars': return bounded(CALENDARS.filter(item => matches(item.title, args.query)), 10);
    case 'calendar.list_events': {
      requireParent('calendar', args.calendarId);
      const start = Date.parse(String(args.timeMin)), end = Date.parse(String(args.timeMax));
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 31 * 86400000) throw new Error('Invalid fixture event window');
      return { events: bounded(EVENTS.filter(item => item.calendarId === args.calendarId && Date.parse(item.start) >= start && Date.parse(item.start) < end && matches(item.title, args.query))
        .map(({ calendarId: _parent, ...event }) => event), 20) };
    }
    case 'notion.search_databases': return bounded(DATABASES.filter(item => matches(item.title, args.query)), 10);
    case 'notion.query_database':
      requireParent('database', args.databaseId);
      return { pages: bounded(PAGES.filter(item => item.databaseId === args.databaseId && matches(item.title, args.query))
        .map(({ databaseId: _parent, ...page }) => page), 20) };
    case 'telegram.list_chats': return bounded(CHATS.filter(item => matches(item.title, args.query)), 10);
    case 'jira.search_projects': return bounded(PROJECTS.filter(item => matches(item.name, args.query) || matches(item.key, args.query)), 10);
    case 'jira.search_issues':
      requireParent('project', args.projectKey, 'key');
      return { issues: bounded(JIRA_ISSUES.filter(item => item.projectKey === args.projectKey && matches(item.title, args.query))
        .map(({ projectKey: _parent, ...issue }) => issue), 20) };
    case 'trello.search_boards': return BOARDS.filter((b) => matches(b.name, args.query));
    case 'trello.search_lists': return LISTS.filter((l) => l.boardId === args.boardId && matches(l.name, args.query));
    case 'trello.search_members':
      // Mirrors TrelloReadTools.searchMembers, which refuses to search outside a board.
      if (!args.boardId) throw new Error('A board ID is required to search members within an allowed board');
      return MEMBERS
      .filter((m) => m.boardIds.includes(String(args.boardId)) && matches(m.name, args.query))
      .map(({ boardIds: _boardIds, ...member }) => member);
    case 'trello.search_cards': return CARDS.filter((c) => matches(c.name, args.query));
    case 'slack.search_channels': return CHANNELS.filter((c) => matches(c.name, args.query));
    case 'github.search_repos': return REPOS.filter((r) => matches(r.fullName, args.query));
    case 'github.search_issues': return ISSUES
      .filter((i) => i.repo === args.repo && (matches(i.title, args.query) || String(i.number) === String(args.query).replace('#', '')))
      .map(({ body: _body, labels: _labels, ...issue }) => issue);
    case 'github.get_issue': {
      const found = ISSUES.find((i) => i.repo === args.repo && i.number === args.issueNumber);
      if (!found) throw new Error(`Issue ${args.issueNumber} not found in ${args.repo}`);
      return found;
    }
    case 'trello.get_card': {
      const found = CARDS.find((c) => c.id === args.cardId);
      if (!found) throw new Error(`Card ${args.cardId} not found`);
      return found;
    }
    default: throw new Error(`Fixture search does not support ${tool}`);
  }
}
