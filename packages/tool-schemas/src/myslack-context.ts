/** Server-owned identity for a particular authorization generation. Never contains credentials. */
export interface SlackBinding {
  atiUserId: string;
  connectionId: string;
  workspaceId: string;
  slackUserId: string;
  identityVersion: number;
}

export interface SlackSourceRef {
  binding: SlackBinding;
  resourceType: 'conversation' | 'message' | 'file';
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
    atiUserId: record.atiUserId as string, connectionId: record.connectionId as string,
    workspaceId: record.workspaceId as string, slackUserId: record.slackUserId as string,
    identityVersion: record.identityVersion as number,
  };
}

export function sameSlackBinding(a: SlackBinding, b: SlackBinding): boolean {
  return identityFields.every(field => a[field] === b[field]) && a.identityVersion === b.identityVersion;
}
