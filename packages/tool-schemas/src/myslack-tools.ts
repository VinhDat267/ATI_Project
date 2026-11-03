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
    inputSchema: structuredClone(record.inputSchema) as JSONSchema,
    outputSchema: structuredClone(record.outputSchema) as JSONSchema,
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

export const MYSLACK_CONVERSATIONS_INFO_TOOL: SlackToolDefinition = {
  name: 'myslack.conversations_info',
  service: 'myslack',
  description: 'Gets information about a conversation.',
  method: 'conversations.info',
  family: 'conversations',
  sideEffect: 'read',
  riskLevel: 'low',
  userScopes: ['channels:read', 'groups:read', 'im:read', 'mpim:read'],
  hasUnknownScopes: false,
  planTier: 'any',
  isProbeRequired: true,
  requiresBinding: true,
  inputSchema: {
    type: 'object',
    properties: {
      binding: { type: 'object', description: 'Verified Slack identity binding' },
      channel: { type: 'string', description: 'Channel ID to get info for' },
      include_locale: { type: 'boolean', description: 'Include channel locale' },
      include_num_members: { type: 'boolean', description: 'Include count of members' },
    },
    required: ['binding', 'channel'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      channel: { type: 'object' },
    },
    required: ['channel'],
  },
};

export const MYSLACK_CONVERSATIONS_REPLIES_TOOL: SlackToolDefinition = {
  name: 'myslack.conversations_replies',
  service: 'myslack',
  description: 'Fetches a thread of messages posted to a conversation.',
  method: 'conversations.replies',
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
      channel: { type: 'string', description: 'Channel ID of the conversation' },
      ts: { type: 'string', description: 'Unique identifier of a parent message (decimal timestamp)' },
      cursor: { type: 'string', description: 'Pagination cursor' },
      limit: { type: 'integer', minimum: 1, maximum: 1000, description: 'Number of messages to return' },
      latest: { type: 'string', description: 'End of time range of messages to include' },
      oldest: { type: 'string', description: 'Start of time range of messages to include' },
      inclusive: { type: 'boolean', description: 'Include messages with latest or oldest timestamp' },
    },
    required: ['binding', 'channel', 'ts'],
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

export const MYSLACK_CONVERSATIONS_MEMBERS_TOOL: SlackToolDefinition = {
  name: 'myslack.conversations_members',
  service: 'myslack',
  description: 'Lists members in a conversation.',
  method: 'conversations.members',
  family: 'conversations',
  sideEffect: 'read',
  riskLevel: 'low',
  userScopes: ['channels:read', 'groups:read', 'im:read', 'mpim:read'],
  hasUnknownScopes: false,
  planTier: 'any',
  isProbeRequired: true,
  requiresBinding: true,
  inputSchema: {
    type: 'object',
    properties: {
      binding: { type: 'object', description: 'Verified Slack identity binding' },
      channel: { type: 'string', description: 'Channel ID to list members for' },
      cursor: { type: 'string', description: 'Pagination cursor' },
      limit: { type: 'integer', minimum: 1, maximum: 1000, description: 'Number of members to return' },
    },
    required: ['binding', 'channel'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      members: { type: 'array', items: { type: 'string' } },
      nextCursor: { type: 'string' },
    },
    required: ['members'],
  },
};

export const MYSLACK_USERS_LIST_TOOL: SlackToolDefinition = {
  name: 'myslack.users_list',
  service: 'myslack',
  description: 'Lists users in a Slack workspace.',
  method: 'users.list',
  family: 'users',
  sideEffect: 'read',
  riskLevel: 'low',
  userScopes: ['users:read'],
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
      limit: { type: 'integer', minimum: 1, maximum: 1000, description: 'Number of users to return' },
      include_locale: { type: 'boolean', description: 'Include user locale' },
    },
    required: ['binding'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      members: { type: 'array' },
      nextCursor: { type: 'string' },
    },
    required: ['members'],
  },
};

export const MYSLACK_CHAT_GET_PERMALINK_TOOL: SlackToolDefinition = {
  name: 'myslack.chat_getPermalink',
  service: 'myslack',
  description: 'Gets a permanent URL for a message in a channel.',
  method: 'chat.getPermalink',
  family: 'chat',
  sideEffect: 'read',
  riskLevel: 'low',
  userScopes: null,
  hasUnknownScopes: true,
  planTier: 'any',
  isProbeRequired: true,
  requiresBinding: true,
  inputSchema: {
    type: 'object',
    properties: {
      binding: { type: 'object', description: 'Verified Slack identity binding' },
      channel: { type: 'string', description: 'Channel ID where the message was posted' },
      message_ts: { type: 'string', description: 'Timestamp of the message (decimal string)' },
    },
    required: ['binding', 'channel', 'message_ts'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      ok: { type: 'boolean' },
      channel: { type: 'string' },
      permalink: { type: 'string' },
    },
    required: ['ok', 'channel', 'permalink'],
  },
};

