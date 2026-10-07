/** Golden v2 planning evaluation. Plans are scored, never executed. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AIPlanner, MockLLMProvider, WorkingMemory, createProviderFromEnv, type LLMGeneratePlanInput, type LLMProvider, type ModelCallMetrics, type PlanningPhaseMetrics } from '@wap/planner';
import { ALL_TOOLS, type PlannerResponse } from '@wap/tool-schemas';
import { aggregateRuns, scoreCase, type CaseRun, type GoldenCase, type SearchTrace } from './scorer.js';
import { buildMemory, fixtureSearch } from './fixtures.js';

const THRESHOLDS = { toolSelectionAccuracy: 0.85, argumentQuality: 0.75 };
export type EvalSet = 'core' | 'freeform' | 'services';
export interface GoldenFile { version: number; clock: string; timeZone: string; cases: GoldenCase[] }
export interface ObservedRun extends CaseRun { searches: SearchTrace[]; servedModels: string[]; providerError?: string;
  modelCalls: Array<ModelCallMetrics & { startedAtMs: number }>; phases: PlanningPhaseMetrics[] }
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const pct = (value: number | null | undefined) => value == null ? 'n/a' : `${(value * 100).toFixed(1)}%`;

export function parseEvalOptions(env: NodeJS.ProcessEnv) {
  const set = env.EVAL_SET ?? 'core';
  if (!['core', 'freeform', 'services'].includes(set)) throw new Error('EVAL_SET must be core, freeform or services');
  if (env.EVAL_SEARCH_MODE && env.PLANNER_SEARCH_MODE && env.EVAL_SEARCH_MODE !== env.PLANNER_SEARCH_MODE)
    throw new Error('EVAL_SEARCH_MODE and PLANNER_SEARCH_MODE disagree');
  const searchMode = env.EVAL_SEARCH_MODE ?? env.PLANNER_SEARCH_MODE ?? 'regex';
  if (searchMode !== 'regex' && searchMode !== 'llm') throw new Error('Search mode must be regex or llm');
  const integer = (name: string, fallback: number, maximum: number) => {
    const value = Number(env[name] ?? fallback);
    if (!Number.isInteger(value) || value < 1 || value > maximum) throw new Error(`${name} must be an integer from 1 to ${maximum}`);
    return value;
  };
  return { set: set as EvalSet, searchMode: searchMode as 'regex' | 'llm', runsCount: integer('EVAL_RUNS', 3, 10), concurrency: integer('EVAL_CONCURRENCY', 2, 4) };
}
export function loadEvalFile(set: EvalSet) {
  const casesFile = { core: 'cases.json', freeform: 'cases-freeform.json', services: 'cases-services.json' }[set];
  const relativePath = `evaluations/golden-v2/${casesFile}`;
  const raw = readFileSync(resolve(relativePath), 'utf8');
  return { casesFile, relativePath, raw, file: JSON.parse(raw) as GoldenFile };
}
export function safeGateway(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const url = new URL(value);
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}
function safeError(err: unknown): string {
  // Error bodies may echo entire prompts or credentials: publish only classifications.
  const status = (err as { status?: unknown })?.status;
  if (typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599) return `LLM gateway returned HTTP ${status}`;
  if (err instanceof SyntaxError) return 'Gateway returned invalid JSON';
  const text = String((err as Error)?.message ?? '');
  if (text === 'Evaluation stopped after provider failure') return text;
  if (/request timed out after \d+ms$/.test(text)) return 'Model request timed out';
  if (/Completion was served by/.test(text)) return 'Gateway served an unexpected model';
  return 'Request failed (details omitted from public evidence)';
}

/** A model can echo the entire request in its summary; redact only the public copy after scoring. */
export function publicEvidenceResponse(response: PlannerResponse | undefined, prompt: string): PlannerResponse | undefined {
  if (!response) return response;
  return JSON.parse(JSON.stringify(response, (_key, value: unknown) =>
    typeof value === 'string' && prompt ? value.split(prompt).join('[redacted case prompt]') : value)) as PlannerResponse;
}

