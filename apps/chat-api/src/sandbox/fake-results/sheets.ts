import type { FakeService } from './types.js';

const id = 'spreadsheet_fixture_123456';
const url = 'https://docs.google.com/spreadsheets/d/' + id + '/edit';
export const SHEETS_FAKE: FakeService = {
  id: 'sheets', tools: {
    'sheets.list_spreadsheets': () => [{ id, title: 'ATI Test Tracker', url }],
    'sheets.list_sheets': () => [{ id: 0, title: 'Tasks', spreadsheetId: id }],
    'sheets.read_range': args => ({ range: args.range, values: [['Task', 'Status'], ['Sandbox task', 'To Do']] }),
    'sheets.append_rows': args => ({ spreadsheetId: args.spreadsheetId, updatedRange: 'Tasks!A4:A4', updatedRows: args.rows.length, url, values: args.rows }),
  },
};
