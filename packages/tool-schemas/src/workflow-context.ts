/**
 * Workflow Context & Resource Defaults DTO (FLOW-04, F4)
 * Scoped defaults for 6 core jobs. Rejects arbitrary fields and recipient emails.
 */

export type CoreJobId = 'OFF-02' | 'OFF-03' | 'PM-01' | 'PM-03' | 'DEV-02' | 'DEV-04';

export interface WorkflowResourceDefaults {
  trello?: { boardId: string; listId: string };
  github?: { repo: string };
  slack?: { channelId: string };
  myjira?: { siteId: string; projectKey: string };
  mycalendar?: { calendarId: string };
  mysheets?: { spreadsheetId?: string; sheetName?: string; folderId?: string };
}

export interface WorkflowContext {
  templateId?: CoreJobId | string;
  resourceDefaults?: WorkflowResourceDefaults;
}

const ALLOWED_RESOURCE_GROUPS = new Set([
  'trello',
  'github',
  'slack',
  'myjira',
  'mycalendar',
  'mysheets',
]);

const ALLOWED_CONTEXT_FIELDS = new Set(['templateId', 'resourceDefaults']);

export function validateWorkflowContext(input: unknown): {
  valid: boolean;
  error?: string;
  value?: WorkflowContext;
} {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { valid: false, error: 'WorkflowContext must be an object' };
  }

  const obj = input as Record<string, unknown>;

  // Reject unexpected top-level fields (e.g. recipient emails or arbitrary injections)
  for (const key of Object.keys(obj)) {
    if (!ALLOWED_CONTEXT_FIELDS.has(key)) {
      return { valid: false, error: `Disallowed field in WorkflowContext: ${key}` };
    }
  }

  if (obj.templateId !== undefined && typeof obj.templateId !== 'string') {
    return { valid: false, error: 'templateId must be a string' };
  }

  if (obj.resourceDefaults !== undefined) {
    if (!obj.resourceDefaults || typeof obj.resourceDefaults !== 'object' || Array.isArray(obj.resourceDefaults)) {
      return { valid: false, error: 'resourceDefaults must be an object' };
    }

    const resDefaults = obj.resourceDefaults as Record<string, unknown>;

    for (const group of Object.keys(resDefaults)) {
      if (!ALLOWED_RESOURCE_GROUPS.has(group)) {
        return { valid: false, error: `Disallowed resource group in resourceDefaults: ${group}` };
      }
    }

    if (resDefaults.trello !== undefined) {
      const t = resDefaults.trello as any;
      if (!t || typeof t !== 'object' || typeof t.boardId !== 'string' || !t.boardId.trim() || typeof t.listId !== 'string' || !t.listId.trim()) {
        return { valid: false, error: 'trello default requires boardId and listId strings' };
      }
    }

    if (resDefaults.github !== undefined) {
      const g = resDefaults.github as any;
      if (!g || typeof g !== 'object' || typeof g.repo !== 'string' || !g.repo.trim()) {
        return { valid: false, error: 'github default requires repo string' };
      }
    }

    if (resDefaults.slack !== undefined) {
      const s = resDefaults.slack as any;
      if (!s || typeof s !== 'object' || typeof s.channelId !== 'string' || !s.channelId.trim()) {
        return { valid: false, error: 'slack default requires channelId string' };
      }
    }

    if (resDefaults.myjira !== undefined) {
      const j = resDefaults.myjira as any;
      if (!j || typeof j !== 'object' || typeof j.siteId !== 'string' || !j.siteId.trim() || typeof j.projectKey !== 'string' || !j.projectKey.trim()) {
        return { valid: false, error: 'myjira default requires siteId and projectKey strings' };
      }
    }

    if (resDefaults.mycalendar !== undefined) {
      const c = resDefaults.mycalendar as any;
      if (!c || typeof c !== 'object' || typeof c.calendarId !== 'string' || !c.calendarId.trim()) {
        return { valid: false, error: 'mycalendar default requires calendarId string' };
      }
    }

    if (resDefaults.mysheets !== undefined) {
      const sh = resDefaults.mysheets as any;
      if (!sh || typeof sh !== 'object') {
        return { valid: false, error: 'mysheets default must be an object' };
      }
      const hasField =
        (typeof sh.spreadsheetId === 'string' && sh.spreadsheetId.trim()) ||
        (typeof sh.sheetName === 'string' && sh.sheetName.trim()) ||
        (typeof sh.folderId === 'string' && sh.folderId.trim());
      if (!hasField) {
        return { valid: false, error: 'mysheets default requires at least one of spreadsheetId, sheetName, or folderId' };
      }
    }
  }

  return {
    valid: true,
    value: input as WorkflowContext,
  };
}
