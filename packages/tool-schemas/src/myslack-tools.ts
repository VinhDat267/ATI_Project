import type { JSONSchema } from './types.js';
import { validateSlackBinding, type SlackBinding } from './myslack-context.js';

export type SlackMethodFamily =
  | 'admin'
  | 'agents'
  | 'api'
  | 'apps'
  | 'assistant'
  | 'auth'
  | 'blocks'
  | 'bookmarks'
  | 'bots'
  | 'calls'
  | 'canvases'
  | 'chat'
  | 'conversations'
  | 'dialog'
  | 'dnd'
  | 'emoji'
  | 'entity'
  | 'files'
  | 'functions'
  | 'migration'
  | 'oauth'
  | 'openid'
  | 'pins'
  | 'reactions'
  | 'reminders'
  | 'rtm'
  | 'search'
  | 'slackLists'
  | 'slackbot'
  | 'stars'
  | 'team'
  | 'tooling'
  | 'usergroups'
  | 'users'
  | 'views'
  | 'workflows';

export const SLACK_METHOD_FAMILIES: readonly SlackMethodFamily[] = [
  'admin',
  'agents',
  'api',
  'apps',
  'assistant',
  'auth',
  'blocks',
  'bookmarks',
  'bots',
  'calls',
  'canvases',
  'chat',
  'conversations',
  'dialog',
  'dnd',
  'emoji',
  'entity',
  'files',
  'functions',
  'migration',
  'oauth',
  'openid',
  'pins',
  'reactions',
  'reminders',
  'rtm',
  'search',
  'slackLists',
  'slackbot',
  'stars',
  'team',
  'tooling',
  'usergroups',
  'users',
  'views',
  'workflows',
] as const;

export type SlackSideEffect = 'read' | 'write';
export type SlackRiskLevel = 'low' | 'medium' | 'high';
export type SlackPlanTier = 'free' | 'pro' | 'any';

export interface SlackToolMetadata {
  method: string;
  family: SlackMethodFamily;
  sideEffect: SlackSideEffect;
  riskLevel: SlackRiskLevel;
  userScopes: string[] | null;
  hasUnknownScopes: boolean;
  planTier: SlackPlanTier;
  isProbeRequired: boolean;
  discovers?: string;
  listable?: boolean;
  requiresBinding: true;
}

export interface SlackToolDefinition extends SlackToolMetadata {
  name: string;
  service: 'myslack';
  description: string;
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
}

export function validateSlackToolDefinition(input: unknown): SlackToolDefinition {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Invalid Slack tool definition: must be an object');
  }
  const record = input as Record<string, unknown>;

  if (
    !Object.hasOwn(record, 'name') ||
    typeof record.name !== 'string' ||
    !record.name.startsWith('myslack.') ||
    !record.name.trim()
  ) {
    throw new TypeError('Invalid Slack tool definition name: must start with "myslack."');
  }

  if (record.service !== 'myslack') {
    throw new TypeError('Slack tool definition service must be "myslack"');
  }

  if (!Object.hasOwn(record, 'method') || typeof record.method !== 'string' || !record.method.trim()) {
    throw new TypeError('Invalid Slack tool definition method');
  }

  if (
    !Object.hasOwn(record, 'family') ||
    typeof record.family !== 'string' ||
    !SLACK_METHOD_FAMILIES.includes(record.family as SlackMethodFamily)
  ) {
    throw new TypeError('Invalid Slack tool definition family');
  }

  if (record.sideEffect !== 'read' && record.sideEffect !== 'write') {
    throw new TypeError('Invalid Slack tool definition sideEffect');
  }

  if (record.riskLevel !== 'low' && record.riskLevel !== 'medium' && record.riskLevel !== 'high') {
    throw new TypeError('Invalid Slack tool definition riskLevel');
  }

  if (record.planTier !== 'free' && record.planTier !== 'pro' && record.planTier !== 'any') {
    throw new TypeError('Invalid Slack tool definition planTier');
  }

  if (typeof record.hasUnknownScopes !== 'boolean') {
    throw new TypeError('Invalid Slack tool definition hasUnknownScopes: must be a boolean');
  }

  let userScopes: string[] | null = null;
  if (record.userScopes === null) {
    if (!record.hasUnknownScopes) {
      throw new TypeError('userScopes null requires hasUnknownScopes === true');
    }
    userScopes = null;
  } else if (Array.isArray(record.userScopes)) {
    if (!record.userScopes.every(s => typeof s === 'string' && s.trim())) {
      throw new TypeError('Invalid userScopes: all scopes must be non-empty strings');
    }
    userScopes = [...record.userScopes];
  } else {
    throw new TypeError('Invalid userScopes: must be string[] or null');
  }

  if (typeof record.isProbeRequired !== 'boolean') {
    throw new TypeError('Invalid Slack tool definition isProbeRequired: must be a boolean');
  }

  if (record.requiresBinding !== true) {
    throw new TypeError('Slack tool definition must require binding: requiresBinding === true');
  }

  if (!record.inputSchema || typeof record.inputSchema !== 'object' || Array.isArray(record.inputSchema)) {
    throw new TypeError('Invalid Slack tool definition inputSchema');
  }

  if (!record.outputSchema || typeof record.outputSchema !== 'object' || Array.isArray(record.outputSchema)) {
    throw new TypeError('Invalid Slack tool definition outputSchema');
  }

  return {
    name: record.name.trim(),
    service: 'myslack',
    description: typeof record.description === 'string' ? record.description.trim() : '',
    method: record.method.trim(),
    family: record.family as SlackMethodFamily,
    sideEffect: record.sideEffect,
    riskLevel: record.riskLevel,
    userScopes,
    hasUnknownScopes: record.hasUnknownScopes,
    planTier: record.planTier,
    isProbeRequired: record.isProbeRequired,
    requiresBinding: true,
    inputSchema: record.inputSchema as JSONSchema,
    outputSchema: record.outputSchema as JSONSchema,
    ...(typeof record.discovers === 'string' ? { discovers: record.discovers } : {}),
    ...(typeof record.listable === 'boolean' ? { listable: record.listable } : {}),
  };
}

