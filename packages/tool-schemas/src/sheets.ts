import type { ToolDefinition } from './types.js';

const spreadsheetId = { type: 'string', pattern: '^[A-Za-z0-9_-]{20,}$', 'x-resource': 'spreadsheet' };
const listInputs = { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 10, default: 10 } };
const input = (properties: object, required: string[]) => ({ type: 'object', properties, required, additionalProperties: false });
const output = (properties: object, required: string[]) => ({ type: 'object', properties, required });
const str = { type: 'string' };

export const SHEETS_TOOLS: ToolDefinition[] = [
  {
    name: 'sheets.list_spreadsheets', service: 'sheets', sideEffect: 'read', riskLevel: 'low', discovers: 'spreadsheet', listable: true,
    description: 'Liệt kê bảng tính trong allowlist, lọc theo tên; query rỗng để lấy danh sách.',
    inputSchema: input(listInputs, ['query']),
    outputSchema: { type: 'array', items: output({ id: str, title: str, url: str }, ['id', 'title', 'url']) },
  },
  {
    name: 'sheets.list_sheets', service: 'sheets', sideEffect: 'read', riskLevel: 'low', discovers: 'sheet', listable: true,
    description: 'Liệt kê các tab của một bảng tính đã tìm thấy, lọc theo tên; query có thể rỗng.',
    inputSchema: input({ spreadsheetId, ...listInputs }, ['spreadsheetId', 'query']),
    outputSchema: { type: 'array', items: output({ id: { type: 'integer' }, title: str, spreadsheetId: str }, ['id', 'title', 'spreadsheetId']) },
  },
  {
    name: 'sheets.read_range', service: 'sheets', sideEffect: 'read', riskLevel: 'low',
    description: 'Đọc vùng ô A1:B2 hoặc Tasks!A1:B2 trong bảng tính được cấp quyền, tối đa 50 dòng.',
    inputSchema: input({ spreadsheetId, range: { type: 'string', minLength: 1, maxLength: 200 }, limit: { type: 'integer', minimum: 1, maximum: 50, default: 50 } }, ['spreadsheetId', 'range']),
    outputSchema: output({ range: str, values: { type: 'array', items: { type: 'array', items: str } } }, ['range', 'values']),
  },
  {
    name: 'sheets.append_rows', service: 'sheets', sideEffect: 'write', riskLevel: 'medium',
    description: 'Sau khi duyệt, thêm 1–20 dòng vào tab đã tìm thấy; bảo vệ ô bắt đầu bằng ký tự công thức.',
    inputSchema: input({ spreadsheetId, sheet: { type: 'string', minLength: 1, maxLength: 100, 'x-resource': 'sheet', 'x-resource-field': 'title' },
      rows: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string', maxLength: 1000 } } },
    }, ['spreadsheetId', 'sheet', 'rows']),
    outputSchema: output({ spreadsheetId: str, updatedRange: str, updatedRows: { type: 'integer' }, url: str }, ['spreadsheetId', 'updatedRange', 'updatedRows', 'url']),
  },
];
