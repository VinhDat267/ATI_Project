import type { PlannerResponse, PlanStep, ToolDefinition } from '@wap/tool-schemas';

export type Category = 'single_step' | 'multi_step' | 'cross_service' | 'clarification' | 'refusal' | 'free_form' | 'free_form_heldout' | 'read_only';

/** Label for one argument; every key present must hold. */
export interface Matcher {
  equals?: string | number | boolean;
  /** Equivalent ISO timestamps with an explicit offset match the same instant. */
  instantEquals?: string;
  startsWith?: string;
  endsWith?: string;
  /** Case-insensitive substrings; at least one must occur (templates are matched as written). */
  includesAny?: string[];
  includesAll?: string[];
  /** Array argument containing this element. */
  contains?: string | number;
  minItems?: number;
  /** A $ref/$template reading the output of a step using each listed tool. */
  refTo?: string | string[];
  absent?: true;
  /** Passes when any nested matcher passes, e.g. the original ID or a $ref to it. */
  anyOf?: Matcher[];
}

export interface StepSpec { tool: string; args?: Record<string, Matcher> }

export interface GoldenCase {
  id: string;
  category: Category;
  language: 'vi' | 'en';
  prompt: string;
  /** Service-set attribution, preregistered rather than inferred from a model answer. */
  primaryService?: string;
  services?: string[];
  ambiguity?: boolean;
  routing?: { legacy: string[]; full: string[] };
  /** Resources resolved in earlier turns: entity key -> fixture id. */
  memory?: Record<string, string>;
  expect: {
    kind: PlannerResponse['kind'];
    steps?: StepSpec[];
    /** Actual successful gather calls required for a read-only request. */
    searches?: StepSpec[];
    /** Alternative complete step lists; the case passes when any one passes. */
    anyOf?: StepSpec[][];
    /** Write tools a correct plan may add beyond the expected steps. */
    allowExtraTools?: string[];
  };
}

export interface CaseScore {
  kindOk: boolean;
  /** null when the case does not expect a plan. */
  toolsOk: boolean | null;
  argsOk: boolean | null;
  passed: boolean;
  matchers: { passed: number; total: number };
  failures: string[];
}

export interface CaseRun {
  case: GoldenCase;
  response?: PlannerResponse;
  error?: string;
  latencyMs: number;
  llmCalls: number;
  score: CaseScore;
}

type PlanResponse = Extract<PlannerResponse, { kind: 'plan' }>;

const lower = (value: string) => value.toLocaleLowerCase('vi');

function textOf(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && typeof (value as any).$template === 'string') return (value as any).$template;
  return undefined;
}

function referencedSteps(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  const ref = (value as any).$ref ?? (value as any).$template;
  if (typeof ref !== 'string') return [];
  if ((value as any).$ref) return [ref.split('.')[0]!];
  return [...ref.matchAll(/\$\{([^.}]+)\./g)].map((m) => m[1]!);
}

function checkMatcher(value: unknown, matcher: Matcher, plan: PlanResponse): boolean {
  if (matcher.anyOf && !matcher.anyOf.some((alternative) => checkMatcher(value, alternative, plan))) return false;
  if (matcher.absent) return value === undefined;
  if (value === undefined) return false;
  const text = textOf(value);
  if (matcher.equals !== undefined && value !== matcher.equals) return false;
  if (matcher.startsWith !== undefined && !(typeof value === 'string' && value.startsWith(matcher.startsWith))) return false;
  if (matcher.endsWith !== undefined && !(typeof value === 'string' && value.endsWith(matcher.endsWith))) return false;
  if (matcher.includesAny && !(text !== undefined && matcher.includesAny.some((s) => lower(text).includes(lower(s))))) return false;
  if (matcher.includesAll && !(text !== undefined && matcher.includesAll.every((s) => lower(text).includes(lower(s))))) return false;
  if (matcher.contains !== undefined && !(Array.isArray(value) && value.includes(matcher.contains))) return false;
  if (matcher.minItems !== undefined && !(Array.isArray(value) && value.length >= matcher.minItems)) return false;
  if (matcher.refTo !== undefined) {
    const tools = new Set(referencedSteps(value).map((id) => plan.steps.find((s) => s.id === id)?.tool));
    if (![matcher.refTo].flat().every((tool) => tools.has(tool))) return false;
  }
  return true;
}

function argResults(spec: StepSpec, step: PlanStep, plan: PlanResponse) {
  return Object.entries(spec.args ?? {}).map(([name, matcher]) => ({
    name, ok: checkMatcher(step.args[name], matcher, plan),
  }));
}

/** Finds a one-to-one assignment of plan steps to expected steps satisfying `fits`. */
function assign(expected: StepSpec[], steps: PlanStep[], fits: (spec: StepSpec, step: PlanStep) => boolean): boolean {
  const used = new Set<number>();
  const visit = (index: number): boolean => {
    if (index === expected.length) return true;
    const spec = expected[index]!;
    for (const [stepIndex, step] of steps.entries()) {
      if (used.has(stepIndex) || !fits(spec, step)) continue;
      used.add(stepIndex);
      if (visit(index + 1)) return true;
      used.delete(stepIndex);
    }
    return false;
  };
  return visit(0);
}

interface AlternativeScore { toolsAssigned: boolean; argsOk: boolean; passed: number; total: number; failures: string[] }

