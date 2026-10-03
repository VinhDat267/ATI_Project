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
const page = output({ id: str, title: str, url: str, properties: { type: 'object', additionalProperties: str } }, ['id', 'title', 'url', 'properties']);

export const NOTION_TOOLS: ToolDefinition[] = [
  { name: 'notion.search_databases', service: 'notion', sideEffect: 'read', riskLevel: 'low', discovers: 'database', listable: true,
    description: 'Tìm database Notion trong allowlist theo tiêu đề, query rỗng để liệt kê tối đa 10 database.',
    inputSchema: input({ query: { ...str, maxLength: 2000 }, limit: { type: 'integer', minimum: 1, maximum: 10, default: 10 } }, ['query']),
    outputSchema: { type: 'array', items: output({ id: str, title: str, url: str }, ['id', 'title', 'url']) } },
  { name: 'notion.query_database', service: 'notion', sideEffect: 'read', riskLevel: 'low', discovers: 'page',
    description: 'Đọc tối đa 20 page từ database đã tìm thấy có đúng một data source; query tùy chọn lọc theo tiêu đề, properties là chuỗi thuần từ snapshot API có giới hạn. Relation/rollup chưa đầy đủ có [incomplete], kiểu chưa hỗ trợ có [unsupported], button có [unavailable]; files chỉ trả tên, không tải file hoặc mở rộng relation.',
    inputSchema: input({ databaseId: resource('database'), query: { ...str, maxLength: 2000 }, limit: { type: 'integer', minimum: 1, maximum: 20, default: 20 } }, ['databaseId']),
    outputSchema: output({ pages: { type: 'array', items: page } }, ['pages']) },
  { name: 'notion.create_page', service: 'notion', sideEffect: 'write', riskLevel: 'medium',
    description: 'Sau khi duyệt, tạo page trong database có đúng một data source; title tối đa 200 ký tự, content thuần tối đa 4000; properties chỉ rich_text/select/date/url/number theo schema.',
    inputSchema: input({ databaseId: resource('database'), title: { ...str, minLength: 1, maxLength: 200 }, content: { ...str, maxLength: 4000 },
      properties: { type: 'object', maxProperties: 100, additionalProperties: { ...str, maxLength: 2000 } } }, ['databaseId', 'title']),
    outputSchema: output({ id: str, url: str }, ['id', 'url']) },
  { name: 'notion.append_text', service: 'notion', sideEffect: 'write', riskLevel: 'medium',
    description: 'Sau khi duyệt, nối tối đa 2000 ký tự văn bản thuần vào page đã tìm thấy; chỉ ghi sau khi kiểm database cha thuộc allowlist.',
    inputSchema: input({ pageId: resource('page'), text: { ...str, minLength: 1, maxLength: 2000 } }, ['pageId', 'text']),
    outputSchema: output({ pageId: str, blockIds: { type: 'array', items: str }, url: str }, ['pageId', 'blockIds', 'url']) },
];
