/**
 * Controlled live execution against real Trello, Slack and GitHub.
 *
 *   node --env-file=.env --import tsx evaluations/live-execution/run.ts discover
 *   node --env-file=.env --import tsx evaluations/live-execution/run.ts check
 *   node --env-file=.env --import tsx evaluations/live-execution/run.ts plan "<request>"
 *   node --env-file=.env --import tsx evaluations/live-execution/run.ts execute <plan.json> --confirm <hash>
 *
 * discover, check and plan only read. execute runs the write steps of one saved
 * plan, and only when --confirm carries that plan's hash. A service is enabled
 * only with a token and an allowlist (LIVE_TRELLO_BOARD_IDS, LIVE_SLACK_CHANNELS,
 * LIVE_GITHUB_REPOS); the adapters refuse resources outside it.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { AIPlanner, WorkingMemory, createProviderFromEnv } from '@wap/planner';
import { LIVE_SERVICES } from './live-services.js';
import { ALL_TOOLS, type PlanResponse, type PlannerResponse } from '@wap/tool-schemas';
import { executeApproved, planDigest, readLiveConfig, writeSteps, type LiveService } from './harness.js';

type Adapter = { execute(tool: string, args: any, options?: { signal?: AbortSignal }): Promise<any> };

function createAdapter(service: string, config: LiveService): Adapter {
  const definition = LIVE_SERVICES.find(entry => entry.id === service);
  if (!definition) throw new Error('No adapter for ' + service);
  return definition.createAdapter(config);
}

const errorText = (err: any) => `${err?.category ?? 'ERROR'}: ${String(err?.message ?? err).slice(0, 300)}`;

/** Lists what the tokens can see, before any allowlist exists, so targets can be chosen. */
async function discover(env: NodeJS.ProcessEnv) {
  if (env.TRELLO_API_KEY && env.TRELLO_TOKEN) {
    const trello = new TrelloAdapter({ credentials: { apiKey: env.TRELLO_API_KEY, token: env.TRELLO_TOKEN }, allowedScope: {} });
    try {
      const boards = await trello.execute('trello.search_boards', { query: '', limit: 10 });
      console.log('Trello boards (id, name):');
      for (const board of boards) console.log(`  ${board.id}  ${board.name}`);
    } catch (err) { console.log(`Trello: ${errorText(err)}`); }
  } else console.log('Trello: TRELLO_API_KEY and TRELLO_TOKEN are not both set');

  if (env.SLACK_BOT_TOKEN) {
    const slack = new SlackAdapter({ credentials: { botToken: env.SLACK_BOT_TOKEN }, allowedScope: {} });
    try {
      const channels = await slack.execute('slack.search_channels', { query: '', limit: 10 });
      console.log('Slack channels the bot can see (id, name):');
      for (const channel of channels) console.log(`  ${channel.id}  #${channel.name}${channel.isPrivate ? ' (private)' : ''}`);
    } catch (err) { console.log(`Slack: ${errorText(err)}`); }
  } else console.log('Slack: SLACK_BOT_TOKEN is not set');

  console.log(env.GITHUB_TOKEN
    ? 'GitHub: token is set; name the test repository in LIVE_GITHUB_REPOS as owner/name'
    : 'GitHub: GITHUB_TOKEN is not set');
}

