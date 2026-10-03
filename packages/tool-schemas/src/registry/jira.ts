import type { ServiceDefinition } from '../types.js';
import { JIRA_PROJECT_PATTERN, JIRA_SITE_PATTERN } from '../jira.js';

export const JIRA_SERVICE: ServiceDefinition = {
  id: 'jira', name: 'Jira', description: 'Tìm project/issue, tạo issue và thêm comment trong project Jira Cloud được cấp quyền',
  scopes: ['read', 'write'], scopeKey: 'projects', scopeLabel: 'Project key', scopePattern: JIRA_PROJECT_PATTERN,
  credentialFields: [{ key: 'siteUrl', label: 'Site URL (https://ten-site.atlassian.net)', type: 'text', pattern: JIRA_SITE_PATTERN.source }, { key: 'email', label: 'Email Atlassian', type: 'text', pattern: '^[^\\s:@]+@[^\\s:@]+$' }, { key: 'apiToken', label: 'API token', type: 'password' }],
  intentKeywords: ['jira', 'ticket'],
};
