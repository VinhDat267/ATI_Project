/**
 * Runs the labelled golden set v2 through the real planner and writes evidence.
 * Plans are scored, never executed. The provider comes from LLM_PROVIDER.
 *
 *   LIVE_EVAL=1 EVAL_RUNS=3 node --env-file=.env --import tsx evaluations/golden-v2/run.ts
 *
 * EVAL_DRY_RUN=1 swaps in a mock provider to check the wiring without LLM calls.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AIPlanner, MockLLMProvider, WorkingMemory, createProviderFromEnv, type LLMGeneratePlanInput, type LLMProvider } from '@wap/planner';
import { ALL_TOOLS, type PlannerResponse } from '@wap/tool-schemas';
import { aggregateRuns, scoreCase, type CaseRun, type GoldenCase } from './scorer.js';
import { buildMemory, fixtureSearch } from './fixtures.js';

const THRESHOLDS = { toolSelectionAccuracy: 0.85, argumentQuality: 0.75 };

interface GoldenFile { version: number; clock: string; timeZone: string; cases: GoldenCase[] }

/** Counts calls and records the model the gateway reports for each one. */
class CountingProvider implements LLMProvider {
  readonly name: string;
  calls = 0;
  servedModels: string[] = [];
  constructor(private inner: LLMProvider & { lastServedModel?: string }) { this.name = inner.name; }
  async generatePlan(input: LLMGeneratePlanInput): Promise<string> {
    this.calls++;
    try {
      return await this.inner.generatePlan(input);
    } finally {
      if (this.inner.lastServedModel) this.servedModels.push(this.inner.lastServedModel);
    }
  }
}

function makeProvider(dryRun: boolean): LLMProvider & { model?: string } {
  if (!dryRun) return createProviderFromEnv(process.env);
  const mock = new MockLLMProvider();
  mock.setPlanResponses([{ kind: 'refusal', reason: 'dry run' }]);
  return mock;
}

async function runCase(golden: GoldenCase, file: GoldenFile, dryRun: boolean, searchMode: 'regex' | 'llm'): Promise<CaseRun & { servedModels: string[] }> {
  const provider = new CountingProvider(makeProvider(dryRun));
  const planner = new AIPlanner({
    provider, toolCatalog: ALL_TOOLS, gatherSearch: fixtureSearch,
    now: () => new Date(file.clock), timeZone: file.timeZone, searchMode,
  });
  const memory = new WorkingMemory();
  memory.fromJSON(buildMemory(golden.memory));
  const started = Date.now();
  let response: PlannerResponse | undefined;
  let error: string | undefined;
  try {
    response = await planner.processMessage({ userMessage: golden.prompt, memory });
  } catch (err: any) {
    error = String(err?.message ?? err).slice(0, 500);
  }
  return {
    case: golden, response, error, latencyMs: Date.now() - started, llmCalls: provider.calls,
    servedModels: provider.servedModels, score: scoreCase(golden, response, ALL_TOOLS),
  };
}

async function pool<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]!);
    }
  }));
  return results;
}

/** Fails fast when an OpenAI-compatible gateway is down instead of scoring 150 network errors. */
async function preflight(dryRun: boolean): Promise<void> {
  if (dryRun || process.env.LLM_PROVIDER !== 'openai-compatible') return;
  const url = `${(process.env.LLM_BASE_URL ?? '').replace(/\/+$/, '')}/models`;
  const headers: Record<string, string> = process.env.LLM_API_KEY ? { authorization: `Bearer ${process.env.LLM_API_KEY}` } : {};
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(5000) }).catch((err) => {
    throw new Error(`LLM gateway ${url} is unreachable: ${err?.cause?.code ?? err?.message}`);
  });
  if (!response.ok) throw new Error(`LLM gateway ${url} answered ${response.status}`);
}

