import type { ToolDefinition } from './types.js';

const spreadsheetId = { type: 'string', pattern: '^[A-Za-z0-9_-]{20,}$', 'x-resource': 'spreadsheet' };
const listInputs = { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 10, default: 10 } };
const input = (properties: object, required: string[], extra?: object) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
  ...extra,
});
const output = (properties: object, required: string[]) => ({ type: 'object', properties, required });
const str = { type: 'string' };

const filterOperatorEnum = ['contains', 'equals', 'not_equals', 'empty', 'not_empty', 'gt', 'gte', 'lt', 'lte'];
const filterConditionSchema = {
  type: 'object',
  properties: {
    column: { type: 'string', minLength: 1, maxLength: 100 },
    operator: { type: 'string', enum: filterOperatorEnum },
    value: { type: 'string', maxLength: 500 },
  },
  required: ['column'],
  additionalProperties: false,
};

export const SHEETS_TOOLS: ToolDefinition[] = [
  {
    name: 'sheets.list_spreadsheets', service: 'sheets', sideEffect: 'read', riskLevel: 'low', discovers: 'spreadsheet', listable: true,
    description: 'Liệt kê bảng tính trong allowlist, lọc theo tên; query rỗng để lấy danh sách.',
    inputSchema: input(listInputs, ['query']),
    outputSchema: { type: 'array', items: output({ id: str, title: str, url: str }, ['id', 'title', 'url']) },
  },
  {
    name: 'sheets.list_sheets', service: 'sheets', sideEffect: 'read', riskLevel: 'low', discovers: 'sheet', listable: true,
    observedFields: ['id', 'title', 'spreadsheetId', 'headers'],
    description: 'Liệt kê các tab của một bảng tính đã tìm thấy, lọc theo tên; query có thể rỗng.',
    inputSchema: input({ spreadsheetId, ...listInputs }, ['spreadsheetId', 'query']),
    outputSchema: { type: 'array', items: output({ id: { type: 'integer' }, title: str, spreadsheetId: str, headers: { type: 'array', items: str } }, ['id', 'title', 'spreadsheetId']) },
  },
  {
    name: 'sheets.read_range', service: 'sheets', sideEffect: 'read', riskLevel: 'low',
    description: 'Đọc vùng ô A1:B2, tên tab (Tasks), dải cột (Tasks!A:D) hoặc N dòng cuối (Tasks!tail:5) trong bảng tính được cấp quyền, tối đa 50 dòng; mỗi dòng tối đa 26 cột, mỗi ô tối đa 500 ký tự, phần dài hơn bị cắt và kết quả có truncated: true.',
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
    name: 'sheets.append_rows', service: 'sheets', sideEffect: 'write', riskLevel: 'medium',
    description: 'Sau khi duyệt, thêm 1–20 dòng vào tab đã tìm thấy (chấp nhận mảng vị trí rows hoặc đối tượng theo tên cột records); chống ghi trùng và bảo vệ ô bắt đầu bằng ký tự công thức.',
    inputSchema: input({
      spreadsheetId,
      sheet: { type: 'string', minLength: 1, maxLength: 100, 'x-resource': 'sheet', 'x-resource-field': 'title' },
      rows: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string', maxLength: 1000 } } },
      records: {
        type: 'array',
        minItems: 1,
        maxItems: 20,
        items: {
          type: 'object',
          additionalProperties: { type: 'string', maxLength: 1000 },
        },
      },
      deduplicate: { type: 'boolean' },
      deduplicateColumn: { type: 'integer', minimum: 0, maximum: 19 },
      deduplicateColumns: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'integer', minimum: 0, maximum: 19 } },
      keyColumn: { type: 'string', minLength: 1, maxLength: 100 },
      onDuplicate: { type: 'string', enum: ['skip', 'update'] },
    }, ['spreadsheetId', 'sheet'], {
      anyOf: [{ required: ['rows'] }, { required: ['records'] }],
    }),
    outputSchema: output({
      spreadsheetId: str,
      updatedRange: str,
      updatedRows: { type: 'integer' },
      skippedDuplicates: { type: 'integer' },
      url: str,
    }, ['spreadsheetId', 'updatedRange', 'updatedRows', 'url']),
  },
];

