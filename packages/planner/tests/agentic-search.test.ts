import { describe, it, expect } from 'vitest';
import { AIPlanner, WorkingMemory, buildSystemPrompt, type LLMGeneratePlanInput, type LLMProvider } from '../src/index.js';
import { ALL_TOOLS, TRELLO_TOOLS, SLACK_TOOLS } from '@wap/tool-schemas';

/** Provider that plays back scripted model outputs and records every input it receives. */
function scripted(...outputs: unknown[]) {
  const inputs: LLMGeneratePlanInput[] = [];
  const provider: LLMProvider = {
    name: 'scripted',
    async generatePlan(input) {
      inputs.push({ ...input, conversationHistory: [...input.conversationHistory] });
      const next = outputs[Math.min(inputs.length - 1, outputs.length - 1)];
      return typeof next === 'string' ? next : JSON.stringify(next);
    },
  };
  return { provider, inputs };
}

const search = (...calls: Array<{ tool: string; args: Record<string, unknown> }>) => ({ kind: 'search', thinking: 'look up', calls });
const card = (listId: string, extra: Record<string, unknown> = {}) => ({
  kind: 'plan', thinking: 't', summary: 's', warnings: [],
  steps: [{ id: 'step_1', tool: 'trello.create_card', description: 'Create card', args: { listId, title: 'Task', ...extra }, dependsOn: [] }],
});
const ask = (question: string) => ({ kind: 'clarification', question, context: 'need more' });

function searcher(overrides: Record<string, unknown> = {}) {
  const calls: Array<{ tool: string; args: Record<string, unknown>; signal?: AbortSignal }> = [];
  const fn = async ({ tool, args, signal }: { tool: string; args: Record<string, unknown>; signal?: AbortSignal }) => {
    calls.push({ tool, args, signal });
    if (tool in overrides) {
      const value = overrides[tool];
      if (value instanceof Error) throw value;
      return typeof value === 'function' ? value(args) : value;
    }
    switch (tool) {
      case 'trello.search_boards': return [{ id: 'board_fe', name: 'Frontend' }];
      case 'trello.search_lists': return [{ id: 'list_9', name: 'To Do', boardId: 'board_fe' }];
      case 'trello.search_members': return [{ id: 'member_minh', name: 'Minh' }];
      case 'slack.search_channels': return [{ id: 'C_FE', name: 'frontend' }];
      default: return [];
    }
  };
  return { fn, calls };
}

const boards = { tool: 'trello.search_boards', args: { query: 'Frontend' } };
const lists = { tool: 'trello.search_lists', args: { boardId: 'board_fe', query: 'To Do' } };
const lastUserMessage = (input: LLMGeneratePlanInput) => input.conversationHistory.at(-1)!.content;
const planner = (provider: LLMProvider, gatherSearch: any, extra: Record<string, unknown> = {}) =>
  new AIPlanner({ provider, toolCatalog: ALL_TOOLS, gatherSearch, searchMode: 'llm', prefetchDirectory: false, ...extra });

