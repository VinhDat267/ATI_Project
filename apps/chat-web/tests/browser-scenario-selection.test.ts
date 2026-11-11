import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const SCRIPT_PATH = resolve(__dirname, '../../../scripts/test-v3-browser.mjs');

interface ScenarioEntry {
  name: string;
  grep: string;
  sandboxScenario?: string;
  schedulesEnabled?: boolean;
  executionMode?: 'mocked_browser_routes' | 'real_backend_sandbox';
}

async function loadBrowserScenarioModule(): Promise<{
  scenarios: ScenarioEntry[];
  resolveActiveScenarios?: (
    passArgs?: string[],
    env?: Record<string, string | undefined>
  ) => Array<{
    name: string;
    grep?: string;
    sandboxScenario?: string;
    schedulesEnabled?: boolean;
    executionMode?: 'mocked_browser_routes' | 'real_backend_sandbox';
    passArgs?: string[];
  }>;
  OMITTED_SCENARIO_ROUTING?: Record<
    string,
    {
      titlePrefix: string;
      specFile: string;
      executionMode: 'mocked_browser_routes' | 'real_backend_sandbox';
      requiresSchedulesEnabled: boolean;
    }
  >;
}> {
  const source = readFileSync(SCRIPT_PATH, 'utf8');
  if (source.includes('export const scenarios')) {
    const modUrl = pathToFileURL(SCRIPT_PATH).href;
    return await import(/* @vite-ignore */ modUrl);
  }
  const match = source.match(/const scenarios = (\[[\s\S]*?\n\]);/);
  if (!match?.[1]) {
    throw new Error('Could not locate scenarios array in scripts/test-v3-browser.mjs');
  }
  const scenarios = vm.runInNewContext(match[1]) as ScenarioEntry[];
  return { scenarios };
}

const TARGET_TITLES = [
  {
    prefix: 'TRELLO:',
    fullTitle:
      'TRELLO: admin selects workspace and two boards, member connects via fake OAuth, plan displays board name and username',
    specFile: 'apps/chat-web/tests/browser/trello-oauth.spec.ts',
    expectedMode: 'mocked_browser_routes' as const,
  },
  {
    prefix: 'TRELLO-E2E:',
    fullTitle:
      'TRELLO-E2E: extended Trello tools plan, guardrail warnings callout, Kanban preview modal, real backend execution, ReceiptMoment, and trello_digest proposal',
    specFile: 'apps/chat-web/tests/browser/trello-oauth.spec.ts',
    expectedMode: 'real_backend_sandbox' as const,
  },
  {
    prefix: 'TELEGRAM-E2E-1:',
    fullTitle:
      'TELEGRAM-E2E-1: /guide 1-click showcase, TELEGRAM_PAIRING_PENDING auto-focus verification, #telegram-scope filter & counter, and multi-source auto_digest schedule + /history',
    specFile: 'apps/chat-web/tests/browser/telegram-oauth-and-digest.spec.ts',
    expectedMode: 'mocked_browser_routes' as const,
  },
  {
    prefix: 'TELEGRAM-E2E-2:',
    fullTitle:
      'TELEGRAM-E2E-2: 2-way Telegram workflow (telegram.read_messages + telegram.send_message) on PlanMoment, PreviewModal, and real Backend Execution to ReceiptMoment',
    specFile: 'apps/chat-web/tests/browser/telegram-oauth-and-digest.spec.ts',
    expectedMode: 'real_backend_sandbox' as const,
  },
];

const PRIOR_REQUIRED_PATTERNS = [
  'SLACK-M4:',
  'SLACK-M3:',
  'SLACK-M2:',
  'SLACK-02:',
  'login, chat, approval and execution',
  'cancel a pending plan',
  'edit a pending plan',
  'AUTH-01:',
  'AUTH-03:',
  'FE-02:',
  'FE-07:',
  'FE-12:',
  'AUTH-02:',
  'AUTH-04:',
  'clarification before plan',
  'partial failure and skip',
  'three-service workflow resolves prior outputs',
  'approved four-service workflow resolves prior outputs',
  'approved nine-service workflow resolves prior outputs across all 9 services',
  'approved Sheets workflow carries updatedRange to Slack',
  'approved Calendar workflow carries event url and start to Slack',
  'approved Notion workflow carries page url to Slack',
  'approved Telegram workflow carries messageId to Slack',
  'approved Jira workflow carries key and url to Slack',
  'ANS-01:',
  'GMAIL-03:',
  'OAUTH-01 from chat:',
  'MYCALENDAR:',
  'MYSHEETS:',
  'SCHED-03:',
  'GITHUB-DIGEST:',
];

