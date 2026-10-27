import { GMAIL_TOOLS, MYCALENDAR_TOOLS, getToolDefinition, type ToolDefinition } from '@wap/tool-schemas';

/**
 * Every tool a plan may contain, including the personal Gmail and MyCalendar tools that stay outside
 * ALL_TOOLS. The server's resource labels look tools up the same way.
 */
export function toolDefinition(name: string): ToolDefinition | undefined {
  return getToolDefinition(name) ?? GMAIL_TOOLS.find((tool) => tool.name === name) ?? MYCALENDAR_TOOLS.find((tool) => tool.name === name);
}
