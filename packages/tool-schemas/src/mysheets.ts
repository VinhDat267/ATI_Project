import type { ToolDefinition } from './types.js';

export const MYSHEETS_SCOPE = 'https://www.googleapis.com/auth/drive.file';

const spreadsheetId = { type: 'string', pattern: '^[A-Za-z0-9_-]{20,}$', 'x-resource': 'myspreadsheet' };
const listInputs = { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 10, default: 10 } };
const input = (properties: object, required: string[]) => ({ type: 'object', properties, required, additionalProperties: false });
const output = (properties: object, required: string[]) => ({ type: 'object', properties, required });
const str = { type: 'string' };

export const MYSHEETS_TOOLS: ToolDefinition[] = [
  {
    name: 'mysheets.list_spreadsheets',
    service: 'mysheets',
    sideEffect: 'read',
    riskLevel: 'low',
    discovers: 'myspreadsheet',
    listable: true,
    description: 'Liệt kê các bảng tính cá nhân bạn đã chọn cho ATI, lọc theo tên; query rỗng để lấy danh sách.',
    inputSchema: input(listInputs, ['query']),
    outputSchema: { type: 'array', items: output({ id: str, title: str, url: str }, ['id', 'title', 'url']) },
  },
  {
    name: 'mysheets.list_sheets',
    service: 'mysheets',
    sideEffect: 'read',
    riskLevel: 'low',
    discovers: 'mysheet',
    listable: true,
    description: 'Liệt kê các tab của một bảng tính cá nhân đã tìm thấy, lọc theo tên; query có thể rỗng.',
    inputSchema: input({ spreadsheetId, ...listInputs }, ['spreadsheetId', 'query']),
    outputSchema: { type: 'array', items: output({ id: { type: 'integer' }, title: str, spreadsheetId: str }, ['id', 'title', 'spreadsheetId']) },
  },
  {
    name: 'mysheets.read_range',
    service: 'mysheets',
    sideEffect: 'read',
    riskLevel: 'low',
    description: 'Đọc vùng ô A1:B2, tên tab (Tasks), dải cột (Tasks!A:D) hoặc N dòng cuối (Tasks!tail:5) trong bảng tính cá nhân được cấp quyền, tối đa 50 dòng; mỗi dòng tối đa 26 cột, mỗi ô tối đa 500 ký tự, phần dài hơn bị cắt và kết quả có truncated: true.',
    inputSchema: input({
      spreadsheetId,
      range: { type: 'string', minLength: 1, maxLength: 200 },
      limit: { type: 'integer', minimum: 1, maximum: 50, default: 50 },
      tail: { type: 'integer', minimum: 1, maximum: 50 },
      headerAware: { type: 'boolean' },
    }, ['spreadsheetId', 'range']),
    outputSchema: output({
      range: str,
      values: { type: 'array', items: { type: 'array', items: str } },
      truncated: { type: 'boolean' },
      headers: { type: 'array', items: str },
      records: { type: 'array', items: { type: 'object' } },
      totalDataRows: { type: 'integer' },
    }, ['range', 'values']),
  },
  {
    name: 'mysheets.append_rows',
    service: 'mysheets',
    sideEffect: 'write',
    riskLevel: 'medium',
    description: 'Sau khi duyệt, thêm 1–20 dòng vào tab đã tìm thấy trong bảng tính cá nhân; tự động chống ghi trùng khi đồng bộ mã định danh hoặc bật deduplicate, đồng thời bảo vệ ô bắt đầu bằng ký tự công thức.',
    inputSchema: input({
      spreadsheetId,
      sheet: { type: 'string', minLength: 1, maxLength: 100, 'x-resource': 'mysheet', 'x-resource-field': 'title' },
      rows: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string', maxLength: 1000 } } },
      deduplicate: { type: 'boolean' },
      deduplicateColumn: { type: 'integer', minimum: 0, maximum: 19 },
      deduplicateColumns: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'integer', minimum: 0, maximum: 19 } },
    }, ['spreadsheetId', 'sheet', 'rows']),
    outputSchema: output({
      spreadsheetId: str,
      updatedRange: str,
      updatedRows: { type: 'integer' },
      skippedDuplicates: { type: 'integer' },
      url: str,
    }, ['spreadsheetId', 'updatedRange', 'updatedRows', 'url']),
  },
];
