import type { ToolDefinition } from './types.js';

export const JIRA_PROJECT_PATTERN = /^[A-Z][A-Z0-9_]{1,9}$/;
export const JIRA_ISSUE_PATTERN = /^[A-Z][A-Z0-9_]{1,9}-[1-9]\d*$/;
export const JIRA_SITE_PATTERN = /^https:\/\/[a-z0-9-]+\.atlassian\.net$/;
const str = { type: 'string' };
const object = (properties: object, required: string[]) => ({ type: 'object', properties, required, additionalProperties: false });
const projectKey = { ...str, pattern: JIRA_PROJECT_PATTERN.source, 'x-resource': 'project', 'x-resource-field': 'key' };
const identity = { id: str, key: str, url: str };
export const JIRA_TOOLS: ToolDefinition[] = [
  { name: 'jira.search_projects', service: 'jira', sideEffect: 'read', riskLevel: 'low', discovers: 'project', listable: true,
    description: 'Đọc tên các project Jira trong allowlist; query rỗng liệt kê tối đa 10 project, query khác lọc theo tên/key.',
    inputSchema: object({ query: { ...str, maxLength: 2000 }, limit: { type: 'integer', minimum: 1, maximum: 10, default: 10 } }, ['query']),
    outputSchema: { type: 'array', items: object({ key: str, id: str, name: str }, ['key', 'id', 'name']) } },
  { name: 'jira.search_issues', service: 'jira', sideEffect: 'read', riskLevel: 'low', discovers: 'jira_issue',
    description: 'Tìm tối đa 20 issue trong project đã tìm thấy. Adapter tự dựng JQL; không nhận JQL từ model. Query rỗng đọc các issue cập nhật gần nhất.',
    inputSchema: object({ projectKey, query: { ...str, maxLength: 2000 }, limit: { type: 'integer', minimum: 1, maximum: 20, default: 20 } }, ['projectKey']),
    outputSchema: object({ issues: { type: 'array', items: object({ ...identity, title: str, status: str }, ['id', 'key', 'url', 'title', 'status']) } }, ['issues']) },
  { name: 'jira.create_issue', service: 'jira', sideEffect: 'write', riskLevel: 'medium',
    description: 'Sau duyệt, tạo issue trong project đã tìm thấy; mô tả là văn bản thuần. Kiểm loại issue thuộc project; mặc định Task hoặc loại chuẩn đầu tiên.',
    inputSchema: object({ projectKey, summary: { ...str, minLength: 1, maxLength: 255 }, description: { ...str, maxLength: 4000 }, issueType: { ...str, minLength: 1, maxLength: 255 } }, ['projectKey', 'summary']),
    outputSchema: object(identity, ['id', 'key', 'url']) },
  { name: 'jira.add_comment', service: 'jira', sideEffect: 'write', riskLevel: 'medium',
    description: 'Sau duyệt, thêm comment văn bản thuần vào issue Jira đã tìm thấy; đọc lại project thật của issue trước khi ghi.',
    inputSchema: object({ issueKey: { ...str, pattern: JIRA_ISSUE_PATTERN.source, 'x-resource': 'jira_issue', 'x-resource-field': 'key' }, body: { ...str, minLength: 1, maxLength: 4000 } }, ['issueKey', 'body']),
    outputSchema: object({ id: str, issueKey: str, url: str }, ['id', 'issueKey', 'url']) },
];
