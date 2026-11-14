import type { ToolDefinition } from './types.js';

export const NOTION_ID_PATTERN = /^(?:[a-fA-F0-9]{32}|[a-fA-F0-9]{8}-(?:[a-fA-F0-9]{4}-){3}[a-fA-F0-9]{12})$/;
export function normalizeNotionId(value: string): string {
  const id = value.trim().toLowerCase();
  if (!NOTION_ID_PATTERN.test(id)) return id;
  const hex = id.replaceAll('-', '');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
const str = { type: 'string' };
const resource = (name: string) => ({ ...str, pattern: NOTION_ID_PATTERN.source, 'x-resource': name });
const input = (properties: object, required: string[]) => ({ type: 'object', properties, required, additionalProperties: false });
const output = (properties: object, required: string[]) => ({ type: 'object', properties, required });
const page = output({ id: str, title: str, url: str, properties: { type: 'object', additionalProperties: str }, lastEditedTime: str }, ['id', 'title', 'url', 'properties']);
const schemaColumn = output({ name: str, type: str, options: { type: 'array', items: str } }, ['name', 'type']);
const pageBlock = output({ id: str, type: str, text: str, checked: { type: 'boolean' } }, ['id', 'type', 'text']);

export const NOTION_TOOLS: ToolDefinition[] = [
  { name: 'notion.search_databases', service: 'notion', sideEffect: 'read', riskLevel: 'low', discovers: 'database', listable: true,
    description: 'Tìm database Notion trong allowlist theo tiêu đề, query rỗng để liệt kê tối đa 10 database.',
    inputSchema: input({ query: { ...str, maxLength: 2000 }, limit: { type: 'integer', minimum: 1, maximum: 10, default: 10 } }, ['query']),
    outputSchema: { type: 'array', items: output({ id: str, title: str, url: str }, ['id', 'title', 'url']) } },
  { name: 'notion.query_database', service: 'notion', sideEffect: 'read', riskLevel: 'low', discovers: 'page',
    description: 'Đọc tối đa 20 page từ database đã tìm thấy có đúng một data source; query tùy chọn lọc theo tiêu đề hoặc trạng thái, status tùy chọn lọc theo cột Status/Select, dateOnOrAfter/dateOnOrBefore lọc theo cột Date; trả kèm schema các cột của database và properties phẳng.',
    inputSchema: input({ databaseId: resource('database'), query: { ...str, maxLength: 2000 }, status: { ...str, maxLength: 200 }, dateProperty: { type: 'string', maxLength: 200, description: 'Schema column name. Required for date filters when multiple date columns exist.' }, dateOnOrAfter: { ...str, maxLength: 64 }, dateOnOrBefore: { ...str, maxLength: 64 }, limit: { type: 'integer', minimum: 1, maximum: 20, default: 20 } }, ['databaseId']),
    outputSchema: output({ pages: { type: 'array', items: page }, schema: { type: 'array', items: schemaColumn }, truncated: { type: 'boolean' } }, ['pages']) },
  { name: 'notion.create_page', service: 'notion', sideEffect: 'write', riskLevel: 'medium',
    description: 'Sau khi duyệt, tạo page trong database có đúng một data source; title tối đa 200 ký tự, content thuần tối đa 4000; properties hỗ trợ rich_text/select/status/multi_select/checkbox/date/url/number theo schema.',
    inputSchema: input({ databaseId: resource('database'), title: { ...str, minLength: 1, maxLength: 200 }, content: { ...str, maxLength: 4000 },
      properties: { type: 'object', maxProperties: 100, additionalProperties: { ...str, maxLength: 2000 } } }, ['databaseId', 'title']),
    outputSchema: output({ id: str, url: str }, ['id', 'url']) },
  { name: 'notion.append_text', service: 'notion', sideEffect: 'write', riskLevel: 'medium',
    description: 'Sau khi duyệt, nối tối đa 2000 ký tự văn bản thuần vào page đã tìm thấy; chỉ ghi sau khi kiểm database cha thuộc allowlist.',
    inputSchema: input({ pageId: resource('page'), text: { ...str, minLength: 1, maxLength: 2000 } }, ['pageId', 'text']),
    outputSchema: output({ pageId: str, blockIds: { type: 'array', items: str }, url: str }, ['pageId', 'blockIds', 'url']) },
];

export const NOTION_OAUTH_TOOLS: ToolDefinition[] = [
  { name: 'notion.get_page', service: 'notion', sideEffect: 'read', riskLevel: 'low', discovers: 'page',
    description: 'Đọc chi tiết một trang Notion (tiêu đề, thuộc tính properties và toàn bộ nội dung văn bản content/blocks bên trong trang như tiêu đề mục, đoạn văn, danh sách, checklist to_do) thuộc database trong allowlist.',
    inputSchema: input({ pageId: resource('page') }, ['pageId']),
    outputSchema: output({ id: str, title: str, url: str, properties: { type: 'object', additionalProperties: str }, content: str, blocks: { type: 'array', items: pageBlock }, lastEditedTime: str, truncated: { type: 'boolean' } }, ['id', 'title', 'url', 'properties', 'content', 'blocks']) },
  { name: 'notion.update_page', service: 'notion', sideEffect: 'write', riskLevel: 'medium',
    description: 'Sau khi duyệt, cập nhật tiêu đề (title), các thuộc tính (properties: Status, Select, Multi-select, Checkbox, Date, Number, URL, Text) hoặc trạng thái lưu trữ (archived) của một trang Notion thuộc database trong allowlist.',
    inputSchema: input({ pageId: resource('page'), title: { ...str, minLength: 1, maxLength: 200 },
      properties: { type: 'object', maxProperties: 100, additionalProperties: { ...str, maxLength: 2000 } },
      archived: { type: 'boolean' } }, ['pageId']),
    outputSchema: output({ id: str, url: str, updatedProperties: { type: 'array', items: str }, archived: { type: 'boolean' } }, ['id', 'url']) },
];