export function summarizeTiming(rows: ObservedRun[]) {
  const calls = rows.flatMap(r => r.modelCalls);
  const attempts = calls.flatMap(c => c.attempts);
  const attemptDistribution: Record<string, number> = {};
  const retryReasons: Record<string, number> = {};
  for (const call of calls) attemptDistribution[call.attempts.length] = (attemptDistribution[call.attempts.length] ?? 0) + 1;
  for (const attempt of attempts) if (attempt.retryReason) retryReasons[attempt.retryReason] = (retryReasons[attempt.retryReason] ?? 0) + 1;
  const sumPhase = (phase: PlanningPhaseMetrics['phase']) => rows.flatMap(r => r.phases).filter(p => p.phase === phase).reduce((sum, p) => sum + p.durationMs, 0);
  const total = rows.reduce((sum, r) => sum + r.latencyMs, 0);
  const model = calls.reduce((sum, c) => sum + c.durationMs, 0);
  const prefetch = sumPhase('prefetch');
  const search = sumPhase('search') + sumPhase('gather');
  const other = Math.max(0, total - model - prefetch - search);
  return { calls: calls.length, attempts: attempts.length, timeouts: attempts.filter(a => a.outcome === 'timeout').length,
    attemptDistribution, retryReasons, timeMs: { total, model, prefetch, search, other },
    timeShare: { model: total ? model / total : 0, prefetch: total ? prefetch / total : 0, search: total ? search / total : 0, other: total ? other / total : 0 },
    under15Seconds: { count: rows.filter(r => r.latencyMs < 15000).length, total: rows.length,
      rate: rows.length ? rows.filter(r => r.latencyMs < 15000).length / rows.length : null } };
}
class CountingProvider implements LLMProvider {
  readonly name: string;
  calls = 0;
  servedModels: string[] = [];
  providerError?: string;
  modelCalls: ObservedRun['modelCalls'] = [];
  constructor(private inner: LLMProvider & { lastServedModel?: string }, private turnStarted: number) { this.name = inner.name; }
  async generatePlan(input: LLMGeneratePlanInput): Promise<string> {
    this.calls++;
    const started = performance.now();
    try {
      const output = await this.inner.generatePlan(input);
      if (this.inner.lastServedModel) this.servedModels.push(this.inner.lastServedModel);
      return output;
    } catch (err) {
      this.providerError = safeError(err);
      throw err;
    } finally {
      this.modelCalls.push({ ...(this.inner.lastCallMetrics ? structuredClone(this.inner.lastCallMetrics) : {
        durationMs: performance.now() - started, attempts: [], usage: { promptTokens: null, completionTokens: null, reasoningTokens: null } }),
        startedAtMs: started - this.turnStarted });
    }
  }
}
function makeProvider(dryRun: boolean): LLMProvider & { model?: string } {
  if (!dryRun) return createProviderFromEnv(process.env);
  const mock = new MockLLMProvider();
  mock.setPlanResponses([{ kind: 'refusal', reason: 'dry run' }]);
  return mock;
}
export async function runCase(golden: GoldenCase, file: GoldenFile, dryRun: boolean, searchMode: 'regex' | 'llm',
  options: { provider?: LLMProvider; signal?: AbortSignal } = {}): Promise<ObservedRun> {
  const turnStarted = performance.now();
  const provider = new CountingProvider(options.provider ?? makeProvider(dryRun), turnStarted);
  const phases: PlanningPhaseMetrics[] = [];
  const searches: SearchTrace[] = [];
  const planner = new AIPlanner({
    provider, toolCatalog: ALL_TOOLS, searchMode,
    now: () => new Date(file.clock), timeZone: file.timeZone,
    gatherSearch: async request => {
      const trace: SearchTrace = { tool: request.tool, args: structuredClone(request.args) };
      searches.push(trace);
      try { trace.result = await fixtureSearch(request); return trace.result; }
      catch (err) { trace.error = safeError(err); throw err; }
    },
  });
  const memory = new WorkingMemory();
  memory.fromJSON(buildMemory(golden.memory));
  const started = Date.now();
  let response: PlannerResponse | undefined, error: string | undefined;
  try { response = await planner.processMessage({ userMessage: golden.prompt, memory, signal: options.signal, onTiming: metrics => phases.push(metrics) }); }
  catch (err) { error = safeError(err); }
  return { case: golden, response, error, searches, latencyMs: Date.now() - started, llmCalls: provider.calls,
    servedModels: provider.servedModels, providerError: provider.providerError, modelCalls: provider.modelCalls, phases,
    score: scoreCase(golden, response, ALL_TOOLS, searches) };
}
/** Cancel in-flight work and stop dispatching after a provider failure. No automatic campaign retry. */
export async function runPool(items: GoldenCase[], limit: number, worker: (item: GoldenCase, signal: AbortSignal) => Promise<ObservedRun>) {
  const results: Array<ObservedRun | undefined> = new Array(items.length);
  const controller = new AbortController();
  let next = 0, stopped = false;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!stopped && next < items.length) {
      const index = next++;
      const result = await worker(items[index]!, controller.signal);
      results[index] = result;
      if (result.providerError) { stopped = true; controller.abort(new Error('Evaluation stopped after provider failure')); }
    }
  }));
  return { rows: results.filter((row): row is ObservedRun => row !== undefined), stopped,
    pendingIds: items.filter((_, index) => !results[index]).map(c => c.id) };
}
async function preflight(dryRun: boolean): Promise<void> {
  if (dryRun || process.env.LLM_PROVIDER !== 'openai-compatible') return;
  const url = `${(process.env.LLM_BASE_URL ?? '').replace(/\/+$/, '')}/models`;
  const headers = process.env.LLM_API_KEY ? { authorization: `Bearer ${process.env.LLM_API_KEY}` } : undefined;
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`LLM gateway preflight returned ${response.status}`);
}
function preregistration(relativePath: string, raw: string, dryRun: boolean) {
  const committed = execFileSync('git', ['show', `HEAD:${relativePath}`], { encoding: 'utf8' });
  if (!dryRun && hash(committed) !== hash(raw)) throw new Error('Labels differ from their committed preregistration');
  if (!dryRun && git('status', '--porcelain', '--', 'evaluations/golden-v2', 'packages/planner', 'packages/tool-schemas'))
    throw new Error('Commit evaluation/source changes before provider calls');
  return git('log', '-1', '--format=%H', '--', relativePath);
}
export async function main() {
  const dryRun = process.env.EVAL_DRY_RUN === '1';
  if (!dryRun && process.env.LIVE_EVAL !== '1') throw new Error('Set LIVE_EVAL=1 for provider calls, or EVAL_DRY_RUN=1');
  const { set, searchMode, runsCount, concurrency } = parseEvalOptions(process.env);
  const { casesFile, relativePath, raw, file } = loadEvalFile(set);
  const labelCommit = preregistration(relativePath, raw, dryRun);
  const only = [...new Set((process.env.EVAL_ONLY ?? '').split(',').map(id => id.trim()).filter(Boolean))];
  const unknown = only.filter(id => !file.cases.some(c => c.id === id));
  if (unknown.length) throw new Error(`EVAL_ONLY names unknown cases: ${unknown.join(', ')}`);
  const allCases = file.cases.length;
  if (only.length) file.cases = file.cases.filter(c => only.includes(c.id));
  await preflight(dryRun);
  const configured = makeProvider(dryRun);
  const sourceCommit = git('rev-parse', 'HEAD');
  const sourceTrees = Object.fromEntries(['packages/planner', 'packages/tool-schemas'].map(path => [path, git('rev-parse', `HEAD:${path}`)]));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = join(process.env.EVAL_OUTPUT_DIR ?? join('docs', 'ai-evidence', 'V3-GOLDEN-V2'), `${dryRun ? 'dry-run-' : ''}${set}-${searchMode}-${only.length ? 'subset-' : ''}${stamp}`);
  mkdirSync(dir, { recursive: true });
  const runs: ObservedRun[][] = [];
  let stopped = false;
  let pendingIds: string[] = [];
  for (let index = 0; index < runsCount; index++) {
    const result = await runPool(file.cases, concurrency, async (golden, signal) => {
      const row = await runCase(golden, file, dryRun, searchMode, { signal });
      console.log(`run ${index + 1}/${runsCount} ${golden.id}: ${row.score.passed ? 'PASS' : 'FAIL'} ${row.latencyMs}ms ${row.llmCalls} model calls`);
      return row;
    });
    runs.push(result.rows);
    stopped = result.stopped;
    pendingIds = result.pendingIds;
    const aggregate = aggregateRuns(runs);
    const timing = summarizeTiming(runs.flat());
    const servedModels = [...new Set(runs.flat().flatMap(r => r.servedModels))];
    const complete = !stopped && runs.length === runsCount && runs.every(run => run.length === file.cases.length);
    const serviceGate = Object.fromEntries(Object.entries(aggregate.byService).map(([service, metrics]) => [service, {
      toolSelectionAccuracy: (metrics.mean.toolSelectionAccuracy ?? 0) >= THRESHOLDS.toolSelectionAccuracy,
      argumentQuality: (metrics.mean.argumentQuality ?? 0) >= THRESHOLDS.argumentQuality,
    }]));
    const unchanged = set === 'core' ? runs.map(run => run.filter(r => r.case.id !== 'rf06')) : set === 'freeform' ? runs : undefined;
    const comparison = unchanged ? { baselineDate: '2026-10-01', baselineRuns: 1, baselineStrictPassRate: 1,
      unchangedCases: set === 'core' ? 49 : 18, measuredCases: new Set(unchanged.flat().map(r => r.case.id)).size,
      aggregate: aggregateRuns(unchanged), changedLabels: set === 'core' ? aggregateRuns(runs.map(run => run.filter(r => r.case.id === 'rf06'))) : undefined,
      limitation: 'One historical run versus three current runs; expanded fixture/catalog context differs; no statistical parity claim.' } : undefined;
    const report = {
      evidence: dryRun ? 'dry_run' : complete ? 'provider_observed' : 'provider_observed_partial', complete,
      provider: configured.name, model: configured.model ?? 'mock', gateway: safeGateway(process.env.LLM_BASE_URL), servedModels,
      set, searchMode, subset: only.length ? only : undefined,
      labels: { file: casesFile, commit: labelCommit, sha256: hash(raw), version: file.version, cases: allCases, selectedCases: file.cases.length },
      sourceCommit, sourceTrees, fixtureSha256: hash(readFileSync('evaluations/golden-v2/fixtures.ts', 'utf8')),
      catalogSha256: hash(JSON.stringify(ALL_TOOLS)), catalog: { tools: ALL_TOOLS.length, services: [...new Set(ALL_TOOLS.map(t => t.service))] },
      clock: file.clock, timeZone: file.timeZone, requestedRuns: runsCount, completedRuns: runs.filter(run => run.length === file.cases.length).length,
      attemptedCaseRuns: runs.flat().length, plannedCaseRuns: runsCount * file.cases.length, concurrency, runAt: new Date().toISOString(),
      stopped, pendingIds, stopReason: runs.flat().find(r => r.providerError)?.providerError,
      scope: 'Planning only; search results/memory are synthetic fixtures; no plan executed. Read-only requests are labelled as immediate clarification with no searches under the 05/10 product policy.',
      thresholds: THRESHOLDS, gate: { toolSelectionAccuracy: (aggregate.mean.toolSelectionAccuracy ?? 0) >= THRESHOLDS.toolSelectionAccuracy,
        argumentQuality: (aggregate.mean.argumentQuality ?? 0) >= THRESHOLDS.argumentQuality }, serviceGate,
      qualityGate: 'incomplete', aggregate, comparison, timing,
      results: runs.map((run, i) => ({ run: i + 1, cases: run.map(r => ({ id: r.case.id, category: r.case.category, passed: r.score.passed,
        score: r.score, latencyMs: r.latencyMs, llmCalls: r.llmCalls, servedModels: r.servedModels, error: r.error, providerError: r.providerError,
        response: publicEvidenceResponse(r.response, r.case.prompt), searches: r.searches, modelCalls: r.modelCalls, phases: r.phases })) })),
    };
    writeFileSync(join(dir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    const m = aggregate.mean;
    const unstable = Object.entries(aggregate.stability).filter(([, stability]) => stability !== `${runsCount}/${runsCount}`);
    const summary = `# Golden v2: ${set}, ${searchMode}${only.length ? ', subset' : ''} — ${dryRun ? 'dry run' : complete ? 'provider observed' : 'partial'}

- Source: \`${sourceCommit}\`; labels \`${labelCommit}\`, SHA-256 \`${report.labels.sha256}\`.
- Provider: \`${report.provider}\`; requested model \`${report.model}\`; served: ${servedModels.join(', ') || 'unverified'}.
- ${file.cases.length} selected cases × ${runsCount} requested runs; ${report.attemptedCaseRuns}/${report.plannedCaseRuns} attempted; complete: ${complete}.
- Clock: ${file.clock}, ${file.timeZone}. ${report.scope}
- Usable plan rate is unmeasured; product quality gate remains incomplete. Provider transport retains its bounded production retries; campaign never retries after a provider failure.

| Metric | Value | Target |
|---|---|---|
| Tools | ${pct(m.toolSelectionAccuracy)} | ≥85% |
| Arguments among correct tools | ${pct(m.argumentQuality)} | ≥75% |
| Strict pass | ${pct(m.strictPassRate)} | — |
| Response kind | ${pct(m.kindAccuracy)} | — |
| Latency p50 / p95 / max | ${aggregate.latencyMs.p50} / ${aggregate.latencyMs.p95} / ${aggregate.latencyMs.max} ms | <15000 ms |

Model calls: ${timing.calls}; transport attempts: ${timing.attempts}; timeouts: ${timing.timeouts}.
Attempts per call (0 means provider does not expose diagnostics): ${JSON.stringify(timing.attemptDistribution)}. Retry reasons: ${JSON.stringify(timing.retryReasons)}.
Time share: model ${pct(timing.timeShare.model)}, directory ${pct(timing.timeShare.prefetch)}, search rounds ${pct(timing.timeShare.search)}, other ${pct(timing.timeShare.other)}.
Under 15 seconds: ${timing.under15Seconds.count}/${timing.under15Seconds.total} (${pct(timing.under15Seconds.rate)}).
Per-call timing includes retry backoff; attempts measure each actual transport attempt, including reading the response body. Missing token counts are null, never fabricated. Reasoning may be included in prompt_tokens by the gateway; do not add it to prompt/completion totals.

Service metrics score only that service's preregistered tool/argument labels within each workflow. Immediate read-only clarification has no tool/argument denominator. Clarification/refusal contribute to kind/strict scores. Latency is the entire request involving the service.

| Service | Cases | Tool attempts | Argument attempts | Tools | Arguments | p50 / p95 ms |
|---|---|---|---|---|---|---|
${Object.entries(aggregate.byService).map(([service, v]) => `| ${service} | ${v.cases} | ${v.scoredAttempts} | ${v.argumentAttempts} | ${pct(v.mean.toolSelectionAccuracy)} | ${pct(v.mean.argumentQuality)} | ${v.latencyMs.p50} / ${v.latencyMs.p95} |`).join('\n')}

Cases not passing every requested run: ${unstable.map(([id, stability]) => `${id} (${stability})`).join(', ') || 'none'}.
${comparison ? `\nUnchanged-label comparison: ${comparison.measuredCases}/${comparison.unchangedCases} cases, strict ${pct(comparison.aggregate.mean.strictPassRate)} versus 100% in one historical run. rf06 is excluded and reported separately. ${comparison.limitation}\n` : ''}
${stopped ? `\nSTOPPED: ${report.stopReason}. Unstarted current-run cases: ${pendingIds.join(', ')}. Later requested runs were not started.\n` : ''}`;
    writeFileSync(join(dir, 'summary.md'), summary);
    console.log(`run ${index + 1}: ${result.rows.filter(r => r.score.passed).length}/${result.rows.length} strict; checkpoint ${dir}`);
    if (stopped) { process.exitCode = 2; break; }
  }
  console.log(`evidence: ${dir}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(err => { console.error(safeError(err)); process.exitCode = 1; });
}