export const SHEETS_EXTENDED_TOOLS: ToolDefinition[] = [
  {
    name: 'sheets.search_rows',
    service: 'sheets',
    sideEffect: 'read',
    riskLevel: 'low',
    description: 'Tìm kiếm và lọc dòng trên toàn bộ tab (quét tới 500 dòng) theo từ khóa chung hoặc điều kiện cột (hỗ trợ chuỗi, số học gt/gte/lt/lte và ngày tháng, hoặc mảng filters đa cột); trả về số dòng thực tế (rowNumber) và bản ghi theo tên cột.',
    inputSchema: input({
      spreadsheetId,
      sheet: { type: 'string', minLength: 1, maxLength: 100, 'x-resource': 'sheet', 'x-resource-field': 'title' },
      query: { type: 'string', maxLength: 200 },
      column: { type: 'string', minLength: 1, maxLength: 100 },
      operator: { type: 'string', enum: filterOperatorEnum },
      value: { type: 'string', maxLength: 500 },
      filters: { type: 'array', minItems: 1, maxItems: 10, items: filterConditionSchema },
      limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
    }, ['spreadsheetId', 'sheet']),
    outputSchema: output({
      sheet: str,
      headers: { type: 'array', items: str },
      totalMatched: { type: 'integer' },
      matches: {
        type: 'array',
        items: output({
          rowNumber: { type: 'integer' },
          values: { type: 'array', items: str },
          record: { type: 'object' },
        }, ['rowNumber', 'values', 'record']),
      },
    }, ['sheet', 'headers', 'totalMatched', 'matches']),
  },
  {
    name: 'sheets.aggregate_rows',
    service: 'sheets',
    sideEffect: 'read',
    riskLevel: 'low',
    description: 'Thống kê và tổng hợp số liệu trên toàn bộ tab (quét tới 500 dòng): hỗ trợ lọc trước qua query/filters, gom nhóm theo cột (groupBy) và tính chính xác sum, avg, min, max, count cho các cột số tiền/số lượng.',
    inputSchema: input({
      spreadsheetId,
      sheet: { type: 'string', minLength: 1, maxLength: 100, 'x-resource': 'sheet', 'x-resource-field': 'title' },
      query: { type: 'string', maxLength: 200 },
      filters: { type: 'array', minItems: 1, maxItems: 10, items: filterConditionSchema },
      groupBy: { type: 'string', minLength: 1, maxLength: 100 },
      metrics: {
        type: 'array',
        minItems: 1,
        maxItems: 10,
        items: {
          type: 'object',
          properties: {
            column: { type: 'string', minLength: 1, maxLength: 100 },
            fn: { type: 'string', enum: ['sum', 'avg', 'min', 'max', 'count'] },
          },
          required: ['column', 'fn'],
          additionalProperties: false,
        },
      },
    }, ['spreadsheetId', 'sheet']),
    outputSchema: output({
      sheet: str,
      totalRowsScanned: { type: 'integer' },
      matchedRows: { type: 'integer' },
      groups: {
        type: 'array',
        items: output({
          key: str,
          count: { type: 'integer' },
          metrics: { type: 'object' },
        }, ['key', 'count', 'metrics']),
      },
      totals: { type: 'object' },
    }, ['sheet', 'totalRowsScanned', 'matchedRows', 'groups', 'totals']),
  },
  {
    name: 'sheets.update_rows',
    service: 'sheets',
    sideEffect: 'write',
    riskLevel: 'medium',
    description: 'Sau khi duyệt, cập nhật có chọn lọc một hoặc nhiều cột theo tên cột (hoặc chữ cái cột) trên dòng hiện có (xác định qua rowNumber hoặc cặp matchColumn + matchValue); bảo toàn các cột khác và ô công thức.',
    inputSchema: input({
      spreadsheetId,
      sheet: { type: 'string', minLength: 1, maxLength: 100, 'x-resource': 'sheet', 'x-resource-field': 'title' },
      updates: {
        type: 'array',
        minItems: 1,
        maxItems: 20,
        items: {
          type: 'object',
          properties: {
            rowNumber: { type: 'integer', minimum: 2, maximum: 500 },
            matchColumn: { type: 'string', minLength: 1, maxLength: 100 },
            matchValue: { type: 'string', minLength: 1, maxLength: 500 },
            values: {
              type: 'object',
              additionalProperties: { type: 'string', maxLength: 1000 },
            },
          },
          required: ['values'],
          additionalProperties: false,
        },
      },
    }, ['spreadsheetId', 'sheet', 'updates']),
    outputSchema: output({
      spreadsheetId: str,
      updatedRange: str,
      updatedRows: { type: 'integer' },
      updatedCells: { type: 'integer' },
      unmatchedKeys: { type: 'array', items: str },
      url: str,
    }, ['spreadsheetId', 'updatedRange', 'updatedRows', 'updatedCells', 'url']),
  },
  {
    name: 'sheets.delete_rows',
    service: 'sheets',
    sideEffect: 'write',
    riskLevel: 'medium',
    description: 'Sau khi duyệt, xoá 1–20 dòng dữ liệu khỏi tab bảng tính (xác định qua mảng rowNumbers từ dòng 2 trở đi hoặc cặp matchColumn + matchValue); luôn bảo vệ dòng tiêu đề số 1.',
    inputSchema: input({
      spreadsheetId,
      sheet: { type: 'string', minLength: 1, maxLength: 100, 'x-resource': 'sheet', 'x-resource-field': 'title' },
      rowNumbers: {
        type: 'array',
        minItems: 1,
        maxItems: 20,
        items: { type: 'integer', minimum: 2, maximum: 500 },
      },
      matchColumn: { type: 'string', minLength: 1, maxLength: 100 },
      matchValue: { type: 'string', minLength: 1, maxLength: 500 },
    }, ['spreadsheetId', 'sheet']),
    outputSchema: output({
      spreadsheetId: str,
      sheet: str,
      deletedRows: { type: 'integer' },
      deletedRowNumbers: { type: 'array', items: { type: 'integer' } },
      url: str,
    }, ['spreadsheetId', 'sheet', 'deletedRows', 'deletedRowNumbers', 'url']),
  },
  {
    name: 'sheets.create_sheet',
    service: 'sheets',
    sideEffect: 'write',
    riskLevel: 'low',
    description: 'Sau khi duyệt, tạo một tab (sheet) mới trong bảng tính, có thể khởi tạo luôn dòng tiêu đề cột (headers) ở dòng 1.',
    inputSchema: input({
      spreadsheetId,
      title: { type: 'string', minLength: 1, maxLength: 100 },
      headers: {
        type: 'array',
        minItems: 1,
        maxItems: 20,
        items: { type: 'string', minLength: 1, maxLength: 200 },
      },
    }, ['spreadsheetId', 'title']),
    outputSchema: output({
      id: { type: 'integer' },
      title: str,
      spreadsheetId: str,
      headers: { type: 'array', items: str },
      url: str,
    }, ['id', 'title', 'spreadsheetId', 'url']),
  },
];
