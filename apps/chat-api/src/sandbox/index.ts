import { TRELLO_FAKE } from './fake-results/trello.js';
import { SLACK_FAKE } from './fake-results/slack.js';
import { GITHUB_FAKE } from './fake-results/github.js';
import { SHEETS_FAKE } from './fake-results/sheets.js';

const handlers = Object.fromEntries([TRELLO_FAKE, SLACK_FAKE, GITHUB_FAKE, SHEETS_FAKE].map(service => [service.id, service.tools]));

export function createSandboxAdapter(serviceName: string, scenario?: string) {
  console.log("[Sandbox Mode] Using In-Memory Sandbox Adapter for '" + serviceName + "'");
  return {
    execute: async (tool: string, args: Record<string, any>) => {
      console.log('[Sandbox Execution] Chạy tool ' + tool + ' với args:', JSON.stringify(args));
      const result = handlers[serviceName]?.[tool];
      if (result) return result(args, scenario ?? process.env.SANDBOX_SCENARIO);
      if (tool.includes('.search_')) return [];
      return { ok: true, sandbox: true };
    },
  };
}
