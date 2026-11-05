/**
 * Live FLOW-07 Acceptance Runner using the real DeepSeek LLM provider (`DeepSeekProvider` / `createProviderFromEnv`).
 *
 * Usage:
 *   FLOW_07_LIVE=1 node --env-file=.env --import tsx evaluations/current-flows/run-deepseek-live.ts
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  AIPlanner,
  DeepSeekProvider,
  ReportArtifactStore,
  WorkingMemory,
  createProviderFromEnv,
  type LLMGeneratePlanInput,
  type LLMProvider,
  type ModelCallMetrics,
} from '@wap/planner';
import {
  ALL_TOOLS,
  GITHUB_OAUTH_TOOLS,
  TRELLO_OAUTH_TOOLS,
  NOTION_OAUTH_TOOLS,
  TELEGRAM_OAUTH_TOOLS,
  GMAIL_TOOLS,
  MYCALENDAR_TOOLS,
  MYSHEETS_TOOLS,
  MYJIRA_TOOLS,
  GMAIL_SERVICE,
  MYCALENDAR_SERVICE,
  MYSHEETS_SERVICE,
  MYJIRA_SERVICE,
  SERVICE_REGISTRY,
  type PlannerResponse,
} from '@wap/tool-schemas';
import { validateReportEvidenceBinding } from '../../apps/chat-api/src/services/report-evidence-guard.js';
import { fixtureSearch } from '../golden-v2/fixtures.js';
import { LIVE_SERVICES, checkLiveService } from '../live-execution/live-services.js';
import { planDigest, readLiveConfig } from '../live-execution/harness.js';

const CASES_PATH = resolve(import.meta.dirname, './cases.json');

const runtimeTools = [
  ...ALL_TOOLS.filter((t) => !['calendar', 'sheets', 'jira'].includes(t.service)),
  ...GITHUB_OAUTH_TOOLS,
  ...TRELLO_OAUTH_TOOLS,
  ...NOTION_OAUTH_TOOLS,
  ...TELEGRAM_OAUTH_TOOLS,
  ...GMAIL_TOOLS,
  ...MYCALENDAR_TOOLS,
  ...MYSHEETS_TOOLS,
  ...MYJIRA_TOOLS,
];

const fullRegistry = [
  ...SERVICE_REGISTRY,
  GMAIL_SERVICE,
  MYCALENDAR_SERVICE,
  MYSHEETS_SERVICE,
  MYJIRA_SERVICE,
];

class RecordingDeepSeekProvider implements LLMProvider {
  readonly name: string;
  readonly model: string;
  readonly calls: Array<{
    ms: number;
    servedModel?: string;
    metrics?: ModelCallMetrics;
    outputChars?: number;
    error?: string;
  }> = [];

  constructor(
    private readonly inner: LLMProvider & {
      model: string;
      lastServedModel?: string;
      lastCallMetrics?: ModelCallMetrics;
    },
  ) {
    this.name = inner.name;
    this.model = inner.model;
  }

  async generatePlan(input: LLMGeneratePlanInput): Promise<string> {
    const started = Date.now();
    try {
      const output = await this.inner.generatePlan(input);
      this.calls.push({
        ms: Date.now() - started,
        servedModel: this.inner.lastServedModel,
        metrics: this.inner.lastCallMetrics,
        outputChars: output.length,
      });
      return output;
    } catch (err: any) {
      this.calls.push({
        ms: Date.now() - started,
        servedModel: this.inner.lastServedModel,
        metrics: this.inner.lastCallMetrics,
        error: String(err?.message ?? err).slice(0, 300),
      });
      throw err;
    }
  }
}

function resolveDirectDeepSeekEnv(): Record<string, string | undefined> {
  const directBaseUrl =
    process.env.FLOW_07_USE_9ROUTER === '1'
      ? process.env.DEEPSEEK_BASE_URL || 'http://localhost:20128/v1'
      : process.env.LLM_BASE_URL && !process.env.LLM_BASE_URL.includes('20128')
        ? process.env.LLM_BASE_URL
        : 'https://api.deepseek.com';
  const apiKey = process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY;
  const model = process.env.DEEPSEEK_MODEL || process.env.LLM_MODEL || 'deepseek-chat';
  return {
    ...process.env,
    LLM_PROVIDER: 'deepseek',
    DEEPSEEK_BASE_URL: directBaseUrl,
    DEEPSEEK_API_KEY: apiKey,
    DEEPSEEK_MODEL: model,
  };
}

function buildDeepSeekProvider(): LLMProvider & {
  model: string;
  lastServedModel?: string;
  lastCallMetrics?: ModelCallMetrics;
} {
  return createProviderFromEnv(resolveDirectDeepSeekEnv()) as DeepSeekProvider;
}

async function verifyDeepSeekConnectivity(): Promise<{
  ok: boolean;
  requestedModel: string;
  servedModel?: string;
  baseUrl: string;
  error?: string;
}> {
  const resolved = resolveDirectDeepSeekEnv();
  const baseUrl = resolved.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
  const provider = buildDeepSeekProvider();
  try {
    await provider.generatePlan({
      systemPrompt: 'Return a JSON object: {"status":"ok"}',
      workingMemory: {},
      conversationHistory: [{ role: 'user', content: 'ping' }],
    });
    return {
      ok: true,
      requestedModel: provider.model,
      servedModel: provider.lastServedModel,
      baseUrl,
    };
  } catch (err: any) {
    return {
      ok: false,
      requestedModel: provider.model,
      servedModel: provider.lastServedModel,
      baseUrl,
      error: String(err?.message ?? err),
    };
  }
}

async function runPreflightConnectors() {
  const config = readLiveConfig(process.env);
  const results: Record<string, { status: 'OK' | 'BLOCKED' | 'NOT_RUN'; detail: string }> = {};
  for (const def of LIVE_SERVICES) {
    if (config.skipped[def.id]) {
      results[def.id] = { status: 'NOT_RUN', detail: config.skipped[def.id]! };
      continue;
    }
    try {
      const adapter = def.createAdapter(config.services[def.id]!);
      const count = await checkLiveService(def.id, adapter);
      results[def.id] = { status: 'OK', detail: `${count} allowlisted resources reachable` };
    } catch (err: any) {
      results[def.id] = { status: 'BLOCKED', detail: String(err?.message ?? err).slice(0, 300) };
    }
  }
  return results;
}

async function runSixWorkflowsThreeTimes() {
  const workflows = [
    {
      id: 'OFF-02',
      name: 'Google Meet + Docs + Gmail',
      kind: 'standard',
      prompt: (run: number) =>
        `Tạo lịch họp Google Meet từ 09:00 đến 10:00 ngày 2026-11-05 trên lịch owner@example.test với lan@example.com, tạo Google Docs biên bản trong thư mục folder_drive_789 và gửi link qua Gmail tới lan@example.com (lần ${run})`,
    },
    {
      id: 'OFF-03',
      name: 'Google Sheets Summary + Slack',
      kind: 'sheets_summary',
      prompt: (run: number) =>
        `Đọc bảng tính Báo cáo doanh số Q4 (spreadsheet_sales_q4, range Sheet1!A1:B4, có dòng tiêu đề đầu tiên) từ Google Sheets và gửi báo cáo tổng hợp số liệu lên kênh Slack #frontend (lần ${run})`,
    },
    {
      id: 'PM-01',
      name: 'Trello Card + Due + Member + Slack',
      kind: 'standard',
      prompt: (run: number) =>
        `Tạo thẻ "Sửa lỗi đăng nhập" trên bảng Trello Frontend danh sách To Do giao cho Minh kèm hạn chót 2026-11-06T17:00:00+07:00 và gửi thông báo kèm link thẻ vào kênh Slack #frontend (lần ${run})`,
    },
    {
      id: 'PM-03',
      name: 'Jira Sprint Progress + Slack',
      kind: 'jira_progress',
      prompt: (run: number) =>
        `Tra cứu tiến độ các issue Jira của dự án WEB trên site acme-site và gửi báo cáo tổng hợp tiến độ lên kênh Slack #frontend (lần ${run})`,
    },
    {
      id: 'DEV-02',
      name: 'GitHub PRs Review + Slack',
      kind: 'github_prs',
      prompt: (run: number) =>
        `Lấy danh sách Pull Request đang mở trên repo acme/web và gửi báo cáo tổng hợp PR lên kênh Slack #frontend (lần ${run})`,
    },
    {
      id: 'DEV-04',
      name: 'GitHub Issue Aging + Slack',
      kind: 'github_issues',
      prompt: (run: number) =>
        `Tìm các issue GitHub đang mở tồn đọng trên repo acme/web và gửi báo cáo tổng hợp theo độ tuổi lên kênh Slack #frontend (lần ${run})`,
    },
  ];

  const runs: Array<Record<string, unknown>> = [];
  for (const wf of workflows) {
    for (let run = 1; run <= 3; run++) {
      const provider = new RecordingDeepSeekProvider(buildDeepSeekProvider());
      const reportEvidenceStore = new ReportArtifactStore();
      const memory = new WorkingMemory();
      memory.setEntity('workflow_resource_defaults', {
        github: { repo: 'acme/web' },
        slack: { channelId: 'C_FE' },
        trello: { boardId: 'board_fe', listId: 'list_fe_todo' },
        myjira: { siteId: 'acme-site', projectKey: 'WEB' },
        mycalendar: { calendarId: 'owner@example.test' },
        mysheets: { spreadsheetId: 'spreadsheet_sales_q4', folderId: 'folder_drive_789' },
      });
      memory.setEntity('member', { id: 'member_minh', name: 'Minh', boardId: 'board_fe' });

      const searches: string[] = [];
      const planner = new AIPlanner({
        provider,
        toolCatalog: runtimeTools,
        gatherSearch: async (req) => {
          searches.push(req.tool);
          return fixtureSearch(req);
        },
        serviceRegistry: fullRegistry,
        reportEvidenceStore,
        searchMode: 'llm',
        now: () => new Date('2026-11-04T06:00:00Z'),
        timeZone: 'Asia/Ho_Chi_Minh',
      });

      const userMessage = wf.prompt(run);
      const started = Date.now();
      let response: PlannerResponse | undefined;
      let error: string | undefined;
      try {
        response = await planner.processMessage({
          userMessage,
          memory,
          actor: { userId: `user_deepseek_${wf.id}_${run}`, workspaceId: 'ws_deepseek' },
        });
      } catch (err: any) {
        error = String(err?.message ?? err).slice(0, 400);
      }

      let guardValid: boolean | null = null;
      let guardError: string | undefined;
      let planHash: string | undefined;
      if (response?.kind === 'plan') {
        planHash = planDigest(response);
        const art = response.reportEvidence
          ? reportEvidenceStore.getArtifact(response.reportEvidence.artifactId)
          : undefined;
        const guardCheck = await validateReportEvidenceBinding(response, {
          userId: `user_deepseek_${wf.id}_${run}`,
          workspaceId: 'ws_deepseek',
          requestTexts: [userMessage],
          observedArtifact: art
            ? {
                id: art.id,
                ownerUserId: art.actorUserId,
                workspaceId: art.workspaceId,
                contentHash: art.contentHash,
              }
            : null,
        });
        guardValid = guardCheck.valid;
        guardError = guardCheck.error;
      }

      const stepTools = response?.kind === 'plan' ? response.steps.map((s) => s.tool) : [];
      const sourceTool =
        response?.kind === 'plan' && response.reportEvidence?.sourceTool
          ? [response.reportEvidence.sourceTool]
          : [];
      const allToolsUsed = [...new Set([...sourceTool, ...stepTools])];

      const item = {
        workflowId: wf.id,
        run,
        requestedModel: provider.model,
        servedModel: provider.calls.find((c) => c.servedModel)?.servedModel ?? null,
        elapsedMs: Date.now() - started,
        llmCalls: provider.calls,
        kind: response?.kind ?? 'error',
        tools: allToolsUsed,
        stepTools,
        searches,
        reportEvidence: response?.kind === 'plan' ? response.reportEvidence ?? null : null,
        clarificationQuestion: response?.kind === 'clarification' ? response.question : undefined,
        guardValid,
        guardError,
        planHash,
        error,
      };
      console.log(
        `[Workflow ${wf.id} ${run}/3] kind=${item.kind} model=${item.servedModel ?? item.requestedModel} tools=${(item.tools as string[]).join(',')} guard=${item.guardValid} (${item.elapsedMs}ms)`,
      );
      runs.push(item);
    }
  }
  return runs;
}

async function run36OracleCases() {
  const raw = readFileSync(CASES_PATH, 'utf8');
  const datasetHash = createHash('sha256').update(raw).digest('hex');
  const data = JSON.parse(raw) as {
    cases: Array<{
      id: string;
      jobId: string;
      variant: 'explicit' | 'natural' | 'underspecified';
      prompt: string;
      services: string[];
      expectedKind: 'plan' | 'clarification' | 'refusal';
      expectedTools?: string[];
    }>;
  };

  const results: Array<Record<string, unknown>> = [];
  for (const c of data.cases) {
    const provider = new RecordingDeepSeekProvider(buildDeepSeekProvider());
    const reportEvidenceStore = new ReportArtifactStore();
    const memory = new WorkingMemory();
    if (c.variant === 'explicit' && c.expectedKind === 'plan') {
      memory.setEntity('workflow_resource_defaults', {
        github: { repo: 'acme/web' },
        slack: { channelId: 'C_GEN' },
        trello: { boardId: 'board_fe', listId: 'list_fe_todo' },
        myjira: { siteId: 'acme-site', projectKey: 'WEB' },
        mycalendar: { calendarId: 'owner@example.test' },
        mysheets: { spreadsheetId: 'spreadsheet_frontend_2026', folderId: 'folder_ati' },
      });
      memory.setEntity('member', { id: 'member_minh', name: 'Minh', boardId: 'board_fe' });
    }

    const searches: string[] = [];
    const planner = new AIPlanner({
      provider,
      toolCatalog: runtimeTools,
      gatherSearch: async (req) => {
        searches.push(req.tool);
        return fixtureSearch(req);
      },
      serviceRegistry: fullRegistry,
      reportEvidenceStore,
      searchMode: 'llm',
      now: () => new Date('2026-11-04T06:00:00Z'),
      timeZone: 'Asia/Ho_Chi_Minh',
    });

    const started = Date.now();
    let response: PlannerResponse | undefined;
    let error: string | undefined;
    try {
      response = await planner.processMessage({
        userMessage: c.prompt,
        memory,
        actor: { userId: `oracle_${c.id}`, workspaceId: 'ws_oracle' },
      });
    } catch (err: any) {
      error = String(err?.message ?? err).slice(0, 400);
    }

    const actualKind = response?.kind ?? 'error';
    const stepTools = response?.kind === 'plan' ? response.steps.map((s) => s.tool) : [];
    const sourceTool =
      response?.kind === 'plan' && response.reportEvidence?.sourceTool
        ? [response.reportEvidence.sourceTool]
        : [];
    const actualTools = [...new Set([...sourceTool, ...searches, ...stepTools])];
    const kindMatched = actualKind === c.expectedKind;
    const toolsMatched =
      c.expectedKind !== 'plan' ||
      (c.expectedTools ?? []).every((expected) => actualTools.includes(expected));
    const row = {
      id: c.id,
      jobId: c.jobId,
      variant: c.variant,
      expectedKind: c.expectedKind,
      actualKind,
      kindMatched,
      toolsMatched,
      expectedTools: c.expectedTools ?? [],
      actualTools,
      stepTools,
      elapsedMs: Date.now() - started,
      servedModel: provider.calls.find((call) => call.servedModel)?.servedModel ?? null,
      llmCallsCount: provider.calls.length,
      clarificationQuestion: response?.kind === 'clarification' ? response.question : undefined,
      error,
    };
    console.log(
      `[Case ${c.id}] expected=${c.expectedKind} actual=${actualKind} match=${kindMatched} (${row.elapsedMs}ms)`,
    );
    results.push(row);
  }

  return { datasetHash, results };
}

async function main() {
  if (process.env.FLOW_07_LIVE !== '1') {
    throw new Error('Set FLOW_07_LIVE=1 to execute live DeepSeek acceptance runs');
  }
  const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  console.log(`FLOW-07 DeepSeek Live Runner at HEAD ${headSha}`);

  const connectivity = await verifyDeepSeekConnectivity();
  if (!connectivity.ok) {
    console.error(
      `[BLOCKED] DeepSeek provider connectivity check failed against ${connectivity.baseUrl} (model=${connectivity.requestedModel}): ${connectivity.error}`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `[OK] DeepSeek provider reachable at ${connectivity.baseUrl} (requested=${connectivity.requestedModel}, served=${connectivity.servedModel ?? 'n/a'})`,
  );

  const preflight = await runPreflightConnectors();
  const workflowRuns = await runSixWorkflowsThreeTimes();
  const oracle = await run36OracleCases();

  const outDir = join(
    'docs',
    'ai-evidence',
    'FLOW-07-DEEPSEEK-LIVE',
    new Date().toISOString().replace(/[:.]/g, '-'),
  );
  mkdirSync(outDir, { recursive: true });
  const summaryPath = join(outDir, 'summary.json');
  writeFileSync(
    summaryPath,
    `${JSON.stringify(
      {
        headSha,
        executedAt: new Date().toISOString(),
        deepseek: connectivity,
        preflight,
        workflowRuns,
        oracle,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`Saved FLOW-07 DeepSeek live evidence to ${summaryPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