export const MYSLACK_CONVERSATIONS_HISTORY_TOOL: SlackToolDefinition = {
  name: 'myslack.conversations_history',
  service: 'myslack',
  description: 'Fetches conversation history for a public, private, or direct message channel.',
  method: 'conversations.history',
  family: 'conversations',
  sideEffect: 'read',
  riskLevel: 'low',
  userScopes: ['channels:history', 'groups:history', 'im:history', 'mpim:history'],
  hasUnknownScopes: false,
  planTier: 'any',
  isProbeRequired: true,
  requiresBinding: true,
  inputSchema: {
    type: 'object',
    properties: {
      binding: { type: 'object', description: 'Verified Slack identity binding' },
      channel: { type: 'string', description: 'Channel ID to fetch history for' },
      cursor: { type: 'string', description: 'Pagination cursor' },
      limit: { type: 'integer', minimum: 1, maximum: 1000, description: 'Number of messages' },
      latest: { type: 'string', description: 'End of time range of messages to include' },
      oldest: { type: 'string', description: 'Start of time range of messages to include' },
      inclusive: { type: 'boolean', description: 'Include messages with latest or oldest timestamp' },
    },
    required: ['binding', 'channel'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      messages: { type: 'array' },
      hasMore: { type: 'boolean' },
      nextCursor: { type: 'string' },
    },
    required: ['messages'],
  },
};

export const MYSLACK_CONVERSATIONS_LIST_TOOL: SlackToolDefinition = {
  name: 'myslack.conversations_list',
  service: 'myslack',
  description: 'Lists conversations in a Slack workspace accessible by the connected user.',
  method: 'conversations.list',
  family: 'conversations',
  sideEffect: 'read',
  riskLevel: 'low',
  userScopes: ['channels:read', 'groups:read', 'im:read', 'mpim:read'],
  hasUnknownScopes: false,
  planTier: 'any',
  isProbeRequired: true,
  listable: true,
  requiresBinding: true,
  inputSchema: {
    type: 'object',
    properties: {
      binding: { type: 'object', description: 'Verified Slack identity binding' },
      cursor: { type: 'string', description: 'Pagination cursor' },
      limit: { type: 'integer', minimum: 1, maximum: 1000, description: 'Number of channels' },
      types: { type: 'string', description: 'Comma-separated channel types' },
      exclude_archived: { type: 'boolean', description: 'Exclude archived channels' },
    },
    required: ['binding'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      channels: { type: 'array' },
      nextCursor: { type: 'string' },
    },
    required: ['channels'],
  },
};

export const MYSLACK_CHAT_POST_MESSAGE_TOOL: SlackToolDefinition = {
  name: 'myslack.chat_postMessage',
  service: 'myslack',
  description: 'Sends a message to a channel under the connected user authorization.',
  method: 'chat.postMessage',
  family: 'chat',
  sideEffect: 'write',
  riskLevel: 'high',
  userScopes: ['chat:write'],
  hasUnknownScopes: false,
  planTier: 'any',
  isProbeRequired: true,
  requiresBinding: true,
  inputSchema: {
    type: 'object',
    properties: {
      binding: { type: 'object', description: 'Verified Slack identity binding' },
      channel: { type: 'string', description: 'Channel ID to post to' },
      text: { type: 'string', description: 'Message text' },
      thread_ts: { type: 'string', description: 'Parent message ts for thread reply' },
    },
    required: ['binding', 'channel', 'text'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      ok: { type: 'boolean' },
      channel: { type: 'string' },
      ts: { type: 'string' },
    },
    required: ['ok', 'channel', 'ts'],
  },
};

