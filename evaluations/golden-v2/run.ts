/** Golden v2 planning evaluation. Plans are scored, never executed. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AIPlanner, MockLLMProvider, WorkingMemory, createProviderFromEnv, type ChatMessage, type LLMGeneratePlanInput, type LLMProvider, type ModelCallMetrics, type PlanningPhaseMetrics } from '@wap/planner';
import { ALL_TOOLS, GMAIL_SERVICE, GMAIL_TOOLS, SERVICE_REGISTRY, type PlannerResponse, type ServiceDefinition, type ToolDefinition } from '@wap/tool-schemas';
import { aggregateRuns, percentile, scoreCase, type CaseRun, type GoldenCase, type SearchTrace } from './scorer.js';
import { buildMemory, fixtureSearch } from './fixtures.js';
import { validateIndependentSet } from '../golden-independent/validate.js';

const THRESHOLDS = { toolSelectionAccuracy: 0.85, argumentQuality: 0.75 };
export type EvalSet = 'core' | 'freeform' | 'services' | 'independent' | 'gmail' | 'answers' | 'multiturn';
const EVAL_FILES: Record<EvalSet, string> = {
  core: 'evaluations/golden-v2/cases.json', freeform: 'evaluations/golden-v2/cases-freeform.json',
  services: 'evaluations/golden-v2/cases-services.json', independent: 'evaluations/golden-independent/cases.json',
  gmail: 'evaluations/golden-v2/cases-gmail.json', answers: 'evaluations/golden-v2/cases-answers.json',
  multiturn: 'evaluations/golden-v2/cases-multiturn.json',
};
export interface GoldenFile { version: number; clock: string; timeZone: string; cases: GoldenCase[] }
export interface ObservedRun extends CaseRun { searches: SearchTrace[]; prefetches: SearchTrace[]; searchRounds: number; servedModels: string[]; providerError?: string;
  modelCalls: Array<ModelCallMetrics & { startedAtMs: number; promptChars: number }>; phases: PlanningPhaseMetrics[] }
export interface EvalCatalog { tools: ToolDefinition[]; services: ServiceDefinition[] }
/** Gmail stays outside ALL_TOOLS (GMAIL-01): only its own sets add it, so the older sets keep their catalog and hash. */
export function evalCatalog(set: EvalSet): EvalCatalog {
  return set === 'gmail' || set === 'answers' ? { tools: [...ALL_TOOLS, ...GMAIL_TOOLS], services: [...SERVICE_REGISTRY, GMAIL_SERVICE] }
    : { tools: ALL_TOOLS, services: SERVICE_REGISTRY };
}
/** Characters of the request messages, composed as OpenAICompatibleProvider sends them. */
export function promptCharacters(input: LLMGeneratePlanInput): number {
  const system = `${input.systemPrompt}\n\nWorking Memory Context:\n${JSON.stringify(input.workingMemory, null, 2)}`;
  return system.length + input.conversationHistory.reduce((sum, message) => sum + message.content.length, 0);
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const pct = (value: number | null | undefined) => value == null ? 'n/a' : `${(value * 100).toFixed(1)}%`;

export function parseEvalOptions(env: NodeJS.ProcessEnv) {
  const set = env.EVAL_SET ?? 'core';
  if (!Object.hasOwn(EVAL_FILES, set)) throw new Error('EVAL_SET must be core, freeform, services, independent, gmail, answers, multiturn');
  if (env.EVAL_SEARCH_MODE && env.PLANNER_SEARCH_MODE && env.EVAL_SEARCH_MODE !== env.PLANNER_SEARCH_MODE)
    throw new Error('EVAL_SEARCH_MODE and PLANNER_SEARCH_MODE disagree');
  const searchMode = env.EVAL_SEARCH_MODE ?? env.PLANNER_SEARCH_MODE ?? 'regex';
  if (searchMode !== 'regex' && searchMode !== 'llm') throw new Error('Search mode must be regex or llm');
  if (env.EVAL_READ_ANSWERS && env.PLANNER_READ_ANSWERS && env.EVAL_READ_ANSWERS !== env.PLANNER_READ_ANSWERS)
    throw new Error('EVAL_READ_ANSWERS and PLANNER_READ_ANSWERS disagree');
  const readAnswers = env.EVAL_READ_ANSWERS ?? env.PLANNER_READ_ANSWERS ?? (set === 'answers' ? 'on' : 'off');
  if (readAnswers !== 'on' && readAnswers !== 'off') throw new Error('Read answers must be on or off');
  if (set === 'answers' && readAnswers !== 'on') throw new Error('EVAL_SET=answers needs read answers on');
  const integer = (name: string, fallback: number, maximum: number) => {
    const value = Number(env[name] ?? fallback);
    if (!Number.isInteger(value) || value < 1 || value > maximum) throw new Error(`${name} must be an integer from 1 to ${maximum}`);
    return value;
  };
  return { set: set as EvalSet, searchMode: searchMode as 'regex' | 'llm', readAnswers: readAnswers === 'on',
    runsCount: integer('EVAL_RUNS', 3, 10), concurrency: integer('EVAL_CONCURRENCY', 2, 4) };
}
export function loadEvalFile(set: EvalSet) {
  const relativePath = EVAL_FILES[set];
  const casesFile = relativePath.replace(/^evaluations\/(golden-v2\/)?/, '');
  const raw = readFileSync(resolve(relativePath), 'utf8');
  return { casesFile, relativePath, raw, file: JSON.parse(raw) as GoldenFile };
}
/** The W4-01 set is scored only once its writers' full set passes the format and composition checks. */
export function assertSetReady(set: EvalSet, file: GoldenFile) {
  if (set !== 'independent') return;
  const problems = validateIndependentSet(file, { complete: true });
  if (problems.length) throw new Error(`Independent set is not ready: ${problems.length} problems; run evaluations/golden-independent/validate.ts`);
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
  if (/^Independent set is not ready: \d+ problems;/.test(text)) return text;
  if (/request timed out after \d+ms$/.test(text)) return 'Model request timed out';
  if (/Completion was served by/.test(text)) return 'Gateway served an unexpected model';
  return 'Request failed (details omitted from public evidence)';
}

/** Earlier turns as chat-service sends them: user text as written, a saved plan as its JSON, a question as text. */
export function historyOf(golden: GoldenCase): ChatMessage[] {
  return (golden.turns ?? []).map(turn => ({ role: turn.role, content: typeof turn.content === 'string' ? turn.content : JSON.stringify(turn.content) }));
}
/** Every request text of a case: the final prompt and the user's earlier turns. */
export function casePrompts(golden: GoldenCase): string[] {
  return [golden.prompt, ...(golden.turns ?? []).filter(turn => turn.role === 'user' && typeof turn.content === 'string').map(turn => turn.content as string)];
}
/** Model output, search arguments and score diagnostics can echo the request. */
function publicEvidenceValue<T>(value: T, prompts: string | string[]): T {
  // Longest first, so a prompt that contains another is redacted whole.
  const texts = [prompts].flat().filter(Boolean).sort((a, b) => b.length - a.length);
  const redact = (text: string) => texts.reduce((current, prompt) => current.split(prompt).join('[redacted case prompt]'), text);
  return JSON.parse(JSON.stringify(value), (_key, nested: unknown) => {
    if (typeof nested === 'string') return redact(nested);
    if (nested && typeof nested === 'object' && !Array.isArray(nested))
      return Object.fromEntries(Object.entries(nested).map(([key, entry]) => [redact(key), entry]));
    return nested;
  }) as T;
}
/** Redact only the public copy after scoring; keep the response interface for callers. */
export function publicEvidenceResponse(response: PlannerResponse | undefined, prompts: string | string[]): PlannerResponse | undefined {
  return response ? publicEvidenceValue(response, prompts) : response;
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
  const search = sumPhase('search');
  const gather = sumPhase('gather');
  const other = Math.max(0, total - model - prefetch - search - gather);
  return { calls: calls.length, attempts: attempts.length, timeouts: attempts.filter(a => a.outcome === 'timeout').length,
    searchRounds: rows.reduce((sum, r) => sum + (r.searchRounds ?? 0), 0),
    directoryCalls: rows.reduce((sum, r) => sum + (r.prefetches?.length ?? 0), 0),
    attemptDistribution, retryReasons, timeMs: { total, model, prefetch, search, gather, other },
    timeShare: { model: total ? model / total : 0, prefetch: total ? prefetch / total : 0, search: total ? search / total : 0, gather: total ? gather / total : 0, other: total ? other / total : 0 },
    under15Seconds: { count: rows.filter(r => r.latencyMs < 15000).length, total: rows.length,
      rate: rows.length ? rows.filter(r => r.latencyMs < 15000).length / rows.length : null } };
}
/**
 * Answers take several model calls, so their latency is reported apart from planning (GMAIL spec 5.5).
 * An action case is any case except read_only and answer; one that got an answer is what the read-answers flag must not cause.
 */
export function summarizeResponses(runs: ObservedRun[][]) {
  const rows = runs.flat();
  const latency = (list: ObservedRun[]) => {
    const sorted = list.map(r => r.latencyMs).sort((a, b) => a - b);
    return { p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95), max: sorted.at(-1) ?? 0 };
  };
  const answers = rows.filter(r => r.response?.kind === 'answer');
  const calls = answers.map(r => r.llmCalls);
  const distribution: Record<string, number> = {};
  for (const count of calls) distribution[count] = (distribution[count] ?? 0) + 1;
  const prompts = rows.filter(r => r.case.services?.includes('gmail')).flatMap(r => r.modelCalls.map(c => c.promptChars)).sort((a, b) => a - b);
  return {
    answers: { count: answers.length, latencyMs: latency(answers),
      modelCalls: { mean: calls.length ? calls.reduce((sum, n) => sum + n, 0) / calls.length : null, max: calls.length ? Math.max(...calls) : 0, distribution },
      withoutLookups: answers.filter(r => r.response?.kind === 'answer' && r.response.lookups.length === 0).length },
    plans: { count: rows.filter(r => r.response?.kind === 'plan').length, latencyMs: latency(rows.filter(r => r.response?.kind === 'plan')) },
    answeredActionCases: runs.flatMap((run, index) => run.filter(r => !['read_only', 'answer'].includes(r.case.category) && r.response?.kind === 'answer')
      .map(r => ({ id: r.case.id, run: index + 1 }))),
    gmailPromptChars: { calls: prompts.length, p50: percentile(prompts, 0.5), p95: percentile(prompts, 0.95), max: prompts.at(-1) ?? 0 },
  };
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
    const promptChars = promptCharacters(input);
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
        startedAtMs: started - this.turnStarted, promptChars });
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
  options: { provider?: LLMProvider; signal?: AbortSignal; catalog?: EvalCatalog; readAnswers?: boolean } = {}): Promise<ObservedRun> {
  const turnStarted = performance.now();
  const provider = new CountingProvider(options.provider ?? makeProvider(dryRun), turnStarted);
  const catalog = options.catalog ?? evalCatalog('core');
  const phases: PlanningPhaseMetrics[] = [];
  const traces: SearchTrace[] = [];
  const planner = new AIPlanner({
    provider, toolCatalog: catalog.tools, serviceRegistry: catalog.services, readAnswers: options.readAnswers ?? false, searchMode,
    now: () => new Date(file.clock), timeZone: file.timeZone,
    gatherSearch: async request => {
      const trace: SearchTrace = { tool: request.tool, args: structuredClone(request.args) };
      traces.push(trace);
      try { trace.result = await fixtureSearch(request); return trace.result; }
      catch (err) { trace.error = safeError(err); throw err; }
    },
  });
  const memory = new WorkingMemory();
  memory.fromJSON(buildMemory(golden.memory));
  const started = Date.now();
  let response: PlannerResponse | undefined, error: string | undefined;
  try { response = await planner.processMessage({ userMessage: golden.prompt, history: historyOf(golden), memory, signal: options.signal, onTiming: metrics => {
    phases.push(metrics);
    // Planner phases are sequential; each callback closes the current batch,
    // including parallel directory calls. Tool names alone cannot identify origin.
    for (const trace of traces) if (trace.phase === undefined) trace.phase = metrics.phase;
  } }); }
  catch (err) { error = safeError(err); }
  const searches = traces.filter(trace => trace.phase !== 'prefetch');
  const prefetches = traces.filter(trace => trace.phase === 'prefetch');
  const searchRounds = phases.filter(phase => phase.phase === 'search').length;
  return { case: golden, response, error, searches, prefetches, searchRounds, latencyMs: Date.now() - started, llmCalls: provider.calls,
    servedModels: provider.servedModels, providerError: provider.providerError, modelCalls: provider.modelCalls, phases,
    score: scoreCase(golden, response, catalog.tools, [...searches, ...prefetches], { llmCalls: provider.calls, searchRounds }) };
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
  if (!dryRun && git('status', '--porcelain', '--', 'evaluations/golden-v2', 'evaluations/golden-independent', 'packages/planner', 'packages/tool-schemas'))
    throw new Error('Commit evaluation/source changes before provider calls');
  return git('log', '-1', '--format=%H', '--', relativePath);
}
export async function main() {
  const dryRun = process.env.EVAL_DRY_RUN === '1';
  if (!dryRun && process.env.LIVE_EVAL !== '1') throw new Error('Set LIVE_EVAL=1 for provider calls, or EVAL_DRY_RUN=1');
  const { set, searchMode, readAnswers, runsCount, concurrency } = parseEvalOptions(process.env);
  const catalog = evalCatalog(set);
  const { casesFile, relativePath, raw, file } = loadEvalFile(set);
  assertSetReady(set, file);
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
  const startedAt = new Date().toISOString();
  const stamp = startedAt.replace(/[:.]/g, '-');
  const dir = join(process.env.EVAL_OUTPUT_DIR ?? join('docs', 'ai-evidence', 'V3-GOLDEN-V2'), `${dryRun ? 'dry-run-' : ''}${set}-${searchMode}-${readAnswers && set !== 'answers' ? 'answers-on-' : ''}${only.length ? 'subset-' : ''}${stamp}`);
  mkdirSync(dir, { recursive: true });
  const runs: ObservedRun[][] = [];
  let stopped = false;
  let pendingIds: string[] = [];
  for (let index = 0; index < runsCount; index++) {
    const result = await runPool(file.cases, concurrency, async (golden, signal) => {
      const row = await runCase(golden, file, dryRun, searchMode, { signal, catalog, readAnswers });
      console.log(`run ${index + 1}/${runsCount} ${golden.id}: ${row.score.passed ? 'PASS' : 'FAIL'} ${row.latencyMs}ms ${row.llmCalls} model calls`);
      return row;
    });
    runs.push(result.rows);
    stopped = result.stopped;
    pendingIds = result.pendingIds;
    const aggregate = aggregateRuns(runs, catalog.tools);
    const timing = summarizeTiming(runs.flat());
    const responses = summarizeResponses(runs);
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
      set, searchMode, readAnswers, subset: only.length ? only : undefined,
      labels: { file: casesFile, commit: labelCommit, sha256: hash(raw), version: file.version, cases: allCases, selectedCases: file.cases.length },
      sourceCommit, sourceTrees, fixtureSha256: hash(readFileSync('evaluations/golden-v2/fixtures.ts', 'utf8')),
      catalogSha256: hash(JSON.stringify(catalog.tools)), catalog: { tools: catalog.tools.length, services: [...new Set(catalog.tools.map(t => t.service))] },
      clock: file.clock, timeZone: file.timeZone, requestedRuns: runsCount, completedRuns: runs.filter(run => run.length === file.cases.length).length,
      attemptedCaseRuns: runs.flat().length, plannedCaseRuns: runsCount * file.cases.length, concurrency, startedAt, runAt: new Date().toISOString(),
      stopped, pendingIds, stopReason: runs.flat().find(r => r.providerError)?.providerError,
      scope: 'Planning only; search results/memory are synthetic fixtures; no plan executed. Read-only: clarification, exactly one model call, zero model-opened search rounds (phase search). Platform directory listing (phase prefetch) is allowed under the owner clarification of 08/10.',
      thresholds: THRESHOLDS, gate: { toolSelectionAccuracy: (aggregate.mean.toolSelectionAccuracy ?? 0) >= THRESHOLDS.toolSelectionAccuracy,
        argumentQuality: (aggregate.mean.argumentQuality ?? 0) >= THRESHOLDS.argumentQuality }, serviceGate,
      qualityGate: 'incomplete', aggregate, comparison, timing, responses,
      results: runs.map((run, i) => ({ run: i + 1, cases: run.map(r => publicEvidenceValue({ id: r.case.id, category: r.case.category, author: r.case.author, passed: r.score.passed,
        score: r.score, latencyMs: r.latencyMs, llmCalls: r.llmCalls, servedModels: r.servedModels, error: r.error, providerError: r.providerError,
        response: r.response, searches: r.searches, prefetches: r.prefetches, searchRounds: r.searchRounds, modelCalls: r.modelCalls, phases: r.phases }, casePrompts(r.case))) })),
    };
    writeFileSync(join(dir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    const m = aggregate.mean;
    const unstable = Object.entries(aggregate.stability).filter(([, stability]) => stability !== `${runsCount}/${runsCount}`);
    const summary = `# Golden v2: ${set}, ${searchMode}${only.length ? ', subset' : ''} — ${dryRun ? 'dry run' : complete ? 'provider observed' : 'partial'}

- Source: \`${sourceCommit}\`; labels \`${labelCommit}\`, SHA-256 \`${report.labels.sha256}\`.
- Provider: \`${report.provider}\`; requested model \`${report.model}\`; served: ${servedModels.join(', ') || 'unverified'}.
- ${file.cases.length} selected cases × ${runsCount} requested runs; ${report.attemptedCaseRuns}/${report.plannedCaseRuns} attempted; complete: ${complete}.
- Started ${startedAt}; checkpoint/end ${report.runAt} (UTC).
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
Model-opened search rounds (phase search): ${timing.searchRounds}; platform directory calls (phase prefetch): ${timing.directoryCalls}. searches excludes directory traces; prefetches records them separately. One search round can contain several parallel tool calls. Regex gather is not a model-opened search round.
Attempts per call (0 means provider does not expose diagnostics): ${JSON.stringify(timing.attemptDistribution)}. Retry reasons: ${JSON.stringify(timing.retryReasons)}.
Time share: model ${pct(timing.timeShare.model)}, directory ${pct(timing.timeShare.prefetch)}, search rounds ${pct(timing.timeShare.search)}, regex gather ${pct(timing.timeShare.gather)}, other ${pct(timing.timeShare.other)}.
Under 15 seconds: ${timing.under15Seconds.count}/${timing.under15Seconds.total} (${pct(timing.under15Seconds.rate)}).

Read answers: ${readAnswers ? 'on' : 'off'}; catalog ${report.catalog.tools} tools (${report.catalog.services.join(', ')}), SHA-256 \`${report.catalogSha256}\`.
Answers: ${responses.answers.count}; p50 / p95 / max ${responses.answers.latencyMs.p50} / ${responses.answers.latencyMs.p95} / ${responses.answers.latencyMs.max} ms; model calls per answer mean ${responses.answers.modelCalls.mean?.toFixed(2) ?? 'n/a'}, max ${responses.answers.modelCalls.max}, ${JSON.stringify(responses.answers.modelCalls.distribution)}; answers without a model-opened lookup (directory only): ${responses.answers.withoutLookups}.
Plans: ${responses.plans.count}; p50 / p95 / max ${responses.plans.latencyMs.p50} / ${responses.plans.latencyMs.p95} / ${responses.plans.latencyMs.max} ms. Answers are not held to the 15-second planning target.
Action cases (every category except read_only and answer) that got an answer: ${responses.answeredActionCases.map(r => `${r.id} (run ${r.run})`).join(', ') || 'none'}.
${responses.gmailPromptChars.calls ? `Prompt characters per model call in Gmail cases: p50 / p95 / max ${responses.gmailPromptChars.p50} / ${responses.gmailPromptChars.p95} / ${responses.gmailPromptChars.max} over ${responses.gmailPromptChars.calls} calls (system prompt, working memory and history, as sent).\n` : ''}
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