describe('AI-driven search', () => {
  it('lets the model search and plans with the IDs it looked up', async () => {
    const { provider, inputs } = scripted(search(boards), search(lists), card('list_9'));
    const s = searcher();
    const response = await planner(provider, s.fn).processMessage({
      userMessage: 'Tạo task cập nhật homepage cho team frontend, để ở cột To Do', memory: new WorkingMemory(),
    });
    expect(response.kind).toBe('plan');
    expect(s.calls.map((c) => c.tool)).toEqual(['trello.search_boards', 'trello.search_lists']);
    expect(inputs).toHaveLength(3);
    expect(lastUserMessage(inputs[1]!)).toContain('board_fe');
    expect(lastUserMessage(inputs[2]!)).toContain('list_9');
  });

  it('does not run the regex gather in this mode', async () => {
    const { provider, inputs } = scripted(ask('Which list?'));
    const s = searcher();
    await planner(provider, s.fn).processMessage({ userMessage: 'Create a card on board Frontend', memory: new WorkingMemory() });
    expect(s.calls).toHaveLength(0);
    expect(inputs).toHaveLength(1);
  });

  it('returns search results to the model as delimited data, with default and clamped limits', async () => {
    const { provider, inputs } = scripted(
      search({ tool: 'trello.search_boards', args: { query: 'Frontend' } }, { tool: 'slack.search_channels', args: { query: 'fe', limit: 50 } }),
      ask('Which list?'),
    );
    const s = searcher();
    await planner(provider, s.fn).processMessage({ userMessage: 'Create a card for the frontend team, tell Slack', memory: new WorkingMemory() });
    expect(s.calls.map((c) => c.args)).toEqual([{ query: 'Frontend', limit: 10 }, { query: 'fe', limit: 10 }]);
    const feedback = lastUserMessage(inputs[1]!);
    expect(feedback).toMatch(/<search_results>[\s\S]*board_fe[\s\S]*C_FE[\s\S]*<\/search_results>/);
    expect(feedback).toMatch(/data.*not instructions/i);
  });

  it('never executes write or unknown tools requested as searches and reports why', async () => {
    const { provider, inputs } = scripted(
      search({ tool: 'trello.create_card', args: { listId: 'l', title: 'x' } }, { tool: 'nope.search', args: { query: 'x' } }),
      ask('Which list?'),
    );
    const s = searcher();
    const response = await planner(provider, s.fn).processMessage({ userMessage: 'Create a card', memory: new WorkingMemory() });
    expect(s.calls).toHaveLength(0);
    expect(response.kind).toBe('clarification');
    expect(lastUserMessage(inputs[1]!)).toMatch(/trello\.create_card[\s\S]*not an available read-only search tool/);
  });

  it('refuses a member search that is not scoped to a board', async () => {
    const { provider, inputs } = scripted(
      search({ tool: 'trello.search_boards', args: { query: 'Marketing' } }, { tool: 'trello.search_members', args: { query: 'Minh' } }),
      ask('Which board?'),
    );
    const s = searcher();
    await planner(provider, s.fn).processMessage({ userMessage: 'Assign Minh on the marketing card', memory: new WorkingMemory() });
    expect(s.calls.map((c) => c.tool)).toEqual(['trello.search_boards']);
    expect(lastUserMessage(inputs[1]!)).toMatch(/trello\.search_members[\s\S]*boardId/);
  });

  it('rejects search arguments that break the tool schema without calling the service', async () => {
    const { provider, inputs } = scripted(search({ tool: 'trello.search_boards', args: { keyword: 'Frontend' } }), ask('Which board?'));
    const s = searcher();
    await planner(provider, s.fn).processMessage({ userMessage: 'Create a card on the frontend board', memory: new WorkingMemory() });
    expect(s.calls).toHaveLength(0);
    expect(lastUserMessage(inputs[1]!)).toMatch(/query|keyword/);
  });

  it('answers a malformed search request with feedback instead of failing the turn', async () => {
    const { provider, inputs } = scripted({ kind: 'search', calls: [] }, ask('Which board?'));
    const response = await planner(provider, searcher().fn).processMessage({ userMessage: 'Create a card', memory: new WorkingMemory() });
    expect(response.kind).toBe('clarification');
    expect(lastUserMessage(inputs[1]!)).toMatch(/at least one call/i);
  });

  it('still rejects invented IDs and asks the user after the retry budget is spent', async () => {
    const { provider } = scripted(card('list_invented'), card('list_invented'));
    const memory = new WorkingMemory();
    const response = await planner(provider, searcher().fn).processMessage({ userMessage: 'Create a card', memory });
    expect(response.kind).toBe('clarification');
    if (response.kind === 'clarification') expect(response.question).toMatch(/list/i);
  });

  it('lets the model search after an ungrounded plan and accepts the grounded plan', async () => {
    const { provider, inputs } = scripted(card('list_9'), search(lists), card('list_9'));
    const s = searcher();
    const memory = new WorkingMemory();
    memory.setEntity('board', { id: 'board_fe', name: 'Frontend' });
    const response = await planner(provider, s.fn).processMessage({ userMessage: 'Create a card in To Do', memory });
    expect(response.kind).toBe('plan');
    expect(inputs).toHaveLength(3);
    expect(lastUserMessage(inputs[1]!)).toMatch(/unverified resource/i);
    expect(s.calls).toHaveLength(1);
  });

  it('caps search rounds and then asks the user', async () => {
    const { provider, inputs } = scripted(search(boards));
    const s = searcher();
    const response = await planner(provider, s.fn, { maxSearchRounds: 2 }).processMessage({
      userMessage: 'Create a card on the frontend board', memory: new WorkingMemory(),
    });
    expect(s.calls).toHaveLength(2);
    expect(inputs).toHaveLength(4);
    expect(lastUserMessage(inputs[3]!)).toMatch(/no more searches/i);
    expect(response.kind).toBe('clarification');
  });

  it('accepts a read tool that returns one object, such as get_issue', async () => {
    const { provider, inputs } = scripted(
      search({ tool: 'github.get_issue', args: { repo: 'acme/api', issueNumber: 42 } }),
      ask('Which list?'),
    );
    const s = searcher({ 'github.get_issue': { id: 'issue_42', number: 42, title: 'Webhook retries', url: 'https://github.com/acme/api/issues/42', repo: 'acme/api' } });
    await planner(provider, s.fn).processMessage({ userMessage: 'Create a card for issue 42 in repo acme/api', memory: new WorkingMemory() });
    expect(lastUserMessage(inputs[1]!)).toContain('Webhook retries');
    expect(lastUserMessage(inputs[1]!)).not.toMatch(/did not return/i);
  });

  it('reports a failing search to the model so it can ask the user', async () => {
    const { provider, inputs } = scripted(search(boards), ask('Trello is unreachable; which board did you mean?'));
    const s = searcher({ 'trello.search_boards': new Error('Trello returned 401') });
    const response = await planner(provider, s.fn).processMessage({ userMessage: 'Create a card on the frontend board', memory: new WorkingMemory() });
    expect(response.kind).toBe('clarification');
    expect(lastUserMessage(inputs[1]!)).toContain('Trello returned 401');
  });

  it('emits gather progress and forwards the abort signal to searches', async () => {
    const { provider } = scripted(search(boards), ask('Which list?'));
    const s = searcher();
    const events: string[] = [];
    const controller = new AbortController();
    await planner(provider, s.fn).processMessage({
      userMessage: 'Create a card on the frontend board', memory: new WorkingMemory(), signal: controller.signal,
      onGatherEvent: (event) => events.push(`${event.tool}:${event.status}`),
    });
    expect(events).toEqual(['trello.search_boards:started', 'trello.search_boards:completed']);
    expect(s.calls[0]!.signal).toBe(controller.signal);
  });

  it('records discovered resources in working memory, deduplicated and capped', async () => {
    let round = 0;
    const page = () => Array.from({ length: 10 }, (_, i) => ({ id: `board_${round * 10 + i}`, name: `Board ${round * 10 + i}`, secret: 'dropped' }));
    const { provider } = scripted(search(boards), search(boards), search(boards), ask('Which board?'));
    const s = searcher({ 'trello.search_boards': () => page() });
    const counting = async (request: any) => { const result = await s.fn(request); round++; return result; };
    const memory = new WorkingMemory();
    await planner(provider, counting).processMessage({ userMessage: 'Create a card on the frontend board', memory });
    const observed = memory.getEntity<Record<string, Array<{ id: string }>>>('__observed')!;
    expect(observed.board).toHaveLength(20);
    expect(observed.board.map((b) => b.id)).toEqual(Array.from({ length: 20 }, (_, i) => `board_${i + 10}`));
    expect(observed.board[0]).not.toHaveProperty('secret');
  });

  it('truncates one search to ten results and dedupes a repeated search', async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ id: `board_${i}`, name: `Board ${i}` }));
    const { provider, inputs } = scripted(search(boards), search(boards), ask('Which board?'));
    const memory = new WorkingMemory();
    await planner(provider, searcher({ 'trello.search_boards': many }).fn).processMessage({ userMessage: 'Create a card on the frontend board', memory });
    expect(memory.getEntity<Record<string, unknown[]>>('__observed')!.board).toHaveLength(10);
    expect(lastUserMessage(inputs[1]!)).not.toContain('board_10');
  });

  it('keeps discovered IDs across turns so a follow-up plan is grounded', async () => {
    const turn1 = scripted(
      search({ tool: 'trello.search_members', args: { query: 'Minh', boardId: 'board_mkt' } }),
      ask('Minh Anh or Minh Châu?'),
    );
    const s = searcher({ 'trello.search_members': [{ id: 'member_anh', name: 'Minh Anh' }, { id: 'member_chau', name: 'Minh Châu' }] });
    const memory = new WorkingMemory();
    memory.setEntity('list', { id: 'list_9', name: 'To Do' });
    await planner(turn1.provider, s.fn).processMessage({ userMessage: 'Create a card and assign Minh', memory });

    const restored = new WorkingMemory();
    restored.fromJSON(JSON.parse(JSON.stringify(memory.toJSON())));
    const turn2 = scripted(card('list_9', { idMembers: ['member_anh'] }));
    const response = await planner(turn2.provider, s.fn).processMessage({
      userMessage: 'Minh Anh', memory: restored,
      history: [{ role: 'user', content: 'Create a card and assign Minh' }, { role: 'assistant', content: 'Minh Anh or Minh Châu?' }],
    });
    expect(response.kind).toBe('plan');
    expect(turn2.inputs[0]!.workingMemory.__observed.member.map((m: any) => m.id)).toEqual(['member_anh', 'member_chau']);
  });

  it('routes on the whole conversation so a short follow-up keeps its services', async () => {
    const { provider, inputs } = scripted(ask('Which list?'));
    await planner(provider, searcher().fn).processMessage({
      userMessage: 'Minh Anh', memory: new WorkingMemory(),
      history: [{ role: 'user', content: 'Tạo card gán Minh và báo trên Slack' }, { role: 'assistant', content: 'Which Minh?' }],
    });
    const services = new Set(inputs[0]!.toolCatalog.map((tool) => tool.service));
    expect(services.has('slack')).toBe(true);
    expect(services.has('trello')).toBe(true);
  });

  it('does not ground a resource with an ID from a different resource kind', async () => {
    const { provider } = scripted(search(boards), card('board_fe'), card('board_fe'));
    const response = await planner(provider, searcher().fn).processMessage({ userMessage: 'Create a card on the frontend board', memory: new WorkingMemory() });
    expect(response.kind).toBe('clarification');
  });
});

