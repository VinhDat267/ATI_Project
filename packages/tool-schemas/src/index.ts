import type { ToolDefinition } from './types.js';
import { TRELLO_TOOLS, TRELLO_OAUTH_TOOLS } from './trello.js';
import { SLACK_TOOLS } from './slack.js';
import { GITHUB_TOOLS, GITHUB_OAUTH_TOOLS } from './github.js';
import { SHEETS_TOOLS, SHEETS_EXTENDED_TOOLS } from './sheets.js';
import { CALENDAR_TOOLS } from './calendar.js';
import { NOTION_TOOLS, NOTION_OAUTH_TOOLS } from './notion.js';
import { TELEGRAM_TOOLS, TELEGRAM_OAUTH_TOOLS } from './telegram.js';
import { JIRA_TOOLS } from './jira.js';
import { MYSHEETS_TOOLS } from './mysheets.js';

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
// Jira OAuth cá nhân and workspace contracts (opt-in personal connection, stays out of ALL_TOOLS and SERVICE_REGISTRY)
export * from './myjira.js';
export * from './myjira-context.js';
export * from './myjira-policy.js';
export * from './myjira-dto.js';
export * from './registry/index.js';
export * from './registry/gmail.js';
export * from './registry/mycalendar.js';
export * from './registry/mysheets.js';
export * from './registry/myjira.js';

export const ALL_TOOLS: ToolDefinition[] = [...TRELLO_TOOLS, ...SLACK_TOOLS, ...GITHUB_TOOLS, ...SHEETS_TOOLS, ...CALENDAR_TOOLS, ...NOTION_TOOLS, ...TELEGRAM_TOOLS, ...JIRA_TOOLS];

export const TOOL_MAP: Record<string, ToolDefinition> = Object.fromEntries(
  ALL_TOOLS.map((tool) => [tool.name, tool])
);

const GITHUB_OAUTH_TOOL_MAP: Record<string, ToolDefinition> = Object.fromEntries(
  GITHUB_OAUTH_TOOLS.map((tool) => [tool.name, tool])
);

const TRELLO_OAUTH_TOOL_MAP: Record<string, ToolDefinition> = Object.fromEntries(
  TRELLO_OAUTH_TOOLS.map((tool) => [tool.name, tool])
);

const TELEGRAM_OAUTH_TOOL_MAP: Record<string, ToolDefinition> = Object.fromEntries(
  TELEGRAM_OAUTH_TOOLS.map((tool) => [tool.name, tool])
);

const SHEETS_EXTENDED_TOOL_MAP: Record<string, ToolDefinition> = Object.fromEntries(
  [...SHEETS_EXTENDED_TOOLS, ...MYSHEETS_TOOLS].map((tool) => [tool.name, tool])
);

const NOTION_OAUTH_TOOL_MAP: Record<string, ToolDefinition> = Object.fromEntries(
  NOTION_OAUTH_TOOLS.map((tool) => [tool.name, tool])
);

export function getToolDefinition(name: string): ToolDefinition | undefined {
  return (
    TOOL_MAP[name] ??
    GITHUB_OAUTH_TOOL_MAP[name] ??
    TRELLO_OAUTH_TOOL_MAP[name] ??
    TELEGRAM_OAUTH_TOOL_MAP[name] ??
    SHEETS_EXTENDED_TOOL_MAP[name] ??
    NOTION_OAUTH_TOOL_MAP[name]
  );
}
