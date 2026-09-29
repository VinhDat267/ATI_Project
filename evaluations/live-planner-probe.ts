/**
 * Live planner probe: runs the real planner pipeline (router, gather, Gemini,
 * validator + grounding) on natural demo requests and writes evidence.
 *
 * It never executes a plan, so no Trello/Slack/GitHub write happens. Search
 * results and earlier-turn working memory are labelled fixtures, so this
 * measures planning quality, not service connectivity.
 *
 * The provider comes from LLM_PROVIDER (see .env.example); each call records
 * the model the gateway reports having served.
 *
 *   LIVE_PROBE=1 node --env-file=.env --import tsx evaluations/live-planner-probe.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AIPlanner, WorkingMemory, createProviderFromEnv, type LLMGeneratePlanInput, type LLMProvider } from '@wap/planner';
import { ALL_TOOLS, type PlannerResponse } from '@wap/tool-schemas';

interface Scenario {
  id: string;
  message: string;
  /** Resources resolved in earlier turns (fixtures). */
  memory: Record<string, unknown>;
  /** Whether fixture search results are available to gather (default true). */
  searchable?: boolean;
  expectKind: PlannerResponse['kind'];
  expectTools?: string[];
  /** Each [from, to] pair: a step using `to` must reference the output of a step using `from`. */
  expectLinks?: Array<[string, string]>;
  /** Expected create_card `due` date prefix, or null when no deadline was stated. */
  expectDue?: string | null;
}

const board = { id: 'fixture_board_frontend', name: 'Frontend' };
const list = { id: 'fixture_list_todo', name: 'To Do', boardId: board.id };
const member = { id: 'fixture_member_minh', name: 'Minh' };
const channel = { id: 'CFIXTUREFE', name: 'frontend' };
const repository = { id: 'fixture_repo_1', name: 'web', fullName: 'acme/web', url: 'https://github.com/acme/web' };

const fixtureSearch: Record<string, unknown[]> = {
  'trello.search_boards': [board], 'trello.search_lists': [list], 'trello.search_members': [member],
  'slack.search_channels': [channel], 'github.search_repos': [repository],
};

/** Fixed clock so relative deadlines are checkable: Tuesday 2026-09-29, 10:00 in Hanoi. */
const PROBE_NOW = new Date('2026-09-29T03:00:00Z');
const PROBE_TIME_ZONE = 'Asia/Ho_Chi_Minh';

const scenarios: Scenario[] = [
  {
    // First turn of a real conversation: nothing resolved yet, only search.
    id: 'demo_vi_gather_only', memory: {},
    message: 'Tạo task cập nhật homepage cho team frontend, deadline thứ 6, gán Minh, báo trên Slack',
    expectKind: 'clarification',
  },
  {
    id: 'demo_vi', memory: { board, list, member, channel },
    message: 'Tạo task cập nhật homepage cho team frontend, deadline thứ 6, gán Minh, báo trên Slack',
    expectKind: 'plan', expectTools: ['trello.create_card', 'slack.send_message'], expectDue: '2026-10-02',
    expectLinks: [['trello.create_card', 'slack.send_message']],
  },
  {
    id: 'demo_en', memory: { board, list, member, channel },
    message: 'Create a task to update the homepage for the frontend team, due Friday, assign Minh, and notify the team on Slack',
    expectKind: 'plan', expectTools: ['trello.create_card', 'slack.send_message'], expectDue: '2026-10-02',
    expectLinks: [['trello.create_card', 'slack.send_message']],
  },
  {
    id: 'demo_vi_checklist', memory: { board, list, member, channel }, expectDue: null,
    message: 'Tạo task chuẩn bị release v2 cho Minh, thêm checklist gồm viết changelog, chạy test, deploy staging, rồi báo kênh Slack',
    expectKind: 'plan', expectTools: ['trello.create_card', 'trello.add_checklist', 'slack.send_message'],
    expectLinks: [['trello.create_card', 'trello.add_checklist'], ['trello.create_card', 'slack.send_message']],
  },
  {
    id: 'three_service', memory: { board, list, channel, repository },
    message: 'Mở issue GitHub trong repo acme/web về lỗi đăng nhập trên Safari, tạo card Trello theo dõi issue đó và báo team trên Slack kèm cả hai link',
    expectKind: 'plan', expectTools: ['github.create_issue', 'trello.create_card', 'slack.send_message'],
    expectLinks: [['github.create_issue', 'trello.create_card'], ['github.create_issue', 'slack.send_message']],
  },
  {
    // No lookups happened: a grounded planner must ask instead of inventing IDs.
    id: 'no_context', memory: {}, searchable: false,
    message: 'Tạo task cập nhật homepage cho team frontend, deadline thứ 6, báo trên Slack',
    expectKind: 'clarification',
  },
  {
    id: 'unsupported', memory: { board, list, channel },
    message: 'Xóa vĩnh viễn toàn bộ board Frontend và kick hết thành viên khỏi workspace',
    expectKind: 'refusal',
  },
];

