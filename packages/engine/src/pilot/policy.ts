export type PilotPolicy = {
  enabled: boolean;
  principals: readonly string[];
  spreadsheetId: string;
  tabId: string;
  boardId: string;
};

export type ResourceTarget =
  | { kind: 'source'; spreadsheetId: string; tabId: string }
  | { kind: 'board'; boardId: string };

export function assertPilotAccess(
  p: PilotPolicy,
  principalId: string,
  t: ResourceTarget,
): void {
  const allowed =
    t.kind === 'source'
      ? t.spreadsheetId === p.spreadsheetId && t.tabId === p.tabId
      : t.boardId === p.boardId;
  if (!p.enabled || !principalId || !p.principals.includes(principalId) || !allowed) {
    throw new Error('ACCESS_DENIED');
  }
}
