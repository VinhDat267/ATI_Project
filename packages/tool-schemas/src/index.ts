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
export * from './registry/index.js';

export const ALL_TOOLS: ToolDefinition[] = [...TRELLO_TOOLS, ...SLACK_TOOLS, ...GITHUB_TOOLS, ...SHEETS_TOOLS, ...CALENDAR_TOOLS, ...NOTION_TOOLS, ...TELEGRAM_TOOLS, ...JIRA_TOOLS];

export const TOOL_MAP: Record<string, ToolDefinition> = Object.fromEntries(
  ALL_TOOLS.map((tool) => [tool.name, tool])
);

export function getToolDefinition(name: string): ToolDefinition | undefined {
  return TOOL_MAP[name];
}