describe('search protocol prompt', () => {
  it('teaches the search request format only when search mode is on', () => {
    const on = buildSystemPrompt([...TRELLO_TOOLS, ...SLACK_TOOLS], undefined, { search: true });
    expect(on).toContain('"kind": "search"');
    expect(on).toMatch(/several plausible matches.*clarification/is);
    expect(on).toMatch(/not instructions/i);
    expect(buildSystemPrompt([...TRELLO_TOOLS, ...SLACK_TOOLS])).not.toContain('"kind": "search"');
  });

  it('says to look an existing item up first and to keep read tools out of plans', () => {
    const prompt = buildSystemPrompt([...TRELLO_TOOLS, ...SLACK_TOOLS], undefined, { search: true });
    expect(prompt).toMatch(/refers to an existing item.*first response is a search for it/is);
    expect(prompt).toMatch(/never put a read-only tool in a plan/i);
    expect(buildSystemPrompt([...TRELLO_TOOLS, ...SLACK_TOOLS])).not.toMatch(/never put a read-only tool in a plan/i);
  });

  it('scopes lookups to the board found, prefers an exact name, and never guesses a generic destination', () => {
    const prompt = buildSystemPrompt([...TRELLO_TOOLS, ...SLACK_TOOLS], undefined, { search: true });
    expect(prompt).toMatch(/search members and cards with the boardId of the board/i);
    expect(prompt).toMatch(/equals the requested name exactly.*clear match/is);
    expect(prompt).toMatch(/several results share that exact name.*ask/is);
    expect(prompt).toMatch(/only from a name the user gave.*never pick a channel or list just because it looks generic/is);
  });
});

