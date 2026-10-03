import type { ServiceDefinition } from '../types.js';
import { NOTION_ID_PATTERN, normalizeNotionId } from '../notion.js';

export const NOTION_SERVICE: ServiceDefinition = {
  id: 'notion', name: 'Notion', description: 'Đọc database, tạo page và nối văn bản trong database được cấp quyền',
  scopes: ['read_content', 'insert_content'], scopeKey: 'databases', scopeLabel: 'Database ID', scopePattern: NOTION_ID_PATTERN,
  normalizeScopeEntry: normalizeNotionId,
  credentialFields: [{ key: 'token', label: 'Internal integration token', type: 'password' }],
  intentKeywords: ['notion'], fallbackIntentKeywords: ['ghi chú', 'wiki', 'tài liệu'],
};
