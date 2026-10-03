import { expect, it } from 'vitest';
import * as live from './live-services.js';

it.each([
  ['jira', 'jira.search_projects'],
  ['telegram', 'telegram.list_chats'],
  ['notion', 'notion.search_databases'],
  ['calendar', 'calendar.list_calendars'], ['sheets', 'sheets.list_spreadsheets'],
  ['github', 'github.search_repos'], ['slack', 'slack.search_channels'], ['trello', 'trello.search_boards'],
])('checks %s through its own registered read directory', async (service, directory) => {
  const calls: Array<{ tool: string; args: any }> = [];
  const adapter = { async execute(tool: string, args: any) { calls.push({ tool, args }); return [{ id: 'resource_fixture', title: 'Fixture' }]; } };
  expect(await live.checkLiveService(service, adapter)).toBe(1);
  expect(calls[0]).toEqual({ tool: directory, args: { query: '', limit: 10 } });
  if (service === 'trello') expect(calls[1]).toEqual({ tool: 'trello.search_lists', args: { query: '', limit: 10, boardId: 'resource_fixture' } });
  if (service === 'sheets') expect(calls[1]).toEqual({ tool: 'sheets.list_sheets', args: { query: '', limit: 10, spreadsheetId: 'resource_fixture' } });
});
it('rejects empty directories and an unknown service without dispatching any write', async () => {
  const adapter = { async execute() { return []; } };
  await expect(live.checkLiveService('calendar', adapter)).rejects.toThrow(/no allowlisted resource/);
  await expect(live.checkLiveService('unknown', adapter)).rejects.toThrow(/no registered directory/);
});