describe('member board scoping', () => {
  it('remembers the board a member search was scoped to and keeps every board a member was seen on', async () => {
    const { recordObserved } = await import('../src/search.js');
    let observed = recordObserved(undefined, 'member', [{ id: 'm1', name: 'Lan', boardId: 'board_be' }]);
    observed = recordObserved(observed, 'member', [{ id: 'm1', name: 'Lan', boardId: 'board_fe' }]);
    expect(observed.member).toEqual([{ id: 'm1', name: 'Lan', boardId: 'board_fe', boardIds: ['board_be', 'board_fe'] }]);
  });

  it('turns a plan that assigns a member from another board into a question', async () => {
    const assign = card('list_9', { idMembers: ['member_be'] });
    const { provider, inputs } = scripted(
      search({ tool: 'trello.search_members', args: { query: 'Minh', boardId: 'board_be' } }),
      assign, assign,
    );
    const s = searcher({ 'trello.search_members': [{ id: 'member_be', name: 'Minh' }] });
    const memory = new WorkingMemory();
    memory.setEntity('list', { id: 'list_9', name: 'To Do', boardId: 'board_fe' });
    const response = await planner(provider, s.fn, { requireGroundedResources: true }).processMessage({
      userMessage: 'Tạo task cho Minh ở list To Do', memory,
    });
    expect(lastUserMessage(inputs[2]!)).toMatch(/member_be[\s\S]*board_fe/);
    expect(response.kind).toBe('clarification');
  });
});