/** Read-only reachability of every enabled service within its allowlist. */
async function check(services: Record<string, LiveService>, skipped: Record<string, string>) {
  for (const [service, reason] of Object.entries(skipped)) console.log(`${service}: OFF - ${reason}`);
  let ok = Object.keys(services).length > 0;
  for (const [service, config] of Object.entries(services)) {
    const adapter = createAdapter(service, config);
    try {
      if (service === 'trello') {
        const boards = await adapter.execute('trello.search_boards', { query: '', limit: 10 });
        if (boards.length === 0) throw new Error('no allowlisted board is visible to this token');
        for (const board of boards) {
          const lists = await adapter.execute('trello.search_lists', { boardId: board.id, limit: 10 });
          console.log(`trello: OK - board "${board.name}" (${board.id}), lists: ${lists.map((l: any) => l.name).join(', ')}`);
        }
      } else if (service === 'slack') {
        const channels = await adapter.execute('slack.search_channels', { query: '', limit: 10 });
        if (channels.length === 0) throw new Error('no allowlisted channel is visible to the bot');
        console.log(`slack: OK - channels: ${channels.map((c: any) => `#${c.name} (${c.id})`).join(', ')}`);
      } else {
        const repos = (await Promise.all(config.allowedScope.repos!.map((repo) =>
          adapter.execute('github.search_repos', { query: repo.split('/')[1], limit: 10 })))).flat();
        if (repos.length === 0) throw new Error('no allowlisted repository is visible to this token');
        console.log(`github: OK - repos: ${[...new Set(repos.map((r: any) => r.fullName))].join(', ')}`);
      }
    } catch (err) {
      ok = false;
      console.log(`${service}: FAILED - ${errorText(err)}`);
    }
  }
  if (!ok) process.exitCode = 1;
}

async function plan(request: string, services: Record<string, LiveService>) {
  const enabled = Object.keys(services);
  if (enabled.length === 0) throw new Error('No service is enabled; run "check" to see why');
  const adapters = new Map(enabled.map((service) => [service, createAdapter(service, services[service]!)]));
  const searches: Array<{ tool: string; args: unknown; ms: number; results?: number; error?: string }> = [];
  const llmCalls: Array<{ ms: number; outputChars: number }> = [];
  const inner = createProviderFromEnv(process.env);
  // Times every model call so a turn's latency can be attributed.
  const provider = {
    name: inner.name, model: inner.model,
    generatePlan: async (input: Parameters<typeof inner.generatePlan>[0]) => {
      const startedAt = Date.now();
      const output = await inner.generatePlan(input);
      llmCalls.push({ ms: Date.now() - startedAt, outputChars: output.length });
      return output;
    },
  };
  const planner = new AIPlanner({
    provider, toolCatalog: ALL_TOOLS.filter((tool) => enabled.includes(tool.service)), searchMode: 'llm',
    timeZone: process.env.APP_TIME_ZONE || undefined,
    // The planner only lets read tools through; this is the single path to the services.
    gatherSearch: async ({ tool, args, signal }) => {
      const startedAt = Date.now();
      try {
        const result = await adapters.get(tool.split('.')[0]!)!.execute(tool, args, { signal });
        searches.push({ tool, args, ms: Date.now() - startedAt, results: Array.isArray(result) ? result.length : 1 });
        return result;
      } catch (err) {
        searches.push({ tool, args, ms: Date.now() - startedAt, error: errorText(err) });
        throw err;
      }
    },
  });

  const started = Date.now();
  const response: PlannerResponse = await planner.processMessage({ userMessage: request, memory: new WorkingMemory() });
  const latencyMs = Date.now() - started;
  const hash = response.kind === 'plan' ? planDigest(response) : undefined;

  const dir = join('docs', 'ai-evidence', 'V3-LIVE-EXECUTION', new Date().toISOString().replace(/[:.]/g, '-'));
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'plan.json');
  writeFileSync(file, `${JSON.stringify({
    request, requestedAt: new Date().toISOString(), provider: provider.name, model: provider.model,
    services: Object.fromEntries(enabled.map((service) => [service, services[service]!.allowedScope])),
    latencyMs, llmCalls, searches, hash, response,
  }, null, 2)}\n`);

  console.log(`\nSearches: ${searches.map((s) => `${s.tool}(${s.error ?? s.results}, ${s.ms}ms)`).join(', ') || 'none'}`);
  console.log(`Model calls: ${llmCalls.map((c) => `${c.ms}ms/${c.outputChars}ch`).join(', ')}`);
  console.log(`Planner answered in ${latencyMs} ms with: ${response.kind}`);
  if (response.kind !== 'plan') {
    console.log(JSON.stringify(response, null, 2));
    console.log(`\nNo plan to execute. Saved to ${file}`);
    return;
  }
  console.log(`\nSummary: ${response.summary}`);
  for (const step of response.steps) console.log(`  ${step.id}  ${step.tool}  ${JSON.stringify(step.args)}`);
  if (response.warnings?.length) console.log(`Warnings: ${response.warnings.join(' | ')}`);
  console.log(`\nWRITE STEPS that would run: ${writeSteps(response).map((step) => step.tool).join(', ') || 'none'}`);
  console.log(`Saved to ${file}\nTo execute exactly this plan:\n  run.ts execute ${file} --confirm ${hash}`);
}

async function execute(file: string, confirm: string | undefined, services: Record<string, LiveService>) {
  if (!confirm) throw new Error('execute needs --confirm <hash> of the reviewed plan');
  const saved = JSON.parse(readFileSync(file, 'utf8')) as { response: PlannerResponse };
  if (saved.response.kind !== 'plan') throw new Error('The saved response is not a plan');
  const adapters = new Map<string, Adapter>();
  const report = await executeApproved({
    plan: saved.response as PlanResponse, approvedHash: confirm, services: Object.keys(services),
    getAdapter: (service) => {
      if (!adapters.has(service)) adapters.set(service, createAdapter(service, services[service]!));
      return adapters.get(service)!;
    },
    onStep: (stepId, state) => console.log(`  ${stepId}: ${state.status}${state.error ? ` - ${errorText(state.error)}` : ''}`),
  });
  const out = join(dirname(file), 'execution.json');
  writeFileSync(out, `${JSON.stringify({ executedAt: new Date().toISOString(), approvedHash: confirm, ...report }, null, 2)}\n`);
  console.log(`\nExecution ${report.status}`);
  for (const step of report.steps) console.log(`  ${step.id}  ${step.tool}  ${step.status}  ${step.output?.url ?? step.output?.ts ?? ''}`);
  console.log(`Saved to ${out}`);
  if (report.status !== 'completed') process.exitCode = 1;
}

async function main() {
  const [mode, ...rest] = process.argv.slice(2);
  if (mode === 'discover') return discover(process.env);
  const { services, skipped } = readLiveConfig(process.env);
  if (mode === 'check') return check(services, skipped);
  if (mode === 'plan') {
    if (!rest[0]) throw new Error('plan needs the request text');
    return plan(rest[0], services);
  }
  if (mode === 'execute') {
    const confirmIndex = rest.indexOf('--confirm');
    return execute(rest[0]!, confirmIndex >= 0 ? rest[confirmIndex + 1] : undefined, services);
  }
  throw new Error('Usage: run.ts discover | check | plan "<request>" | execute <plan.json> --confirm <hash>');
}

main().catch((err) => { console.error(errorText(err)); process.exit(1); });