describe('CI Browser Scenario Selector (TRELLO-AUDIT-13 / AUTO-09)', () => {
  it('selects all four previously omitted Trello and Telegram browser scenarios in default CI run', async () => {
    const mod = await loadBrowserScenarioModule();

    for (const target of TARGET_TITLES) {
      const matchingEntries = mod.scenarios.filter((entry) =>
        new RegExp(`^(?:${entry.grep})`).test(target.fullTitle)
      );
      expect(
        matchingEntries.length,
        `Expected default scenarios in scripts/test-v3-browser.mjs to match "${target.fullTitle}"`
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it('explicitly separates mocked_browser_routes vs real_backend_sandbox and never claims native E2E for mocked API routes', async () => {
    const mod = await loadBrowserScenarioModule();
    expect(mod.OMITTED_SCENARIO_ROUTING).toBeDefined();

    for (const target of TARGET_TITLES) {
      const routingMeta = mod.OMITTED_SCENARIO_ROUTING?.[target.prefix];
      expect(routingMeta, `Missing routing metadata for ${target.prefix}`).toBeDefined();
      expect(routingMeta?.executionMode).toBe(target.expectedMode);
      expect(routingMeta?.specFile).toBe(target.specFile);

      const matchingEntry = mod.scenarios.find((entry) =>
        new RegExp(`^(?:${entry.grep})`).test(target.fullTitle)
      );
      expect(matchingEntry).toBeDefined();
      expect(matchingEntry?.executionMode).toBe(target.expectedMode);
      expect(matchingEntry?.schedulesEnabled).toBe(true);
    }
  });

  it('preserves all prior scenarios and security checks in default selector and supports CLI title grep routing', async () => {
    const mod = await loadBrowserScenarioModule();

    for (const pattern of PRIOR_REQUIRED_PATTERNS) {
      const matched = mod.scenarios.some((entry) =>
        new RegExp(entry.grep).test(`${pattern} sample title`)
      );
      expect(matched, `Expected prior scenario pattern ${pattern} to remain selected`).toBe(true);
    }

    expect(mod.resolveActiveScenarios).toBeTypeOf('function');
    const defaultActive = mod.resolveActiveScenarios!([]);
    expect(defaultActive.length).toBe(mod.scenarios.length);

    for (const target of TARGET_TITLES) {
      const cliActive = mod.resolveActiveScenarios!(['-g', target.prefix], {});
      expect(cliActive).toHaveLength(1);
      expect(cliActive[0]?.sandboxScenario).toBe('schedule');
      expect(cliActive[0]?.schedulesEnabled).toBe(true);
    }
  });

  it('XSVC-B (TRELLO-AUDIT-13 ∩ GAS-12): preserves all 25 scenario groups including sheets_digest_v2_recovery alongside Trello/Telegram groups', async () => {
    const mod = await loadBrowserScenarioModule();
    expect(mod.scenarios).toHaveLength(25);

    const sheetsRecovery = mod.scenarios.find((s) => s.name === 'sheets_digest_v2_recovery');
    expect(sheetsRecovery).toBeDefined();
    expect(sheetsRecovery?.schedulesEnabled).toBe(true);
    expect(
      new RegExp(sheetsRecovery!.grep).test(
        'Browser UI E2E (Mocked API): Sheets Digest V2 Preview, Uncertain Delivery Recovery, and Reauthorization'
      )
    ).toBe(true);

    const filteredByEnv = mod.resolveActiveScenarios!([], { SCENARIO: 'sheets_digest_v2_recovery' });
    expect(filteredByEnv).toHaveLength(1);
    expect(filteredByEnv[0]?.name).toBe('sheets_digest_v2_recovery');

    const cliSheetsSpec = mod.resolveActiveScenarios!(
      ['apps/chat-web/tests/browser/sheets-digest-v2-recovery.spec.ts'],
      {}
    );
    expect(cliSheetsSpec).toHaveLength(1);
    expect(cliSheetsSpec[0]).toMatchObject({
      name: 'schedule',
      sandboxScenario: 'schedule',
      schedulesEnabled: true,
    });

    const scriptSource = readFileSync(SCRIPT_PATH, 'utf8');
    expect(scriptSource).toMatch(/GMAIL_ENABLED\s*=\s*\['gmail',\s*'sheets_digest_v2_recovery'\]\.includes\(scenario\.name\)/);
    expect(scriptSource).toMatch(/MYSHEETS_ENABLED\s*=\s*\['mysheets',\s*'sheets_digest_v2_recovery'\]\.includes\(scenario\.name\)/);
    expect(scriptSource).toMatch(
      /SCHEDULES_ENABLED\s*=\s*\(\['schedule',\s*'sheets_digest_v2_recovery'\]\.includes\(scenario\.name\)\s*\|\|\s*scenario\.schedulesEnabled\)/
    );
  });
});
