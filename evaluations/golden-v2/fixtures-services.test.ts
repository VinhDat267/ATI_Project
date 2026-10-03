import { describe, expect, it } from 'vitest';
import { ALL_TOOLS } from '@wap/tool-schemas';
import { validateSchemaValue } from '@wap/planner';
import { buildMemory, fixtureSearch, knownResourceValues } from './fixtures.js';

const spreadsheetId = 'spreadsheet_frontend_2026';
const databaseId = '11111111-1111-4111-8111-111111111111';
const pageId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const calls = [
  ['sheets.list_spreadsheets', { query: 'Frontend' }],
  ['sheets.list_sheets', { spreadsheetId, query: 'Tasks' }],
  ['sheets.read_range', { spreadsheetId, range: 'Tasks!A1:B2' }],
  ['calendar.list_calendars', { query: 'Team' }],
  ['calendar.list_events', { calendarId: 'team@example.test', timeMin: '2026-09-30T00:00:00+07:00', timeMax: '2026-10-01T00:00:00+07:00' }],
  ['notion.search_databases', { query: 'Frontend' }],
  ['notion.query_database', { databaseId, query: 'Release' }],
  ['telegram.list_chats', { query: 'frontend' }],
  ['jira.search_projects', { query: 'FE' }],
  ['jira.search_issues', { projectKey: 'FE', query: 'Footer' }],
] as const;

describe('new-service fixture contracts', () => {
  it.each(calls)('%s returns nonempty data conforming to the actual output schema', async (tool, args) => {
    const output = await fixtureSearch({ tool, args });
    expect(validateSchemaValue(output, ALL_TOOLS.find(t => t.name === tool)!.outputSchema, 'output')).toBeNull();
    expect(Array.isArray(output) ? output.length : Object.values(output).flat().length).toBeGreaterThan(0);
  });
  it('preserves parent scoping and bounded results', async () => {
    expect(await fixtureSearch({ tool: 'sheets.list_sheets', args: { spreadsheetId: 'spreadsheet_backend_2026', query: 'Tasks' } }))
      .toEqual([{ id: 0, title: 'Tasks', spreadsheetId: 'spreadsheet_backend_2026' }]);
    expect(await fixtureSearch({ tool: 'notion.query_database', args: { databaseId: '22222222-2222-4222-8222-222222222222' } }))
      .toEqual({ pages: [] });
    const issues = await fixtureSearch({ tool: 'jira.search_issues', args: { projectKey: 'API', query: 'Footer' } });
    expect(issues).toEqual({ issues: [] });
    const chats = await fixtureSearch({ tool: 'telegram.list_chats', args: { query: '', limit: 1 } });
    expect(chats).toHaveLength(1);
  });
  it('reads requested cells and filters Calendar events by start time', async () => {
    expect(await fixtureSearch({ tool: 'sheets.read_range', args: { spreadsheetId, range: 'Tasks!A1:B2', limit: 1 } }))
      .toEqual({ range: 'Tasks!A1:B2', values: [['Task', 'Status']] });
    expect(await fixtureSearch({ tool: 'calendar.list_events', args: { calendarId: 'team@example.test', timeMin: '2026-10-02T00:00:00+07:00', timeMax: '2026-10-03T00:00:00+07:00' } }))
      .toEqual({ events: [] });
  });
  it('records fixture identifiers and field-based resource keys without cross-service collisions', () => {
    for (const [resource, field, value] of [
      ['spreadsheet', 'id', spreadsheetId], ['sheet', 'title', 'Tasks'], ['calendar', 'id', 'team@example.test'],
      ['database', 'id', databaseId], ['page', 'id', pageId], ['chat', 'id', '-1001234567890'],
      ['project', 'key', 'FE'], ['jira_issue', 'key', 'FE-42'],
    ]) expect(knownResourceValues(resource!, field!).has(value!), resource).toBe(true);
    expect(buildMemory({ page: pageId })).toHaveProperty('page.title', 'Release notes');
  });
  it('fails closed on unsupported tools and unknown parents', async () => {
    await expect(fixtureSearch({ tool: 'calendar.create_event', args: {} })).rejects.toThrow();
    await expect(fixtureSearch({ tool: 'sheets.read_range', args: { spreadsheetId: 'unknown_spreadsheet_2026', range: 'Tasks!A1' } })).rejects.toThrow();
  });
});
