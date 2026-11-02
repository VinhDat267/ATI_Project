import type { FakeService } from './types.js';

const id = 'spreadsheet_fixture_123456';
const url = 'https://docs.google.com/spreadsheets/d/' + id + '/edit';
export const SHEETS_FAKE: FakeService = {
  id: 'sheets', tools: {
    'sheets.list_spreadsheets': () => [{ id, title: 'ATI Test Tracker', url }],
    'sheets.list_sheets': () => [{ id: 0, title: 'Tasks', spreadsheetId: id, headers: ['Task', 'Status'] }],
    'sheets.read_range': args => ({ range: args.range, values: [['Task', 'Status'], ['Sandbox task', 'To Do']] }),
    'sheets.search_rows': args => ({
      spreadsheetId: args.spreadsheetId,
      sheet: args.sheet ?? 'Tasks',
      headers: ['Task', 'Status'],
      matches: [{ rowNumber: 2, values: ['Sandbox task', 'To Do'], record: { Task: 'Sandbox task', Status: 'To Do' } }],
      totalMatched: 1,
      totalDataRows: 1,
    }),
    'sheets.aggregate_rows': args => ({
      sheet: args.sheet ?? 'Tasks',
      totalRowsScanned: 2,
      matchedRows: 2,
      groups: [{ key: 'To Do', count: 2, metrics: { Task_count: 2 } }],
      totals: { Task_count: 2 },
    }),
    'sheets.append_rows': args => {
      const count = Array.isArray(args.rows) ? args.rows.length : Array.isArray(args.records) ? args.records.length : 1;
      return { spreadsheetId: args.spreadsheetId, updatedRange: 'Tasks!A4:A4', updatedRows: count, url, values: args.rows ?? [] };
    },
    'sheets.update_rows': args => ({
      spreadsheetId: args.spreadsheetId,
      sheet: args.sheet ?? 'Tasks',
      updatedRange: 'Tasks!B2:B2',
      updatedRows: Array.isArray(args.updates) ? args.updates.length : 1,
      updatedCells: Array.isArray(args.updates) ? args.updates.length : 1,
      url,
    }),
    'sheets.delete_rows': args => ({
      spreadsheetId: args.spreadsheetId,
      sheet: args.sheet ?? 'Tasks',
      deletedRows: Array.isArray(args.rowNumbers) ? args.rowNumbers.length : 1,
      deletedRowNumbers: Array.isArray(args.rowNumbers) ? args.rowNumbers : [2],
      url,
    }),
    'sheets.create_sheet': args => ({
      spreadsheetId: args.spreadsheetId,
      sheetId: 1,
      title: args.title,
      headers: args.headers ?? [],
      url,
    }),
  },
};
