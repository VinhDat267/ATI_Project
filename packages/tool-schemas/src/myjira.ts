import { JIRA_PROJECT_PATTERN, JIRA_ISSUE_PATTERN } from './jira.js';
import type { ToolDefinition } from './types.js';

export const JIRA_SITE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
export const JIRA_CLOUD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const MYJIRA_SCOPES = [
  'offline_access',
  'read:me',
  'read:jira-work',
  'write:jira-work',
] as const;

export const MYJIRA_TOOLS: ToolDefinition[] = [
  {
    name: 'myjira.list_sites',
    service: 'myjira',
    description: 'Đọc danh mục Jira site trong workspace đã qua xác minh policy và quyền cá nhân',
    sideEffect: 'read',
    riskLevel: 'low',
    discovers: 'jira_site',
    listable: true,
    observedFields: ['id', 'siteId', 'cloudId', 'name', 'url'],
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: {
          type: 'string',
          maxLength: 2000,
          description: 'Chuỗi tìm kiếm site theo tên hoặc url',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 10,
          default: 10,
          description: 'Số lượng site tối đa trả về (1-10)',
        },
      },
    },
    outputSchema: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'siteId', 'cloudId', 'name', 'url'],
        properties: {
          id: {
            type: 'string',
            description: 'Alias của siteId phục vụ compaction và observation trong planner/executor',
          },
          siteId: { type: 'string' },
          cloudId: { type: 'string' },
          name: { type: 'string' },
          url: { type: 'string' },
        },
      },
    },
  },
  {
    name: 'myjira.search_projects',
    service: 'myjira',
    description: 'Tìm project trong Jira site đã qua xác minh policy',
    sideEffect: 'read',
    riskLevel: 'low',
    discovers: 'jira_project',
    listable: true,
    observedFields: ['id', 'key', 'name', 'siteId'],
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['siteId', 'query'],
      properties: {
        siteId: {
          type: 'string',
          pattern: JIRA_SITE_ID_PATTERN.source,
          description: 'Opaque handle của Jira site trong workspace',
          'x-resource': 'jira_site',
          'x-resource-field': 'siteId',
        },
        query: {
          type: 'string',
          maxLength: 2000,
          description: 'Chuỗi tìm kiếm project theo key hoặc name',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 20,
          default: 20,
          description: 'Số lượng project tối đa trả về (1-20)',
        },
      },
    },
    outputSchema: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['siteId', 'id', 'key', 'name'],
        properties: {
          siteId: { type: 'string' },
          id: { type: 'string' },
          key: { type: 'string' },
          name: { type: 'string' },
        },
      },
    },
  },
  {
    name: 'myjira.search_issues',
    service: 'myjira',
    description: 'Tìm issue trong Jira site và project cụ thể',
    sideEffect: 'read',
    riskLevel: 'low',
    discovers: 'jira_issue',
    listable: false,
    observedFields: ['id', 'key', 'title', 'url', 'status', 'siteId'],
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['siteId', 'projectKey'],
      properties: {
        siteId: {
          type: 'string',
          pattern: JIRA_SITE_ID_PATTERN.source,
          description: 'Opaque handle của Jira site trong workspace',
          'x-resource': 'jira_site',
          'x-resource-field': 'siteId',
        },
        projectKey: {
          type: 'string',
          pattern: JIRA_PROJECT_PATTERN.source,
          description: 'Key của Jira project',
          'x-resource': 'jira_project',
          'x-resource-field': 'key',
        },
        query: {
          type: 'string',
          maxLength: 2000,
          description: 'Chuỗi tìm kiếm văn bản trong issue',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 20,
          default: 20,
          description: 'Số lượng issue tối đa trả về (1-20)',
        },
      },
    },
    outputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['issues'],
      properties: {
        issues: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['siteId', 'id', 'key', 'url', 'title', 'status'],
            properties: {
              siteId: { type: 'string' },
              id: { type: 'string' },
              key: { type: 'string' },
              url: { type: 'string' },
              title: { type: 'string' },
              status: { type: 'string' },
            },
          },
        },
      },
    },
  },
  {
    name: 'myjira.create_issue',
    service: 'myjira',
    description: 'Tạo issue mới trong Jira project',
    sideEffect: 'write',
    riskLevel: 'medium',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['siteId', 'projectKey', 'summary'],
      properties: {
        siteId: {
          type: 'string',
          pattern: JIRA_SITE_ID_PATTERN.source,
          description: 'Opaque handle của Jira site trong workspace',
          'x-resource': 'jira_site',
          'x-resource-field': 'siteId',
        },
        projectKey: {
          type: 'string',
          pattern: JIRA_PROJECT_PATTERN.source,
          description: 'Key của Jira project',
          'x-resource': 'jira_project',
          'x-resource-field': 'key',
        },
        summary: {
          type: 'string',
          minLength: 1,
          maxLength: 255,
          description: 'Tiêu đề tóm tắt issue',
        },
        description: {
          type: 'string',
          maxLength: 4000,
          description: 'Mô tả chi tiết issue',
        },
        issueType: {
          type: 'string',
          minLength: 1,
          maxLength: 255,
          description: 'Loại issue (ví dụ: Task, Bug)',
        },
      },
    },
    outputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['siteId', 'id', 'key', 'url'],
      properties: {
        siteId: { type: 'string' },
        id: { type: 'string' },
        key: { type: 'string' },
        url: { type: 'string' },
      },
    },
  },
  {
    name: 'myjira.add_comment',
    service: 'myjira',
    description: 'Thêm bình luận văn bản thuần vào issue trong Jira',
    sideEffect: 'write',
    riskLevel: 'medium',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['siteId', 'issueKey', 'body'],
      properties: {
        siteId: {
          type: 'string',
          pattern: JIRA_SITE_ID_PATTERN.source,
          description: 'Opaque handle của Jira site trong workspace',
          'x-resource': 'jira_site',
          'x-resource-field': 'siteId',
        },
        issueKey: {
          type: 'string',
          pattern: JIRA_ISSUE_PATTERN.source,
          description: 'Key của Jira issue',
          'x-resource': 'jira_issue',
          'x-resource-field': 'key',
        },
        body: {
          type: 'string',
          minLength: 1,
          maxLength: 4000,
          description: 'Nội dung bình luận',
        },
      },
    },
    outputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['siteId', 'id', 'issueKey', 'url'],
      properties: {
        siteId: { type: 'string' },
        id: { type: 'string' },
        issueKey: { type: 'string' },
        url: { type: 'string' },
      },
    },
  },
];