/** Records each planner-level provider call; GeminiProvider retries transient errors inside a call. */
class RecordingProvider implements LLMProvider {
  readonly name: string;
  calls: Array<{ ms: number; servedModel?: string; output?: string; error?: string }> = [];
  constructor(private inner: LLMProvider & { lastServedModel?: string }) { this.name = inner.name; }
  async generatePlan(input: LLMGeneratePlanInput): Promise<string> {
    const started = Date.now();
    try {
      const output = await this.inner.generatePlan(input);
      this.calls.push({ ms: Date.now() - started, servedModel: this.inner.lastServedModel, output });
      return output;
    } catch (err: any) {
      this.calls.push({ ms: Date.now() - started, servedModel: this.inner.lastServedModel, error: String(err?.message ?? err).slice(0, 500) });
      throw err;
    }
  }
}

function linked(plan: Extract<PlannerResponse, { kind: 'plan' }>, from: string, to: string): boolean {
  const sources = new Set(plan.steps.filter((s) => s.tool === from).map((s) => s.id));
  return plan.steps.some((step) => step.tool === to &&
    [...JSON.stringify(step.args).matchAll(/(?:"\$ref":"|\$\{)([^.}"]+)\./g)].some((m) => sources.has(m[1]!)));
}

async function main() {
  if (process.env.LIVE_PROBE !== '1') throw new Error('Set LIVE_PROBE=1 to call the live LLM provider');
  const configured = createProviderFromEnv(process.env);
  const model = configured.model;
  const results = [];
  for (const scenario of scenarios) {
    const provider = new RecordingProvider(createProviderFromEnv(process.env));
    const planner = new AIPlanner({ provider, toolCatalog: ALL_TOOLS, now: () => PROBE_NOW, timeZone: PROBE_TIME_ZONE,
      gatherSearch: async ({ tool }) => scenario.searchable === false ? [] : fixtureSearch[tool] ?? [] });
    const memory = new WorkingMemory();
    memory.fromJSON(structuredClone(scenario.memory));
    const started = Date.now();
    let response: PlannerResponse | undefined;
    let error: string | undefined;
    try {
      response = await planner.processMessage({ userMessage: scenario.message, memory });
    } catch (err: any) {
      error = String(err?.message ?? err).slice(0, 500);
    }
    const checks: Record<string, boolean> = { kind: response?.kind === scenario.expectKind };
    if (response?.kind === 'plan') {
      const used = response.steps.map((s) => s.tool);
      if (scenario.expectTools) checks.tools = scenario.expectTools.every((tool) => used.includes(tool));
      for (const [from, to] of scenario.expectLinks ?? []) checks[`link ${from} -> ${to}`] = linked(response, from, to);
      if (scenario.expectDue !== undefined) {
        const due = response.steps.find((step) => step.tool === 'trello.create_card')?.args.due;
        checks.due = scenario.expectDue === null ? due === undefined
          : typeof due === 'string' && due.startsWith(scenario.expectDue) && due.endsWith('+07:00');
      }
    }
    const result = {
      id: scenario.id, message: scenario.message, fixtureMemory: scenario.memory,
      passed: !error && Object.values(checks).every(Boolean), checks, error,
      latencyMs: Date.now() - started, llmCalls: provider.calls, response,
    };
    results.push(result);
    console.log(`${result.passed ? 'PASS' : 'FAIL'} ${scenario.id.padEnd(18)} ${String(result.latencyMs).padStart(6)}ms calls=${provider.calls.length} kind=${response?.kind ?? 'error'} ${JSON.stringify(checks)}${error ? ` error=${error}` : ''}`);
  }

  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = join('docs', 'ai-evidence', 'V3-LIVE-PLANNER', runId);
  mkdirSync(dir, { recursive: true });
  const report = {
    evidence: 'provider_observed', provider: configured.name, model,
    gateway: configured.name === 'openai-compatible' ? process.env.LLM_BASE_URL : undefined,
    runAt: new Date().toISOString(), plannerClock: PROBE_NOW.toISOString(), timeZone: PROBE_TIME_ZONE,
    scope: 'planning only; no plan executed; search results and earlier-turn memory are labelled fixtures, not live Trello/Slack/GitHub data',
    passed: results.filter((r) => r.passed).length, total: results.length, results,
  };
  writeFileSync(join(dir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\n${report.passed}/${report.total} passed; evidence: ${dir}/report.json`);
}

main().catch((err) => { console.error(err); process.exit(1); });
