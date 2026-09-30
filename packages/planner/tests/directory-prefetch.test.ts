import { describe, it, expect } from 'vitest';
import { AIPlanner, WorkingMemory, buildSystemPrompt, type LLMGeneratePlanInput, type LLMProvider } from '../src/index.js';
import { ALL_TOOLS, TRELLO_TOOLS, SLACK_TOOLS } from '@wap/tool-schemas';

function scripted(...outputs: unknown[]) {
  const inputs: LLMGeneratePlanInput[] = [];
  const provider: LLMProvider = {
    name: 'scripted',
    async generatePlan(input) {
      inputs.push({ ...input, workingMemory: structuredClone(input.workingMemory), conversationHistory: [...input.conversationHistory] });
      const next = outputs[Math.min(inputs.length - 1, outputs.length - 1)];
      return typeof next === 'string' ? next : JSON.stringify(next);
    },
  };
  return { provider, inputs };
}

const ask = { kind: 'clarification', question: 'Which one?', context: 'need more' };
const plan = {
  kind: 'plan', thinking: 't', summary: 's', warnings: [],
  steps: [
    { id: 'card', tool: 'trello.create_card', description: 'Create card', args: { listId: 'list_todo', title: 'Task', idMembers: ['m_minh'] }, dependsOn: [] },
    { id: 'note', tool: 'slack.send_message', description: 'Notify', args: { channel: 'C_FE', text: { $template: 'Card ${card.output.url}' } }, dependsOn: ['card'] },
  ],
};

interface Call { tool: string; args: Record<string, unknown>; signal?: AbortSignal }

/** Fixture workspace: two boards by default, each with lists and members. */
function workspace(options: { boards?: number; delayMs?: number; hang?: string; fail?: string } = {}) {
  const calls: Call[] = [];
  let running = 0;
  let maxRunning = 0;
  const boards = Array.from({ length: options.boards ?? 2 }, (_, i) => ({ id: `b${i}`, name: `Board ${i}` }));
  const fn = async ({ tool, args, signal }: Call) => {
    calls.push({ tool, args, signal });
    running++;
    maxRunning = Math.max(maxRunning, running);
    try {
      if (tool === options.hang) {
        await new Promise((_, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true }));
      }
      if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      if (tool === options.fail) throw new Error('service down');
      switch (tool) {
        case 'trello.search_boards': return boards;
        case 'trello.search_lists': return args.boardId === 'b0' ? [{ id: 'list_todo', name: 'To Do', boardId: 'b0' }] : [{ id: 'list_other', name: 'Backlog', boardId: args.boardId }];
        case 'trello.search_members': return args.boardId === 'b0' ? [{ id: 'm_minh', fullName: 'Minh', username: 'minh' }] : [];
        case 'slack.search_channels': return [{ id: 'C_FE', name: 'frontend', isPrivate: false }];
        case 'github.search_repos': return [{ id: '1', name: 'web', fullName: 'acme/web', url: 'https://github.com/acme/web' }];
        default: return [];
      }
    } finally {
      running--;
    }
  };
  return { fn, calls, maxRunning: () => maxRunning };
}

const request = 'Tạo task cập nhật homepage cho team, gán Minh, báo trên Slack';
const make = (provider: LLMProvider, gatherSearch: any, extra: Record<string, unknown> = {}) =>
  new AIPlanner({ provider, toolCatalog: ALL_TOOLS, gatherSearch, searchMode: 'llm', ...extra });

