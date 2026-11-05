import type { WorkflowResourceDefaults } from '@wap/tool-schemas';

export const WORKFLOW_DEFAULTS_STORAGE_PREFIX = 'planora_defaults_v2';

export { type WorkflowResourceDefaults };

export function buildDefaultsKey(
  userId?: string | null,
  workspaceKey?: string | null
): string {
  const u = userId?.trim() || 'anonymous';
  const w = workspaceKey?.trim() || 'personal';
  return `${WORKFLOW_DEFAULTS_STORAGE_PREFIX}:${u}:${w}`;
}

export function sanitizeResourceDefaults(raw: unknown): WorkflowResourceDefaults | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const sanitized: WorkflowResourceDefaults = {};

  if (obj.github && typeof obj.github === 'object') {
    const g = obj.github as any;
    if (typeof g.repo === 'string' && g.repo.trim()) {
      sanitized.github = { repo: g.repo.trim() };
    }
  }

  if (obj.trello && typeof obj.trello === 'object') {
    const t = obj.trello as any;
    if (typeof t.boardId === 'string' && t.boardId.trim() && typeof t.listId === 'string' && t.listId.trim()) {
      sanitized.trello = { boardId: t.boardId.trim(), listId: t.listId.trim() };
    }
  }

  if (obj.slack && typeof obj.slack === 'object') {
    const s = obj.slack as any;
    if (typeof s.channelId === 'string' && s.channelId.trim()) {
      sanitized.slack = { channelId: s.channelId.trim() };
    }
  }

  if (obj.myjira && typeof obj.myjira === 'object') {
    const j = obj.myjira as any;
    if (typeof j.siteId === 'string' && j.siteId.trim() && typeof j.projectKey === 'string' && j.projectKey.trim()) {
      sanitized.myjira = { siteId: j.siteId.trim(), projectKey: j.projectKey.trim() };
    }
  }

  if (obj.mycalendar && typeof obj.mycalendar === 'object') {
    const c = obj.mycalendar as any;
    if (typeof c.calendarId === 'string' && c.calendarId.trim()) {
      sanitized.mycalendar = { calendarId: c.calendarId.trim() };
    }
  }

  if (obj.mysheets && typeof obj.mysheets === 'object') {
    const sh = obj.mysheets as any;
    const item: any = {};
    if (typeof sh.spreadsheetId === 'string' && sh.spreadsheetId.trim()) item.spreadsheetId = sh.spreadsheetId.trim();
    if (typeof sh.sheetName === 'string' && sh.sheetName.trim()) item.sheetName = sh.sheetName.trim();
    if (typeof sh.folderId === 'string' && sh.folderId.trim()) item.folderId = sh.folderId.trim();
    if (Object.keys(item).length > 0) sanitized.mysheets = item;
  }

  return Object.keys(sanitized).length > 0 ? sanitized : null;
}

export function loadWorkflowDefaults(
  userId?: string | null,
  workspaceKey?: string | null
): WorkflowResourceDefaults | null {
  try {
    if (typeof window === 'undefined') return null;
    const key = buildDefaultsKey(userId, workspaceKey);
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return sanitizeResourceDefaults(parsed);
  } catch {
    return null;
  }
}

export function saveWorkflowDefaults(
  userId: string | null | undefined,
  workspaceKey: string | null | undefined,
  defaults: WorkflowResourceDefaults
): boolean {
  try {
    if (typeof window === 'undefined') return false;
    const key = buildDefaultsKey(userId, workspaceKey);
    const sanitized = sanitizeResourceDefaults(defaults);
    if (!sanitized) {
      window.localStorage.removeItem(key);
      return true;
    }
    window.localStorage.setItem(key, JSON.stringify(sanitized));
    return true;
  } catch {
    return false;
  }
}

export function clearWorkflowDefaults(
  userId?: string | null,
  workspaceKey?: string | null
): void {
  try {
    if (typeof window === 'undefined') return;
    const key = buildDefaultsKey(userId, workspaceKey);
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}
