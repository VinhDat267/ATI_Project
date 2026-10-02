import type { ServiceDefinition } from '../types.js';

export const SLACK_SERVICE: ServiceDefinition = {
    id: 'slack', name: 'Slack', description: 'Team messaging and notifications',
    scopes: ['chat:write', 'channels:read'], scopeKey: 'channels', scopeLabel: 'Channel ID',
    credentialFields: [{ key: 'botToken', label: 'Bot token', type: 'password' }],
    intentKeywords: ['slack', 'channel', 'channels', 'kênh', 'tin nhắn', 'message', 'notify', 'thông báo'],
    fallbackIntentKeywords: ['báo'],
    gatherRules: [{ entityKey: 'channel', tool: 'slack.search_channels', pattern: /(?:#|\b(?:channel|kênh)\s+)["']?([\p{L}\p{N}_-]+)["']?/iu }]
  };
