import { GITHUB_OAUTH_TOOLS, GMAIL_TOOLS, MYCALENDAR_TOOLS, MYSHEETS_TOOLS, MYSLACK_CORE_READ_TOOLS, MYSLACK_CHAT_POST_MESSAGE_TOOL, NOTION_OAUTH_TOOLS, SHEETS_EXTENDED_TOOLS, TELEGRAM_OAUTH_TOOLS, TRELLO_OAUTH_TOOLS, getToolDefinition, type ToolDefinition } from '@wap/tool-schemas';

/**
 * Every tool a plan may contain, including the personal Gmail, MyCalendar, MySheets, Notion, Telegram, and Trello OAuth tools that stay outside
 * ALL_TOOLS. The server's resource labels look tools up the same way.
 */
export function toolDefinition(name: string): ToolDefinition | undefined {
  return (
    getToolDefinition(name) ??
    TRELLO_OAUTH_TOOLS.find((tool) => tool.name === name) ??
    GITHUB_OAUTH_TOOLS.find((tool) => tool.name === name) ??
    TELEGRAM_OAUTH_TOOLS.find((tool) => tool.name === name) ??
    GMAIL_TOOLS.find((tool) => tool.name === name) ??
    MYCALENDAR_TOOLS.find((tool) => tool.name === name) ??
    MYSHEETS_TOOLS.find((tool) => tool.name === name) ??
    SHEETS_EXTENDED_TOOLS.find((tool) => tool.name === name) ??
    NOTION_OAUTH_TOOLS.find((tool) => tool.name === name) ??
    MYSLACK_CORE_READ_TOOLS.find((tool) => tool.name === name) ??
    (name === MYSLACK_CHAT_POST_MESSAGE_TOOL.name ? MYSLACK_CHAT_POST_MESSAGE_TOOL : undefined)
  );
}
