import type { ToolDefinition } from './types.js';
import { TRELLO_TOOLS } from './trello.js';
import { SLACK_TOOLS } from './slack.js';
import { GITHUB_TOOLS } from './github.js';
import { SHEETS_TOOLS } from './sheets.js';
import { CALENDAR_TOOLS } from './calendar.js';
import { NOTION_TOOLS } from './notion.js';
import { TELEGRAM_TOOLS } from './telegram.js';
import { JIRA_TOOLS } from './jira.js';

export * from './types.js';
export * from './trello.js';
export * from './slack.js';
export * from './github.js';
export * from './sheets.js';
export * from './calendar.js';
export * from './notion.js';
export * from './telegram.js';
export * from './jira.js';
// Gmail, MyCalendar, and MySheets are opt-in per user and personal connections, so they stay out of ALL_TOOLS and SERVICE_REGISTRY.
export * from './gmail.js';
export * from './mycalendar.js';
export * from './mysheets.js';
export * from './myslack-context.js';
export * from './myslack-policy.js';
export * from './myslack-connection.js';
export * from './myslack-source.js';
export * from './registry/index.js';
export * from './registry/gmail.js';
export * from './registry/mycalendar.js';
export * from './registry/mysheets.js';

export const ALL_TOOLS: ToolDefinition[] = [...TRELLO_TOOLS, ...SLACK_TOOLS, ...GITHUB_TOOLS, ...SHEETS_TOOLS, ...CALENDAR_TOOLS, ...NOTION_TOOLS, ...TELEGRAM_TOOLS, ...JIRA_TOOLS];

export const TOOL_MAP: Record<string, ToolDefinition> = Object.fromEntries(
  ALL_TOOLS.map((tool) => [tool.name, tool])
);

export function getToolDefinition(name: string): ToolDefinition | undefined {
  return TOOL_MAP[name];
}
