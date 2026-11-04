import {
  type WorkflowContext,
  type WorkflowResourceDefaults,
  type PlanConnections,
  validateWorkflowContext,
} from '@wap/tool-schemas';

export function filterPermittedWorkflowDefaults(
  context: WorkflowContext,
  connections?: PlanConnections
): WorkflowContext {
  const { valid, value } = validateWorkflowContext(context);
  if (!valid || !value) {
    return {};
  }

  if (!value.resourceDefaults || !connections) {
    return {
      ...(value.templateId ? { templateId: value.templateId } : {}),
    };
  }

  const filteredDefaults: WorkflowResourceDefaults = {};
  const rawDefaults = value.resourceDefaults;

  // 1. GitHub: repo must be in allowed repos
  if (rawDefaults.github && connections.github) {
    const allowedRepos = connections.github.repos ?? [];
    if (allowedRepos.includes(rawDefaults.github.repo)) {
      filteredDefaults.github = rawDefaults.github;
    }
  }

  // 2. Trello: boardId must be in allowed boardIds
  if (rawDefaults.trello && connections.trello) {
    const allowedBoards = connections.trello.boardIds ?? [];
    if (allowedBoards.includes(rawDefaults.trello.boardId)) {
      filteredDefaults.trello = rawDefaults.trello;
    }
  }

  // 3. Slack: myslack connection must exist
  if (rawDefaults.slack && connections.myslack) {
    filteredDefaults.slack = rawDefaults.slack;
  }

  // 4. Jira: siteId must match connected site
  if (rawDefaults.myjira && connections.myjira) {
    const jiraConn = connections.myjira as any;
    const matchesSite =
      jiraConn.siteId === rawDefaults.myjira.siteId ||
      Object.values(jiraConn.siteSteps ?? {}).some((s: any) => s.siteId === rawDefaults.myjira?.siteId);
    if (matchesSite) {
      filteredDefaults.myjira = rawDefaults.myjira;
    }
  }

  // 5. Calendar: calendarId must be in allowedCalendars
  if (rawDefaults.mycalendar && connections.mycalendar) {
    const allowed = connections.mycalendar.allowedCalendars ?? [];
    if (allowed.includes(rawDefaults.mycalendar.calendarId) || rawDefaults.mycalendar.calendarId === 'primary') {
      filteredDefaults.mycalendar = rawDefaults.mycalendar;
    }
  }

  // 6. Sheets: spreadsheetId in allowedSpreadsheets or folderId for Docs
  if (rawDefaults.mysheets && connections.mysheets) {
    const allowed = connections.mysheets.allowedSpreadsheets ?? [];
    const sh = rawDefaults.mysheets;
    if (sh.spreadsheetId && allowed.includes(sh.spreadsheetId)) {
      filteredDefaults.mysheets = sh;
    } else if (sh.folderId) {
      filteredDefaults.mysheets = { folderId: sh.folderId };
    }
  }

  return {
    ...(value.templateId ? { templateId: value.templateId } : {}),
    ...(Object.keys(filteredDefaults).length > 0 ? { resourceDefaults: filteredDefaults } : {}),
  };
}