export const MYSLACK_CORE_READ_TOOLS: readonly SlackToolDefinition[] = [
  MYSLACK_CONVERSATIONS_LIST_TOOL,
  MYSLACK_CONVERSATIONS_INFO_TOOL,
  MYSLACK_CONVERSATIONS_HISTORY_TOOL,
  MYSLACK_CONVERSATIONS_REPLIES_TOOL,
  MYSLACK_CONVERSATIONS_MEMBERS_TOOL,
  MYSLACK_USERS_LIST_TOOL,
  MYSLACK_USERS_INFO_TOOL,
  MYSLACK_CHAT_GET_PERMALINK_TOOL,
] as const;

export const MYSLACK_SAMPLE_TOOLS: readonly SlackToolDefinition[] = [
  MYSLACK_CONVERSATIONS_HISTORY_TOOL,
  MYSLACK_CONVERSATIONS_LIST_TOOL,
  MYSLACK_CHAT_POST_MESSAGE_TOOL,
  MYSLACK_USERS_INFO_TOOL,
] as const;

export const MYSLACK_DECLARED_TOOLS: readonly SlackToolDefinition[] = [
  ...MYSLACK_CORE_READ_TOOLS,
  MYSLACK_CHAT_POST_MESSAGE_TOOL,
] as const;

function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    const val = (obj as any)[key];
    if (val !== null && typeof val === 'object' && !Object.isFrozen(val)) {
      deepFreeze(val);
    }
  }
  return obj;
}

const CANONICAL_SLACK_TOOL_MAP = new Map<string, SlackToolDefinition>(
  MYSLACK_DECLARED_TOOLS.map(t => [t.name, deepFreeze(structuredClone(t))])
);

function validateSchemaValue(
  schema: Record<string, any>,
  val: unknown,
  path: string,
  toolName: string
): unknown {
  if (val === undefined || val === null) {
    return val;
  }

  if (Array.isArray(schema.enum)) {
    if (!schema.enum.includes(val)) {
      throw new TypeError(`Value at "${path}" for tool ${toolName} must be one of [${schema.enum.join(', ')}]`);
    }
  }

  const expectedType = schema.type;
  if (!expectedType) {
    if (schema.properties) {
      return validateObjectSchema(schema, val, path, toolName);
    }
    return structuredClone(val);
  }

  switch (expectedType) {
    case 'string': {
      if (typeof val !== 'string') {
        throw new TypeError(`Property "${path}" for tool ${toolName} must be a string`);
      }
      return val;
    }
    case 'integer': {
      if (!Number.isSafeInteger(val)) {
        throw new TypeError(`Property "${path}" for tool ${toolName} must be an integer`);
      }
      if (schema.minimum !== undefined && (val as number) < schema.minimum) {
        throw new TypeError(`Property "${path}" for tool ${toolName} must be >= ${schema.minimum}`);
      }
      if (schema.maximum !== undefined && (val as number) > schema.maximum) {
        throw new TypeError(`Property "${path}" for tool ${toolName} must be <= ${schema.maximum}`);
      }
      return val;
    }
    case 'number': {
      if (typeof val !== 'number' || !Number.isFinite(val)) {
        throw new TypeError(`Property "${path}" for tool ${toolName} must be a number`);
      }
      if (schema.minimum !== undefined && (val as number) < schema.minimum) {
        throw new TypeError(`Property "${path}" for tool ${toolName} must be >= ${schema.minimum}`);
      }
      if (schema.maximum !== undefined && (val as number) > schema.maximum) {
        throw new TypeError(`Property "${path}" for tool ${toolName} must be <= ${schema.maximum}`);
      }
      return val;
    }
    case 'boolean': {
      if (typeof val !== 'boolean') {
        throw new TypeError(`Property "${path}" for tool ${toolName} must be a boolean`);
      }
      return val;
    }
    case 'object': {
      return validateObjectSchema(schema, val, path, toolName);
    }
    case 'array': {
      if (!Array.isArray(val)) {
        throw new TypeError(`Property "${path}" for tool ${toolName} must be an array`);
      }
      if (schema.items && typeof schema.items === 'object') {
        return val.map((item, idx) => validateSchemaValue(schema.items, item, `${path}[${idx}]`, toolName));
      }
      return val.map(item => structuredClone(item));
    }
    default:
      throw new TypeError(`Unsupported schema type "${expectedType}" at "${path}" for tool ${toolName}`);
  }
}

