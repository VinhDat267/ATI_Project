import { createHash } from 'node:crypto';

export type SourceIdentity = {
  groupId: string;
  spreadsheetId: string;
  tabId: string;
  requestId: string;
};

function key(parts: string[]): string {
  if (parts.some((p) => !p || p !== p.trim())) {
    throw new Error('INVALID_ID');
  }
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

export function sourceKey(i: SourceIdentity): string {
  return key(['pilot-source-1', i.groupId, i.spreadsheetId, i.tabId, i.requestId]);
}

export function createIntentKey(i: SourceIdentity, boardId: string): string {
  return key(['pilot-create-1', sourceKey(i), boardId, 'create_card']);
}
