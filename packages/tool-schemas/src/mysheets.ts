import type { ToolDefinition } from './types.js';

export const MYSHEETS_SCOPE = 'https://www.googleapis.com/auth/drive.file';

const spreadsheetId = { type: 'string', pattern: '^[A-Za-z0-9_-]{20,}$', 'x-resource': 'myspreadsheet' };
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
    observedFields: ['id', 'title', 'spreadsheetId', 'headers'],
    description: 'Liệt kê các tab của một bảng tính cá nhân đã tìm thấy (kèm tiêu đề các cột dòng 1 nếu có), lọc theo tên; query có thể rỗng.',
    inputSchema: input({ spreadsheetId, ...listInputs }, ['spreadsheetId', 'query']),
    outputSchema: {
      type: 'array',
      items: output(
        { id: { type: 'integer' }, title: str, spreadsheetId: str, headers: { type: 'array', items: str } },
        ['id', 'title', 'spreadsheetId']
      ),
    },
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
    name: 'mysheets.search_rows',
    service: 'mysheets',
    sideEffect: 'read',
    riskLevel: 'low',
    description: 'Tìm kiếm và lọc dòng trên toàn bộ tab (quét tới 500 dòng) theo từ khóa chung hoặc điều kiện cột (hỗ trợ chuỗi, số học gt/gte/lt/lte và ngày tháng, hoặc mảng filters đa cột); trả về số dòng thực tế (rowNumber) và bản ghi theo tên cột.',
    inputSchema: input({
      spreadsheetId,
      sheet: { type: 'string', minLength: 1, maxLength: 100, 'x-resource': 'mysheet', 'x-resource-field': 'title' },
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
    name: 'mysheets.aggregate_rows',
    service: 'mysheets',
    sideEffect: 'read',
    riskLevel: 'low',
    description: 'Thống kê và tổng hợp số liệu trên toàn bộ tab (quét tới 500 dòng): hỗ trợ lọc trước qua query/filters, gom nhóm theo cột (groupBy) và tính chính xác sum, avg, min, max, count cho các cột số tiền/số lượng.',
    inputSchema: input({
      spreadsheetId,
      sheet: { type: 'string', minLength: 1, maxLength: 100, 'x-resource': 'mysheet', 'x-resource-field': 'title' },
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
    name: 'mysheets.append_rows',
    service: 'mysheets',
    sideEffect: 'write',
    riskLevel: 'medium',
    description: 'Sau khi duyệt, thêm 1–20 dòng vào tab đã tìm thấy trong bảng tính cá nhân (chấp nhận mảng vị trí rows hoặc đối tượng theo tên cột records); tự động chống ghi trùng khi đồng bộ mã định danh hoặc bật deduplicate/keyColumn, đồng thời bảo vệ ô công thức.',
    inputSchema: input({
      spreadsheetId,
      sheet: { type: 'string', minLength: 1, maxLength: 100, 'x-resource': 'mysheet', 'x-resource-field': 'title' },
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
  {
    name: 'mysheets.update_rows',
    service: 'mysheets',
    sideEffect: 'write',
    riskLevel: 'medium',
    description: 'Sau khi duyệt, cập nhật có chọn lọc một hoặc nhiều cột theo tên cột (hoặc chữ cái cột) trên dòng hiện có (xác định qua rowNumber hoặc cặp matchColumn + matchValue); bảo toàn các cột khác và ô công thức.',
    inputSchema: input({
      spreadsheetId,
      sheet: { type: 'string', minLength: 1, maxLength: 100, 'x-resource': 'mysheet', 'x-resource-field': 'title' },
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
    name: 'mysheets.delete_rows',
    service: 'mysheets',
    sideEffect: 'write',
    riskLevel: 'medium',
    description: 'Sau khi duyệt, xoá 1–20 dòng dữ liệu khỏi tab bảng tính (xác định qua mảng rowNumbers từ dòng 2 trở đi hoặc cặp matchColumn + matchValue); luôn bảo vệ dòng tiêu đề số 1.',
    inputSchema: input({
      spreadsheetId,
      sheet: { type: 'string', minLength: 1, maxLength: 100, 'x-resource': 'mysheet', 'x-resource-field': 'title' },
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
    name: 'mysheets.create_sheet',
    service: 'mysheets',
    sideEffect: 'write',
    riskLevel: 'low',
    description: 'Sau khi duyệt, tạo một tab (sheet) mới trong bảng tính cá nhân, có thể khởi tạo luôn dòng tiêu đề cột (headers) ở dòng 1.',
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
  {
    name: 'mysheets.list_drive_files',
    service: 'mysheets',
    sideEffect: 'read',
    riskLevel: 'low',
    discovers: 'mydrive_file',
    listable: true,
    observedFields: ['id', 'title', 'mimeType', 'url'],
    description: 'Liệt kê hoặc tìm kiếm các tài liệu Google Docs, bảng tính Google Sheets và thư mục (Folders) trên Google Drive của bạn được cấp quyền qua drive.file; lọc theo từ khóa tên (query) hoặc loại tệp (mimeType: "document" | "spreadsheet" | "folder" | "all").',
    inputSchema: input({
      query: { type: 'string', maxLength: 200 },
      mimeType: { type: 'string', enum: ['document', 'spreadsheet', 'folder', 'all'] },
      limit: { type: 'integer', minimum: 1, maximum: 20, default: 10 },
    }, ['query']),
    outputSchema: {
      type: 'array',
      items: output({
        id: str,
        title: str,
        mimeType: str,
        url: str,
      }, ['id', 'title', 'mimeType', 'url']),
    },
  },
  {
    name: 'mysheets.create_drive_folder',
    service: 'mysheets',
    sideEffect: 'write',
    riskLevel: 'low',
    description: 'Sau khi duyệt, tạo một thư mục (folder) mới trên Google Drive của bạn để lưu trữ tài liệu dự án, biên bản họp hoặc báo cáo (tùy chọn đặt bên trong parentFolderId).',
    inputSchema: input({
      name: { type: 'string', minLength: 1, maxLength: 200 },
      parentFolderId: { type: 'string', pattern: '^[A-Za-z0-9_-]{10,128}$', 'x-resource': 'mydrive_file' },
    }, ['name']),
    outputSchema: output({
      id: str,
      title: str,
      mimeType: str,
      url: str,
    }, ['id', 'title', 'url']),
  },
  {
    name: 'mysheets.create_doc',
    service: 'mysheets',
    sideEffect: 'write',
    riskLevel: 'medium',
    description: 'Sau khi duyệt, tạo một tài liệu Google Docs mới có tiêu đề (title) và nội dung văn bản chi tiết (content: biên bản họp, báo cáo, đề xuất, PRD), tùy chọn lưu trực tiếp vào một thư mục Google Drive (folderId). Trả về id và url tài liệu Google Docs.',
    inputSchema: input({
      title: { type: 'string', minLength: 1, maxLength: 200 },
      content: { type: 'string', maxLength: 12000 },
      folderId: { type: 'string', pattern: '^[A-Za-z0-9_-]{10,128}$', 'x-resource': 'mydrive_file' },
    }, ['title']),
    outputSchema: output({
      id: str,
      title: str,
      url: str,
      folderId: str,
    }, ['id', 'title', 'url']),
  },
  {
    name: 'mysheets.get_doc',
    service: 'mysheets',
    sideEffect: 'read',
    riskLevel: 'low',
    discovers: 'mydrive_file',
    observedFields: ['id', 'title', 'content', 'url'],
    description: 'Đọc tiêu đề và nội dung văn bản thuần (content, tối đa 12.000 ký tự) của một tài liệu Google Docs được cấp quyền theo documentId.',
    inputSchema: input({
      documentId: { type: 'string', pattern: '^[A-Za-z0-9_-]{10,128}$', 'x-resource': 'mydrive_file' },
    }, ['documentId']),
    outputSchema: output({
      id: str,
      title: str,
      content: str,
      url: str,
      truncated: { type: 'boolean' },
    }, ['id', 'title', 'content', 'url']),
  },
  {
    name: 'mysheets.append_doc_text',
    service: 'mysheets',
    sideEffect: 'write',
    riskLevel: 'medium',
    description: 'Sau khi duyệt, ghi nối thêm nội dung văn bản mới (text) vào cuối một tài liệu Google Docs hiện có (documentId) mà vẫn giữ nguyên nội dung cũ.',
    inputSchema: input({
      documentId: { type: 'string', pattern: '^[A-Za-z0-9_-]{10,128}$', 'x-resource': 'mydrive_file' },
      text: { type: 'string', minLength: 1, maxLength: 8000 },
    }, ['documentId', 'text']),
    outputSchema: output({
      id: str,
      title: str,
      url: str,
    }, ['id', 'title', 'url']),
  },
  {
    name: 'mysheets.move_drive_file',
    service: 'mysheets',
    sideEffect: 'write',
    riskLevel: 'low',
    description: 'Sau khi duyệt, di chuyển hoặc gắn một tệp Google Docs / Google Sheets (fileId) vào một thư mục Google Drive (folderId).',
    inputSchema: input({
      fileId: { type: 'string', pattern: '^[A-Za-z0-9_-]{10,128}$', 'x-resource': 'mydrive_file' },
      folderId: { type: 'string', pattern: '^[A-Za-z0-9_-]{10,128}$', 'x-resource': 'mydrive_file' },
    }, ['fileId', 'folderId']),
    outputSchema: output({
      id: str,
      folderId: str,
      url: str,
    }, ['id', 'folderId', 'url']),
  },
];
