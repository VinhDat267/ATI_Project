import { describe, expect, it } from 'vitest';
import { AIPlanner, MockLLMProvider, WorkingMemory, type GatherSearchRequest } from '../src/index.js';
import { SLACK_TOOLS, TRELLO_TOOLS } from '@wap/tool-schemas';

const tools = [...TRELLO_TOOLS, ...SLACK_TOOLS];
const plan = {
  kind: 'plan', thinking: 't', summary: 's', warnings: [],
  steps: [{ id: 'card', tool: 'trello.create_card', description: 'Create', args: { listId: 'list_todo', title: 'Task' }, dependsOn: [] }],
};
const recorder = () => {
  const requests: GatherSearchRequest[] = [];
  const gatherSearch = async (request: GatherSearchRequest) => {
    requests.push(request);
    if (request.tool === 'trello.search_boards') return [{ id: 'b0', name: 'Frontend' }];
    if (request.tool === 'trello.search_lists') return [{ id: 'list_todo', name: 'To Do', boardId: 'b0' }];
    return [];
  };
  return { requests, gatherSearch };
};

describe('AIPlanner forwards the actor to every service lookup without reading it', () => {
  it('passes actor through regex gather rules', async () => {
    const { requests, gatherSearch } = recorder();
    const provider = new MockLLMProvider();
    provider.setPlanResponses([plan]);
    const planner = new AIPlanner({ provider, toolCatalog: tools, gatherSearch, searchMode: 'regex', requireGroundedResources: false });
    await planner.processMessage({ userMessage: 'Tạo thẻ trên board Frontend', memory: new WorkingMemory(), actor: { userId: 'user-a' } });
    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests) expect(request.actor).toEqual({ userId: 'user-a' });
  });

  it('passes actor through the directory prefetch and model-requested searches', async () => {
    const { requests, gatherSearch } = recorder();
    const provider = new MockLLMProvider();
    provider.setPlanResponses([{ kind: 'search', calls: [{ tool: 'trello.search_lists', args: { boardId: 'b0', query: 'To Do' } }] }, plan]);
    const planner = new AIPlanner({ provider, toolCatalog: tools, gatherSearch, searchMode: 'llm' });
    await planner.processMessage({ userMessage: 'Tạo thẻ Task trong Trello', memory: new WorkingMemory(), actor: { userId: 'user-b' } });
    expect(requests.map((r) => r.tool)).toContain('trello.search_boards');
    expect(requests.map((r) => r.tool)).toContain('trello.search_lists');
    for (const request of requests) expect(request.actor).toEqual({ userId: 'user-b' });
  });

  it('leaves actor undefined when the caller gives none', async () => {
    const { requests, gatherSearch } = recorder();
    const provider = new MockLLMProvider();
    provider.setPlanResponses([plan]);
    const planner = new AIPlanner({ provider, toolCatalog: tools, gatherSearch, searchMode: 'llm', requireGroundedResources: false });
    await planner.processMessage({ userMessage: 'Tạo thẻ Task trong Trello', memory: new WorkingMemory() });
    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests) expect(request.actor).toBeUndefined();
  });
});
