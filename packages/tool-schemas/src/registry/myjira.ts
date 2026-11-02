import type { ServiceDefinition } from '../types.js';
import { MYJIRA_SCOPES } from '../myjira.js';

export const MYJIRA_SERVICE: ServiceDefinition = {
  id: 'myjira',
  name: 'Jira',
  description: 'Tìm project/issue, tạo issue và thêm comment trong các Jira site được kết nối qua OAuth cá nhân và workspace của bạn',
  connection: 'personal',
  scopes: [...MYJIRA_SCOPES],
  scopeKey: 'sites',
  scopeLabel: 'Jira sites của bạn',
  credentialFields: [],
  intentKeywords: [
    'jira',
    'ticket',
    'jira của tôi',
    'jira cá nhân',
    'jira của mình',
    'jira riêng',
    'my jira',
    'my personal jira',
  ],
};
