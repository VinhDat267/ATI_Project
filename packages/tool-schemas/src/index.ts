import type { ToolDefinition } from './types.js';
import { TRELLO_TOOLS } from './trello.js';
import { SLACK_TOOLS } from './slack.js';
import { GITHUB_TOOLS } from './github.js';

export * from './types.js';
export * from './trello.js';
export * from './slack.js';
export * from './github.js';
export * from './services.js';

export const ALL_TOOLS: ToolDefinition[] = [...TRELLO_TOOLS, ...SLACK_TOOLS, ...GITHUB_TOOLS];

export const TOOL_MAP: Record<string, ToolDefinition> = Object.fromEntries(
  ALL_TOOLS.map((tool) => [tool.name, tool])
);

export function getToolDefinition(name: string): ToolDefinition | undefined {
  return TOOL_MAP[name];
}