function scoreAlternative(expected: StepSpec[], response: PlanResponse): AlternativeScore {
  const toolsAssigned = assign(expected, response.steps, (spec, step) => spec.tool === step.tool);
  const argsOk = assign(expected, response.steps, (spec, step) =>
    spec.tool === step.tool && argResults(spec, step, response).every((result) => result.ok));
  const failures: string[] = [];
  if (!toolsAssigned) failures.push(`tools: expected ${expected.map((s) => s.tool).join(', ')}; got ${response.steps.map((s) => s.tool).join(', ')}`);
  // Per expected step, credit the best-matching plan step of that tool.
  let passed = 0;
  let total = 0;
  for (const spec of expected) {
    const names = Object.keys(spec.args ?? {});
    const candidates = response.steps.filter((step) => step.tool === spec.tool);
    const best = candidates
      .map((step) => argResults(spec, step, response))
      .sort((a, b) => b.filter((r) => r.ok).length - a.filter((r) => r.ok).length)[0]
      ?? names.map((name) => ({ name, ok: false }));
    passed += best.filter((r) => r.ok).length;
    total += names.length;
    const missed = best.filter((r) => !r.ok).map((r) => r.name);
    if (missed.length) failures.push(`args: ${spec.tool} ${missed.join(', ')}`);
  }
  return { toolsAssigned, argsOk, passed, total, failures };
}

export function scoreCase(golden: GoldenCase, response: PlannerResponse | undefined, catalog: ToolDefinition[]): CaseScore {
  const kindOk = response?.kind === golden.expect.kind;
  const failures: string[] = [];
  if (!kindOk) failures.push(`kind: expected ${golden.expect.kind}, got ${response?.kind ?? 'error'}`);
  if (golden.expect.kind !== 'plan') {
    return { kindOk, toolsOk: null, argsOk: null, passed: kindOk, matchers: { passed: 0, total: 0 }, failures };
  }

  const options = golden.expect.anyOf ?? [golden.expect.steps ?? []];
  if (!kindOk || response?.kind !== 'plan') {
    const total = Math.min(...options.map((steps) => steps.reduce((sum, spec) => sum + Object.keys(spec.args ?? {}).length, 0)));
    return { kindOk, toolsOk: false, argsOk: false, passed: false, matchers: { passed: 0, total }, failures };
  }

  const writeTools = new Set(catalog.filter((tool) => tool.sideEffect === 'write').map((tool) => tool.name));
  const allowed = new Set([...options.flat().map((spec) => spec.tool), ...golden.expect.allowExtraTools ?? []]);
  const unexpected = response.steps.filter((step) => writeTools.has(step.tool) && !allowed.has(step.tool));
  for (const step of unexpected) failures.push(`tools: unexpected write ${step.tool}`);

  // Report the alternative closest to passing: args first, then tools, then fewest missed labels.
  const [best] = options.map((steps) => scoreAlternative(steps, response)).sort((a, b) =>
    Number(b.argsOk) - Number(a.argsOk) || Number(b.toolsAssigned) - Number(a.toolsAssigned) ||
    (a.total - a.passed) - (b.total - b.passed));
  const toolsOk = best!.toolsAssigned && unexpected.length === 0;
  const argsOk = best!.argsOk;
  failures.push(...best!.failures);
  return { kindOk, toolsOk, argsOk, passed: toolsOk && argsOk, matchers: { passed: best!.passed, total: best!.total }, failures };
}

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
const rate = (flags: boolean[]) => mean(flags.map(Number));

function runMetrics(run: CaseRun[]) {
  const planCases = run.filter((r) => r.case.expect.kind === 'plan');
  const withTools = planCases.filter((r) => r.score.toolsOk);
  const matched = planCases.reduce((sum, r) => sum + r.score.matchers.passed, 0);
  const labelled = planCases.reduce((sum, r) => sum + r.score.matchers.total, 0);
  return {
    kindAccuracy: rate(run.map((r) => r.score.kindOk)),
    toolSelectionAccuracy: rate(planCases.map((r) => r.score.toolsOk === true)),
    /** Among plans with the right tools, the share whose labelled arguments all match. */
    argumentQuality: rate(withTools.map((r) => r.score.argsOk === true)),
    argumentMatcherRate: labelled ? matched / labelled : null,
    strictPassRate: rate(run.map((r) => r.score.passed)),
  };
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] ?? 0;
}

export function aggregateRuns(runs: CaseRun[][]) {
  const perRun = runs.map(runMetrics);
  const keys = Object.keys(perRun[0] ?? {}) as Array<keyof ReturnType<typeof runMetrics>>;
  const meanMetrics = Object.fromEntries(keys.map((key) =>
    [key, mean(perRun.map((m) => m[key]).filter((v): v is number => v !== null))])) as Record<(typeof keys)[number], number | null>;

  const all = runs.flat();
  const categories = [...new Set(all.map((r) => r.case.category))];
  const byCategory = Object.fromEntries(categories.map((category) => {
    const rows = all.filter((r) => r.case.category === category);
    return [category, { cases: rows.length / runs.length, strictPassRate: rate(rows.map((r) => r.score.passed)) }];
  })) as Record<Category, { cases: number; strictPassRate: number | null }>;

  const stability = Object.fromEntries([...new Set(all.map((r) => r.case.id))].map((id) => {
    const rows = all.filter((r) => r.case.id === id);
    return [id, `${rows.filter((r) => r.score.passed).length}/${rows.length}`];
  }));

  const latencies = all.map((r) => r.latencyMs).sort((a, b) => a - b);
  return {
    runs: perRun,
    mean: meanMetrics,
    byCategory,
    stability,
    latencyMs: { p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95), max: latencies.at(-1) ?? 0 },
    /** Requires user acceptance of previews; not measurable from labels. */
    usablePlanRate: null,
  };
}