describe('workspace directory prefetch', () => {
  it('looks up boards, lists, members and channels before the first model call so one call can plan', async () => {
    const { provider, inputs } = scripted(plan);
    const w = workspace();
    const response = await make(provider, w.fn).processMessage({ userMessage: request, memory: new WorkingMemory() });
    expect(response.kind).toBe('plan');
    expect(inputs).toHaveLength(1);
    const observed = inputs[0]!.workingMemory.__observed;
    expect(observed.board.map((b: any) => b.id)).toEqual(['b0', 'b1']);
    expect(observed.list.map((l: any) => l.id).sort()).toEqual(['list_other', 'list_todo']);
    expect(observed.channel.map((c: any) => c.id)).toEqual(['C_FE']);
    // A member is remembered with the board it was found on.
    expect(observed.member).toEqual([{ id: 'm_minh', fullName: 'Minh', boardId: 'b0' }]);
  });

  it('lists with an empty query and only through tools marked listable', async () => {
    const { provider } = scripted(ask);
    const w = workspace();
    await make(provider, w.fn).processMessage({ userMessage: request, memory: new WorkingMemory() });
    expect(new Set(w.calls.map((c) => c.tool))).toEqual(new Set(['trello.search_boards', 'trello.search_lists', 'trello.search_members', 'slack.search_channels']));
    expect(w.calls.every((c) => c.args.query === '' && c.args.limit === 10)).toBe(true);
    expect(w.calls.filter((c) => c.tool === 'trello.search_lists').map((c) => c.args.boardId).sort()).toEqual(['b0', 'b1']);
  });

  it('runs lookups in parallel, parents before children', async () => {
    const { provider } = scripted(ask);
    const w = workspace({ delayMs: 20 });
    await make(provider, w.fn).processMessage({ userMessage: request, memory: new WorkingMemory() });
    expect(w.maxRunning()).toBeGreaterThan(1);
    const order = w.calls.map((c) => c.tool);
    expect(order.indexOf('trello.search_boards')).toBeLessThan(order.indexOf('trello.search_lists'));
  });

  it('does not expand lists and members when there are more than three boards', async () => {
    const { provider, inputs } = scripted(ask);
    const w = workspace({ boards: 4 });
    await make(provider, w.fn).processMessage({ userMessage: request, memory: new WorkingMemory() });
    expect(w.calls.map((c) => c.tool).sort()).toEqual(['slack.search_channels', 'trello.search_boards']);
    expect(inputs[0]!.workingMemory.__observed.list).toBeUndefined();
  });

  it('gives up on a slow lookup after the time budget and still calls the model', async () => {
    const { provider, inputs } = scripted(ask);
    const w = workspace({ hang: 'slack.search_channels' });
    const started = Date.now();
    const response = await make(provider, w.fn, { directoryBudgetMs: 60 }).processMessage({ userMessage: request, memory: new WorkingMemory() });
    expect(Date.now() - started).toBeLessThan(1500);
    expect(response.kind).toBe('clarification');
    expect(inputs[0]!.workingMemory.__observed.board).toHaveLength(2);
    expect(inputs[0]!.workingMemory.__observed.channel).toBeUndefined();
    expect(w.calls.find((c) => c.tool === 'slack.search_channels')!.signal!.aborted).toBe(true);
  });

  it('ignores a failing lookup', async () => {
    const { provider, inputs } = scripted(ask);
    const w = workspace({ fail: 'trello.search_boards' });
    const response = await make(provider, w.fn).processMessage({ userMessage: request, memory: new WorkingMemory() });
    expect(response.kind).toBe('clarification');
    expect(inputs[0]!.workingMemory.__observed.channel).toHaveLength(1);
    expect(inputs[0]!.workingMemory.__observed.board).toBeUndefined();
  });

  it('does not look up again what an earlier turn already listed', async () => {
    const { provider } = scripted(ask);
    const w = workspace();
    const memory = new WorkingMemory();
    const planner = make(provider, w.fn);
    await planner.processMessage({ userMessage: request, memory });
    const first = w.calls.length;
    await planner.processMessage({ userMessage: 'Board 0', memory, history: [{ role: 'user', content: request }] });
    expect(w.calls.length).toBe(first);
  });

  it('only lists resources of the routed services', async () => {
    const { provider } = scripted(ask);
    const w = workspace();
    await make(provider, w.fn).processMessage({ userMessage: 'Post a message in the release channel on Slack', memory: new WorkingMemory() });
    expect(w.calls.map((c) => c.tool)).toEqual(['slack.search_channels']);
  });

  it('can be turned off, and never runs in regex mode', async () => {
    const off = workspace();
    await make(scripted(ask).provider, off.fn, { prefetchDirectory: false }).processMessage({ userMessage: request, memory: new WorkingMemory() });
    expect(off.calls).toHaveLength(0);
    const regex = workspace();
    await new AIPlanner({ provider: scripted(ask).provider, toolCatalog: ALL_TOOLS, gatherSearch: regex.fn })
      .processMessage({ userMessage: 'Send a Slack message', memory: new WorkingMemory() });
    expect(regex.calls).toHaveLength(0);
  });

  it('runs the searches of one model request in parallel', async () => {
    const { provider } = scripted(
      { kind: 'search', calls: [{ tool: 'trello.search_boards', args: { query: 'x' } }, { tool: 'slack.search_channels', args: { query: 'y' } }] },
      ask,
    );
    const w = workspace({ delayMs: 20 });
    await make(provider, w.fn, { prefetchDirectory: false }).processMessage({ userMessage: request, memory: new WorkingMemory() });
    expect(w.calls).toHaveLength(2);
    expect(w.maxRunning()).toBe(2);
  });

  it('tells the model to use the directory before searching', () => {
    const prompt = buildSystemPrompt([...TRELLO_TOOLS, ...SLACK_TOOLS], undefined, { search: true });
    expect(prompt).toMatch(/__observed.*already.*looked up/is);
  });
});
