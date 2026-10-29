/** Server-owned identity for a particular authorization generation. Never contains credentials. */
export interface SlackBinding {
  atiUserId: string;
  connectionId: string;
  workspaceId: string;
  slackUserId: string;
  identityVersion: number;
}

export type SlackResourceType =
  | 'conversation'
  | 'message'
  | 'file'
  | 'canvas'
  | 'list'
  | 'list_item'
  | 'bookmark'
  | 'reminder'
  | 'user'
  | 'usergroup'
  | 'subteam';

export const SLACK_RESOURCE_TYPES: readonly SlackResourceType[] = [
  'conversation',
  'message',
  'file',
  'canvas',
  'list',
  'list_item',
  'bookmark',
  'reminder',
  'user',
  'usergroup',
  'subteam',
] as const;

export interface SlackSourceRef {
  binding: SlackBinding;
  resourceType: SlackResourceType;
  resourceId: string;
  revision: string;
}

const identityFields = ['atiUserId', 'connectionId', 'workspaceId', 'slackUserId'] as const;

export function validateSlackBinding(value: unknown): SlackBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid Slack binding');
  const record = value as Record<string, unknown>;
  for (const field of identityFields) {
    if (!Object.hasOwn(record, field) || typeof record[field] !== 'string' || !(record[field] as string).trim()) {
      throw new TypeError(`Invalid Slack binding ${field}`);
    }
  }
  if (!Object.hasOwn(record, 'identityVersion') || !Number.isSafeInteger(record.identityVersion) || (record.identityVersion as number) <= 0) {
    throw new TypeError('Invalid Slack identity version');
  }
  return {
    atiUserId: (record.atiUserId as string).trim(),
    connectionId: (record.connectionId as string).trim(),
    workspaceId: (record.workspaceId as string).trim(),
    slackUserId: (record.slackUserId as string).trim(),
    identityVersion: record.identityVersion as number,
  };
}

export function sameSlackBinding(a: SlackBinding, b: SlackBinding): boolean {
  return identityFields.every(field => a[field] === b[field]) && a.identityVersion === b.identityVersion;
}

export function validateSlackSourceRef(value: unknown): SlackSourceRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Invalid Slack source ref');
  }
  const record = value as Record<string, unknown>;

  if (!Object.hasOwn(record, 'binding')) {
    throw new TypeError('Slack source ref missing binding');
  }
  const cleanBinding = validateSlackBinding(record.binding);

  if (!Object.hasOwn(record, 'resourceType') || typeof record.resourceType !== 'string' || !SLACK_RESOURCE_TYPES.includes(record.resourceType as SlackResourceType)) {
    throw new TypeError('Invalid Slack source ref resourceType');
  }

  if (!Object.hasOwn(record, 'resourceId') || typeof record.resourceId !== 'string' || !record.resourceId.trim()) {
    throw new TypeError('Invalid Slack source ref resourceId');
  }

  if (!Object.hasOwn(record, 'revision') || typeof record.revision !== 'string' || !record.revision.trim()) {
    throw new TypeError('Invalid Slack source ref revision');
  }

  return {
    binding: cleanBinding,
    resourceType: record.resourceType as SlackResourceType,
    resourceId: record.resourceId.trim(),
    revision: record.revision.trim(),
  };
}

export function formatSlackGlobalResourceKey(workspaceId: string, resourceType: SlackResourceType, resourceId: string): string {
  if (typeof workspaceId !== 'string' || !workspaceId.trim()) {
    throw new TypeError('Invalid workspaceId for global resource key');
  }
  if (!SLACK_RESOURCE_TYPES.includes(resourceType)) {
    throw new TypeError('Invalid resourceType for global resource key');
  }
  if (typeof resourceId !== 'string' || !resourceId.trim()) {
    throw new TypeError('Invalid resourceId for global resource key');
  }
  return JSON.stringify([workspaceId.trim(), resourceType, resourceId.trim()]);
}

export function formatSlackOwnerSourceKey(ref: SlackSourceRef): string {
  const clean = validateSlackSourceRef(ref);
  return JSON.stringify([
    clean.binding.atiUserId,
    clean.binding.connectionId,
    clean.binding.workspaceId,
    clean.binding.slackUserId,
    clean.binding.identityVersion,
    clean.resourceType,
    clean.resourceId,
    clean.revision,
  ]);
}