function validateObjectSchema(
  schema: Record<string, any>,
  val: unknown,
  path: string,
  toolName: string
): Record<string, unknown> {
  if (typeof val !== 'object' || val === null || Array.isArray(val)) {
    throw new TypeError(`Property "${path}" for tool ${toolName} must be an object`);
  }
  const obj = val as Record<string, unknown>;
  const allowedProps = (schema.properties ?? {}) as Record<string, any>;
  const cleanObj: Record<string, unknown> = {};

  if (schema.additionalProperties === false) {
    for (const key of Object.keys(obj)) {
      if (!Object.hasOwn(allowedProps, key)) {
        throw new TypeError(`Unknown property "${path ? `${path}.${key}` : key}" for tool ${toolName} (fail-closed)`);
      }
    }
  }

  for (const key of Object.keys(obj)) {
    if (Object.hasOwn(allowedProps, key)) {
      const propSchema = allowedProps[key];
      const propVal = obj[key];
      if (propVal !== undefined && propVal !== null) {
        cleanObj[key] = validateSchemaValue(propSchema, propVal, path ? `${path}.${key}` : key, toolName);
      }
    } else if (schema.additionalProperties !== false) {
      cleanObj[key] = structuredClone(obj[key]);
    }
  }

  if (Array.isArray(schema.required)) {
    for (const req of schema.required) {
      if (path === '' && req === 'binding') continue;
      if (!Object.hasOwn(obj, req) || obj[req] === undefined || obj[req] === null) {
        throw new TypeError(`Missing required property "${path ? `${path}.${req}` : req}" for tool ${toolName}`);
      }
    }
  }

  return cleanObj;
}

export function validateSlackToolExecutionArgs<TParams = Record<string, unknown>>(
  tool: SlackToolDefinition,
  args: unknown
): { binding: SlackBinding; params: TParams } {
  const validTool = validateSlackToolDefinition(tool);

  // Validate method name and family consistency
  const expectedName = 'myslack.' + validTool.method.replace(/\./g, '_');
  if (validTool.name !== expectedName) {
    throw new TypeError(`Tool method "${validTool.method}" does not match tool name "${validTool.name}"`);
  }
  const methodFamily = validTool.method.split('.')[0];
  if (validTool.family !== methodFamily || !SLACK_METHOD_FAMILIES.includes(methodFamily as SlackMethodFamily)) {
    throw new TypeError(`Tool method "${validTool.method}" family "${methodFamily}" is invalid or does not match declared family "${validTool.family}"`);
  }

  // Enforce declared executable tools registry
  const canonicalTool = CANONICAL_SLACK_TOOL_MAP.get(validTool.name);
  if (!canonicalTool || canonicalTool.method !== validTool.method) {
    throw new TypeError(`Tool method "${validTool.method}" is not a declared executable Slack tool`);
  }

  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw new TypeError(`Invalid execution arguments for tool ${canonicalTool.name}: must be an object`);
  }
  const record = args as Record<string, unknown>;

  if (!Object.hasOwn(record, 'binding')) {
    throw new TypeError(`Execution arguments for tool ${canonicalTool.name} missing binding`);
  }
  const cleanBinding = validateSlackBinding(record.binding);

  // Always use the canonical declared schema (detached copy) to prevent caller weakening
  const canonicalSchema = structuredClone(canonicalTool.inputSchema) as Record<string, any>;

  let rawParams: Record<string, unknown> = {};

  if (Object.hasOwn(record, 'params')) {
    // Nested envelope: fail closed if any unexpected outer properties are present
    for (const key of Object.keys(record)) {
      if (key !== 'binding' && key !== 'params') {
        throw new TypeError(`Unknown outer argument "${key}" for tool ${canonicalTool.name} (fail-closed)`);
      }
    }
    if (typeof record.params !== 'object' || record.params === null || Array.isArray(record.params)) {
      throw new TypeError(`Execution arguments params for tool ${canonicalTool.name} must be an object`);
    }
    rawParams = { ...(record.params as Record<string, unknown>) };
  } else {
    // Flat args: outer properties must match canonicalSchema
    const allowedOuter = (canonicalSchema.properties ?? {}) as Record<string, any>;
    if (canonicalSchema.additionalProperties === false) {
      for (const key of Object.keys(record)) {
        if (key !== 'binding' && !Object.hasOwn(allowedOuter, key)) {
          throw new TypeError(`Unknown property "${key}" for tool ${canonicalTool.name} (fail-closed)`);
        }
      }
    }
    for (const key of Object.keys(record)) {
      if (key !== 'binding') {
        rawParams[key] = record[key];
      }
    }
  }

  // Construct parameter schema without binding
  const paramsSchema: Record<string, any> = {
    type: 'object',
    properties: { ...canonicalSchema.properties },
    additionalProperties: canonicalSchema.additionalProperties,
    required: Array.isArray(canonicalSchema.required)
      ? canonicalSchema.required.filter((r: string) => r !== 'binding')
      : [],
  };
  delete paramsSchema.properties.binding;

  const cleanParams = validateObjectSchema(paramsSchema, rawParams, '', canonicalTool.name);

  return {
    binding: cleanBinding,
    params: cleanParams as TParams,
  };
}
