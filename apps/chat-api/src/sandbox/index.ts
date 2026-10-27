import { TRELLO_FAKE } from './fake-results/trello.js';
import { SLACK_FAKE } from './fake-results/slack.js';
import { GITHUB_FAKE } from './fake-results/github.js';
import { SHEETS_FAKE } from './fake-results/sheets.js';
import { CALENDAR_FAKE } from './fake-results/calendar.js';
import { NOTION_FAKE } from './fake-results/notion.js';
import { TELEGRAM_FAKE } from './fake-results/telegram.js';
import { JIRA_FAKE } from './fake-results/jira.js';
import { GMAIL_FAKE } from './fake-results/gmail.js';
import { MYCALENDAR_FAKE } from './fake-results/mycalendar.js';
import { StepError } from '@wap/tool-adapters';

const handlers = Object.fromEntries(
  [TRELLO_FAKE, SLACK_FAKE, GITHUB_FAKE, SHEETS_FAKE, CALENDAR_FAKE, NOTION_FAKE, TELEGRAM_FAKE, JIRA_FAKE, GMAIL_FAKE, MYCALENDAR_FAKE].map(
    (service) => [service.id, service.tools],
  ),
);

export function createSandboxAdapter(serviceName: string, scenario?: string) {
  console.log("[Sandbox Mode] Using In-Memory Sandbox Adapter for '" + serviceName + "'");
  return {
    execute: async (tool: string, args: Record<string, any>, context?: { signal?: AbortSignal }) => {
      if ((serviceName === 'gmail' || serviceName === 'mycalendar') && context?.signal?.aborted) {
        throw new StepError({
          category: 'NETWORK',
          message: `${serviceName} sandbox đã huỷ.`,
          details: { requestSent: false },
        });
      }
      console.log('[Sandbox Execution] Chạy tool ' + tool + ' với args:', JSON.stringify(args));
      const result = handlers[serviceName]?.[tool];
      if (result) return result(args, scenario ?? process.env.SANDBOX_SCENARIO);
      if (serviceName === 'gmail' || serviceName === 'mycalendar') {
        throw new StepError({
          category: 'VALIDATION',
          message: `Tool ${serviceName} sandbox không hợp lệ.`,
          details: { requestSent: false },
        });
      }
      if (tool.includes('.search_')) return [];
      return { ok: true, sandbox: true };
    },
  };
}