const pct = (value: number | null) => (value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`);

async function main() {
  const dryRun = process.env.EVAL_DRY_RUN === '1';
  if (!dryRun && process.env.LIVE_EVAL !== '1') throw new Error('Set LIVE_EVAL=1 to call the live LLM provider, or EVAL_DRY_RUN=1');
  const set = process.env.EVAL_SET ?? 'core';
  if (set !== 'core' && set !== 'freeform') throw new Error('EVAL_SET must be core or freeform');
  const searchMode = (process.env.EVAL_SEARCH_MODE ?? 'regex') as 'regex' | 'llm';
  if (searchMode !== 'regex' && searchMode !== 'llm') throw new Error('EVAL_SEARCH_MODE must be regex or llm');
  const casesFile = set === 'core' ? 'cases.json' : 'cases-freeform.json';
  const casesPath = resolve(process.cwd(), 'evaluations', 'golden-v2', casesFile);
  const raw = readFileSync(casesPath, 'utf8');
  const file = JSON.parse(raw) as GoldenFile;
  // EVAL_ONLY=cs11,ss09 reruns a subset; the report records it so it is never read as a full run.
  const only = (process.env.EVAL_ONLY ?? '').split(',').map((id) => id.trim()).filter(Boolean);
  if (only.length) {
    const unknown = only.filter((id) => !file.cases.some((c) => c.id === id));
    if (unknown.length) throw new Error(`EVAL_ONLY names unknown cases: ${unknown.join(', ')}`);
    file.cases = file.cases.filter((c) => only.includes(c.id));
  }
  const runsCount = Number(process.env.EVAL_RUNS ?? 3);
  const concurrency = Number(process.env.EVAL_CONCURRENCY ?? 2);
  await preflight(dryRun);
  const configured = makeProvider(dryRun);

  const runs: Array<Array<CaseRun & { servedModels: string[] }>> = [];
  for (let run = 1; run <= runsCount; run++) {
    const results = await pool(file.cases, concurrency, (golden) => runCase(golden, file, dryRun, searchMode));
    runs.push(results);
    const passed = results.filter((r) => r.score.passed).length;
    console.log(`run ${run}/${runsCount}: ${passed}/${results.length} strict pass`);
    for (const r of results.filter((r) => !r.score.passed)) {
      console.log(`  FAIL ${r.case.id} ${r.error ?? r.score.failures.join(' | ')}`);
    }
  }

  const aggregate = aggregateRuns(runs);
  const servedModels = [...new Set(runs.flat().flatMap((r) => r.servedModels))];
  const gate = {
    toolSelectionAccuracy: (aggregate.mean.toolSelectionAccuracy ?? 0) >= THRESHOLDS.toolSelectionAccuracy,
    argumentQuality: (aggregate.mean.argumentQuality ?? 0) >= THRESHOLDS.argumentQuality,
  };
  const report = {
    evidence: dryRun ? 'dry_run' : 'provider_observed',
    provider: configured.name, model: (configured as { model?: string }).model ?? 'mock',
    gateway: configured.name === 'openai-compatible' ? process.env.LLM_BASE_URL : undefined,
    servedModels,
    set, searchMode, subset: only.length ? only : undefined,
    labels: {
      file: casesFile,
      commit: execFileSync('git', ['log', '-1', '--format=%H', '--', `evaluations/golden-v2/${casesFile}`]).toString().trim(),
      sha256: createHash('sha256').update(raw).digest('hex'),
      version: file.version, cases: file.cases.length,
    },
    clock: file.clock, timeZone: file.timeZone, runs: runsCount, concurrency,
    runAt: new Date().toISOString(),
    scope: 'planning only; no plan executed; search results and earlier-turn memory are fixtures',
    thresholds: THRESHOLDS, gate,
    // The spec gate also needs usable plan rate, which requires user acceptance.
    qualityGate: 'incomplete',
    aggregate,
    results: runs.map((run, index) => ({ run: index + 1, cases: run.map((r) => ({
      id: r.case.id, category: r.case.category, passed: r.score.passed, score: r.score,
      latencyMs: r.latencyMs, llmCalls: r.llmCalls, servedModels: r.servedModels, error: r.error, response: r.response,
    })) })),
  };

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = join('docs', 'ai-evidence', 'V3-GOLDEN-V2', `${dryRun ? 'dry-run-' : ''}${set}-${searchMode}-${only.length ? 'subset-' : ''}${stamp}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);

  const m = aggregate.mean;
  const unstable = Object.entries(aggregate.stability).filter(([, s]) => !s.startsWith(`${runsCount}/`));
  const summary = `# Golden set v2 (${set}, ${searchMode} search${only.length ? `, subset: ${only.join(', ')}` : ''}) — ${dryRun ? 'dry run' : 'live run'}

- Provider: \`${report.provider}\` · model \`${report.model}\` · served: ${servedModels.map((s) => `\`${s}\``).join(', ') || 'n/a'}
- Labels: \`${casesFile}\` commit \`${report.labels.commit.slice(0, 7)}\`, sha256 \`${report.labels.sha256.slice(0, 12)}\`, ${file.cases.length} cases × ${runsCount} runs
- Clock: ${file.clock} (${file.timeZone}). Planning only; search results are fixtures; no plan was executed.

| Metric (mean of ${runsCount} runs) | Value | Target |
|---|---|---|
| Tool selection accuracy | ${pct(m.toolSelectionAccuracy)} | ≥ 85% ${gate.toolSelectionAccuracy ? '✅' : '❌'} |
| Argument quality (plans with right tools, all labels match) | ${pct(m.argumentQuality)} | ≥ 75% ${gate.argumentQuality ? '✅' : '❌'} |
| Argument label match rate | ${pct(m.argumentMatcherRate)} | — |
| Response kind accuracy | ${pct(m.kindAccuracy)} | — |
| Strict pass rate | ${pct(m.strictPassRate)} | — |
| Usable plan rate | n/a (needs user acceptance) | ≥ 70% |
| Latency p50 / p95 / max | ${aggregate.latencyMs.p50} / ${aggregate.latencyMs.p95} / ${aggregate.latencyMs.max} ms | < 15000 ms |

Per run: ${aggregate.runs.map((r, i) => `run ${i + 1} tools ${pct(r.toolSelectionAccuracy)}, args ${pct(r.argumentQuality)}, strict ${pct(r.strictPassRate)}`).join('; ')}.

| Category | Cases | Strict pass |
|---|---|---|
${Object.entries(aggregate.byCategory).map(([category, value]) => `| ${category} | ${value.cases} | ${pct(value.strictPassRate)} |`).join('\n')}

Cases not passing every run: ${unstable.length ? unstable.map(([id, s]) => `${id} (${s})`).join(', ') : 'none'}.
`;
  writeFileSync(join(dir, 'summary.md'), summary);
  console.log(`\n${summary}\nevidence: ${dir}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