export const MYSLACK_USERS_INFO_TOOL: SlackToolDefinition = {
  name: 'myslack.users_info',
  service: 'myslack',
  description: 'Gets information about a Slack user.',
  method: 'users.info',
  family: 'users',
  sideEffect: 'read',
  riskLevel: 'low',
  userScopes: ['users:read'],
  hasUnknownScopes: false,
  planTier: 'any',
  isProbeRequired: true,
  requiresBinding: true,
  inputSchema: {
    type: 'object',
    properties: {
      binding: { type: 'object', description: 'Verified Slack identity binding' },
      user: { type: 'string', description: 'User ID to look up' },
      include_locale: { type: 'boolean', description: 'Include user locale' },
    },
    required: ['binding', 'user'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      user: { type: 'object' },
    },
    required: ['user'],
  },
};

export const MYSLACK_SAMPLE_TOOLS: readonly SlackToolDefinition[] = [
  MYSLACK_CONVERSATIONS_HISTORY_TOOL,
  MYSLACK_CONVERSATIONS_LIST_TOOL,
  MYSLACK_CHAT_POST_MESSAGE_TOOL,
  MYSLACK_USERS_INFO_TOOL,
] as const;

export function validateSlackToolExecutionArgs<TParams = Record<string, unknown>>(
  tool: SlackToolDefinition,
  args: unknown
): { binding: SlackBinding; params: TParams } {
  const validTool = validateSlackToolDefinition(tool);

  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw new TypeError(`Invalid execution arguments for tool ${validTool.name}: must be an object`);
  }
  const record = args as Record<string, unknown>;

  if (!Object.hasOwn(record, 'binding')) {
    throw new TypeError(`Execution arguments for tool ${validTool.name} missing binding`);
  }
  const cleanBinding = validateSlackBinding(record.binding);

  let rawParams: Record<string, unknown> = {};
  if (Object.hasOwn(record, 'params') && record.params !== null && typeof record.params === 'object' && !Array.isArray(record.params)) {
    rawParams = { ...(record.params as Record<string, unknown>) };
  } else {
    for (const key of Object.keys(record)) {
      if (key !== 'binding') {
        rawParams[key] = record[key];
      }
    }
  }

  const allowedProperties = (validTool.inputSchema.properties ?? {}) as Record<string, any>;
  const cleanParams: Record<string, unknown> = {};

  // Fail-closed verification: reject any property not present in allowedProperties
  for (const key of Object.keys(rawParams)) {
    if (key === 'binding' || !Object.hasOwn(allowedProperties, key)) {
      throw new TypeError(`Unknown property "${key}" for tool ${validTool.name} (fail-closed)`);
    }

    const val = rawParams[key];
    if (val !== undefined && val !== null) {
      const propSchema = allowedProperties[key];
      if (propSchema) {
        if (propSchema.type === 'string') {
          if (typeof val !== 'string') {
            throw new TypeError(`Property "${key}" for tool ${validTool.name} must be a string`);
          }
          cleanParams[key] = val;
        } else if (propSchema.type === 'integer') {
          if (!Number.isSafeInteger(val)) {
            throw new TypeError(`Property "${key}" for tool ${validTool.name} must be an integer`);
          }
          if (propSchema.minimum !== undefined && (val as number) < propSchema.minimum) {
            throw new TypeError(`Property "${key}" for tool ${validTool.name} must be >= ${propSchema.minimum}`);
          }
          if (propSchema.maximum !== undefined && (val as number) > propSchema.maximum) {
            throw new TypeError(`Property "${key}" for tool ${validTool.name} must be <= ${propSchema.maximum}`);
          }
          cleanParams[key] = val;
        } else if (propSchema.type === 'boolean') {
          if (typeof val !== 'boolean') {
            throw new TypeError(`Property "${key}" for tool ${validTool.name} must be a boolean`);
          }
          cleanParams[key] = val;
        } else if (propSchema.type === 'number') {
          if (typeof val !== 'number' || !Number.isFinite(val)) {
            throw new TypeError(`Property "${key}" for tool ${validTool.name} must be a number`);
          }
          cleanParams[key] = val;
        } else {
          cleanParams[key] = val;
        }
      } else {
        cleanParams[key] = val;
      }
    }
  }

  // Check required parameters
  if (Array.isArray(validTool.inputSchema.required)) {
    for (const req of validTool.inputSchema.required) {
      if (req === 'binding') continue;
      if (!Object.hasOwn(cleanParams, req) || cleanParams[req] === undefined || cleanParams[req] === null) {
        throw new TypeError(`Missing required parameter "${req}" for tool ${validTool.name}`);
      }
    }
  }

  return {
    binding: cleanBinding,
    params: cleanParams as TParams,
  };
}
