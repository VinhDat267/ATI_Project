import { describe, it, expect } from 'vitest';
import {
  AIPlanner,
  MockLLMProvider,
  WorkingMemory,
  classifyIntent,
  buildSystemPrompt,
} from '../src/index.js';
import { TRELLO_TOOLS, SLACK_TOOLS, GITHUB_TOOLS, SERVICE_REGISTRY, type ServiceDefinition, type ToolDefinition } from '@wap/tool-schemas';

describe('packages/planner (Task 10: Hierarchical Router & Planner with 1x Automatic Retry)', () => {
  const tools = [...TRELLO_TOOLS, ...SLACK_TOOLS];

  it('uses the catalogued Slack channel argument in its few-shot example', () => {
    const prompt = buildSystemPrompt(tools);
    expect(prompt).toContain('"channel": "C0123456789"');
    expect(prompt).not.toContain('"channelId": "C0123456789"');
  });

  it('always specifies the plan step format, even when the cross-service example is not shown', () => {
    for (const catalog of [GITHUB_TOOLS, SLACK_TOOLS, TRELLO_TOOLS.filter((tool) => tool.name !== 'trello.add_member')]) {
      const prompt = buildSystemPrompt(catalog);
      expect(prompt).not.toContain('#### Example: Cross-step reference');
      expect(prompt).toContain('{ "id": string, "tool": string, "description": string, "args": object, "dependsOn": string[] }');
      expect(prompt).toMatch(/"args".*never "arguments"/);
    }
  });

  it('asks for a short, minified answer because output length dominates latency', () => {
    const prompt = buildSystemPrompt(tools);
    expect(prompt).toMatch(/minified on a single line/i);
    expect(prompt).toMatch(/thinking.*one short sentence.*at most 15 words/is);
    expect(prompt).toMatch(/description.*at most 8 words/is);
  });

  it('limits brevity to wording and never to the arguments a request implies', () => {
    const prompt = buildSystemPrompt(tools);
    expect(prompt).toMatch(/brevity applies to wording.*never omit.*argument/is);
    expect(prompt).not.toMatch(/Keep it short: the answer/);
  });

  it('tells the model that resource IDs must come from working memory, the user or a $ref', () => {
    const prompt = buildSystemPrompt(tools);
    expect(prompt).toMatch(/x-resource/);
    expect(prompt).toMatch(/never invent/i);
  });

  describe('current date context', () => {
    const tuesdayMorningHanoi = { now: new Date('2026-09-29T03:00:00Z'), timeZone: 'Asia/Ho_Chi_Minh' };

    it('states today in the configured time zone with its UTC offset', () => {
      const prompt = buildSystemPrompt(tools, tuesdayMorningHanoi);
      expect(prompt).toContain('Today is 2026-09-29, thứ 3 / Tuesday, time zone Asia/Ho_Chi_Minh (UTC+07:00)');
    });

    it('lists the next seven days with Vietnamese and English weekday names', () => {
      const prompt = buildSystemPrompt(tools, tuesdayMorningHanoi);
      expect(prompt).toContain('- thứ 6 / Friday: 2026-10-02');
      expect(prompt).toContain('- chủ nhật / Sunday: 2026-10-04');
      expect(prompt).toContain('- thứ 2 / Monday: 2026-10-05');
      expect(prompt).toContain('- ngày mai / tomorrow: 2026-09-30');
      expect(prompt).toMatch(/due.*ISO-8601.*\+07:00/s);
    });

    it('uses the local calendar day when UTC is still on the previous day', () => {
      const prompt = buildSystemPrompt(tools, { now: new Date('2026-09-29T20:00:00Z'), timeZone: 'Asia/Ho_Chi_Minh' });
      expect(prompt).toContain('Today is 2026-09-30, thứ 4 / Wednesday');
      expect(prompt).toContain('- thứ 6 / Friday: 2026-10-02');
    });

    it('gives the model the planner clock and time zone', async () => {
      const provider = new MockLLMProvider();
      provider.setPlanResponses([{ kind: 'refusal', reason: 'n/a' }]);
      const planner = new AIPlanner({ provider, toolCatalog: tools, now: () => new Date('2026-12-31T18:00:00Z'), timeZone: 'Asia/Ho_Chi_Minh' });
      await planner.processMessage({ userMessage: 'Tạo card deadline thứ 6', memory: new WorkingMemory() });
      expect(provider.getLastInput()?.systemPrompt).toContain('Today is 2027-01-01, thứ 6 / Friday');
    });
  });

  it('gathers a single board match before planning and passes its ID in working memory', async () => {
    const provider = new MockLLMProvider();
    provider.setPlanResponses([{ kind: 'clarification', question: 'Which list?', context: 'Need a list' }]);
    const memory = new WorkingMemory();
    const calls: string[] = [];
    const planner = new AIPlanner({ provider, toolCatalog: tools,
      gatherSearch: async ({ tool, args }) => {
        calls.push(`${tool}:${args.query}`);
        return [{ id: 'board_1', name: 'Frontend' }];
      },
    });
    await planner.processMessage({ userMessage: 'Create a card on board Frontend', memory });
    expect(calls).toEqual(['trello.search_boards:Frontend']);
    expect(memory.getEntity('board')).toEqual({ id: 'board_1', name: 'Frontend' });
    expect(provider.getLastInput()?.workingMemory.board).toEqual({ id: 'board_1', name: 'Frontend' });
  });

  it('asks for a board before searching a named member', async () => {
    const provider = new MockLLMProvider();
    const searches: string[] = [];
    const planner = new AIPlanner({ provider, toolCatalog: tools, gatherSearch: async ({ tool }) => {
      searches.push(tool);
      return [{ id: 'm1', name: 'Minh' }];
    } });
    const memory = new WorkingMemory();
    const response = await planner.processMessage({ userMessage: 'Gán Minh vào task', memory });
    expect(response.kind).toBe('clarification');
    expect(searches).toEqual([]);
    expect(provider.getCallCount()).toBe(0);
  });

  it('resumes the original member request after the user names an allowed board', async () => {
    const provider = new MockLLMProvider();
    provider.setPlanResponses([{ kind: 'clarification', question: 'Which list?', context: 'Need a list' }]);
    const searches: Array<{ tool: string; boardId?: unknown }> = [];
    const planner = new AIPlanner({ provider, toolCatalog: tools, gatherSearch: async ({ tool, args }) => {
      searches.push({ tool, boardId: args.boardId });
      return tool === 'trello.search_boards'
        ? [{ id: 'board-1', name: 'Frontend' }]
        : [{ id: 'member-1', name: 'Minh' }];
    } });
    const memory = new WorkingMemory();
    await planner.processMessage({ userMessage: 'Gán Minh vào task', memory });
    await planner.processMessage({ userMessage: 'Frontend', memory });
    expect(searches).toEqual([
      { tool: 'trello.search_boards', boardId: undefined },
      { tool: 'trello.search_members', boardId: 'board-1' },
    ]);
    expect(provider.getLastInput()?.conversationHistory.at(-1)?.content).toContain('Gán Minh vào task');
  });

  it('clarifies ambiguous search results and resolves the selected option on the next turn', async () => {
    const provider = new MockLLMProvider();
    provider.setPlanResponses([{ kind: 'clarification', question: 'Which list?', context: 'Need a list' }]);
    const memory = new WorkingMemory();
    const planner = new AIPlanner({ provider, toolCatalog: tools,
      gatherSearch: async () => [
        { id: 'board_1', name: 'Frontend A' }, { id: 'board_2', name: 'Frontend B' },
      ],
    });
    const first = await planner.processMessage({ userMessage: 'Create a card on board Frontend', memory });
    expect(first.kind).toBe('clarification');
    expect(provider.getCallCount()).toBe(0);
    expect(memory.toJSON()).toHaveProperty('__gatherPending');
    const restored = new WorkingMemory();
    restored.fromJSON(memory.toJSON());
    await planner.processMessage({ userMessage: 'Frontend B', memory: restored });
    expect(restored.getEntity('board')).toEqual({ id: 'board_2', name: 'Frontend B' });
    expect(restored.toJSON()).not.toHaveProperty('__gatherPending');
    expect(provider.getCallCount()).toBe(1);
  });

  it('routes and prompts from the original workflow after a clarification answer', async () => {
    const provider = new MockLLMProvider();
    provider.setPlanResponses([{ kind: 'clarification', question: 'Which list?', context: 'Need a list' }]);
    const planner = new AIPlanner({ provider, toolCatalog: tools, gatherSearch: async () => [
      { id: 'b1', name: 'Frontend A' }, { id: 'b2', name: 'Frontend Slack' },
    ] });
    const memory = new WorkingMemory();
    const intent = 'Create a card on board Frontend';
    await planner.processMessage({ userMessage: intent, memory });
    await planner.processMessage({ userMessage: 'Frontend Slack', memory });

    const input = provider.getLastInput();
    expect(input?.toolCatalog.every((tool) => tool.service === 'trello')).toBe(true);
    expect(input?.conversationHistory.at(-1)?.content).toContain(intent);
    expect(input?.conversationHistory.at(-1)?.content).toContain('Frontend Slack');
    expect(input?.workingMemory.board.id).toBe('b2');
  });

  it('asks for correction when search finds no board, without planning', async () => {
    const provider = new MockLLMProvider();
    const planner = new AIPlanner({ provider, toolCatalog: tools, gatherSearch: async () => [] });
    const response = await planner.processMessage({
      userMessage: 'Create a card on board Missing', memory: new WorkingMemory(),
    });
    expect(response.kind).toBe('clarification');
    expect(provider.getCallCount()).toBe(0);
  });

  it('uses a corrected name after an empty search while retaining the original intent', async () => {
    const provider = new MockLLMProvider();
    provider.setPlanResponses([{ kind: 'clarification', question: 'Which list?', context: 'Need a list' }]);
    const queries: string[] = [];
    const memory = new WorkingMemory();
    const planner = new AIPlanner({ provider, toolCatalog: tools, gatherSearch: async ({ args }) => {
      queries.push(String(args.query));
      return args.query === 'Missing' ? [] : [{ id: 'board_3', name: 'Found' }];
    } });
    await planner.processMessage({ userMessage: 'Create a card on board Missing', memory });
    await planner.processMessage({ userMessage: 'Found', memory });
    expect(queries).toEqual(['Missing', 'Found']);
    expect(memory.getEntity('board')).toEqual({ id: 'board_3', name: 'Found' });
    expect(provider.getCallCount()).toBe(1);
  });

  it('refreshes a resolved board when a later turn names a different board', async () => {
    const provider = new MockLLMProvider();
    provider.setPlanResponses([{ kind: 'clarification', question: 'Which list?', context: 'Need a list' }]);
    const memory = new WorkingMemory();
    const searches: string[] = [];
    const planner = new AIPlanner({ provider, toolCatalog: tools, gatherSearch: async ({ args }) => {
      const query = String(args.query);
      searches.push(query);
      return [{ id: `id_${query}`, name: query }];
    } });
    await planner.processMessage({ userMessage: 'Create a card on board Alpha', memory });
    await planner.processMessage({ userMessage: 'Create a card on board Beta', memory });
    expect(searches).toEqual(['Alpha', 'Beta']);
    expect(memory.getEntity('board')).toEqual({ id: 'id_Beta', name: 'Beta' });
  });

  describe('Hierarchical Router (classifyIntent)', () => {
    it('routes requests to specific services based on intent keywords', () => {
      const trelloOnly = classifyIntent('Tạo card mới trên board Frontend');
      expect(trelloOnly).toContain('trello');
      expect(trelloOnly).not.toContain('slack');

      const slackOnly = classifyIntent('Gửi tin nhắn vào kênh general');
      expect(slackOnly).toContain('slack');
      expect(slackOnly).not.toContain('trello');

      const crossService = classifyIntent('Tạo task Trello và báo qua Slack');
      expect(crossService).toContain('trello');
      expect(crossService).toContain('slack');

      const ambiguous = classifyIntent('Giúp tôi giải quyết công việc này');
      expect(ambiguous).toContain('trello');
      expect(ambiguous).toContain('slack');
    });

    it('routes GitHub intent from registered metadata and only offers connected catalog tools', () => {
      const catalog = [...tools, ...GITHUB_TOOLS];
      expect(classifyIntent('Create issue in GitHub repository acme/app', catalog)).toEqual(['github']);
      expect(classifyIntent('Create GitHub issue, Trello card and notify Slack', catalog)).toEqual(['trello', 'slack', 'github']);
      expect(classifyIntent('Create GitHub issue', tools)).toEqual([]);
      expect(classifyIntent('Create GitHub issue and Trello card', tools)).toEqual([]);
    });

    it('prefers explicitly named services over generic task and notification words', () => {
      expect(classifyIntent('Create a GitHub issue for task X', GITHUB_TOOLS)).toEqual(['github']);
      expect(classifyIntent('Send a Slack message about task X', SLACK_TOOLS)).toEqual(['slack']);
      expect(classifyIntent('Tạo GitHub issue để báo lỗi cho task X', GITHUB_TOOLS)).toEqual(['github']);
      expect(classifyIntent('Create issue for task X', GITHUB_TOOLS)).toEqual(['github']);
      expect(classifyIntent('Send a message about task X', SLACK_TOOLS)).toEqual(['slack']);
      expect(classifyIntent('Create card for a task and notify Slack', [...tools, ...GITHUB_TOOLS])).toEqual(['trello', 'slack']);
      expect(classifyIntent('Create a GitHub issue and a Trello card', GITHUB_TOOLS)).toEqual([]);
    });

    it.each([
      'Tạo task cập nhật homepage cho team frontend, deadline thứ 6, gán Minh, báo trên Slack',
      'Create a task to update the homepage for the frontend team, due Friday, assign Minh, notify Slack',
      'Tạo một task mới cho Minh rồi gửi tin nhắn cho team',
      'Giao việc sửa CSS cho Minh và thông báo kênh frontend',
    ])('routes a task-creation request to Trello even when another service is named: %s', (message) => {
      expect(classifyIntent(message, tools)).toEqual(['trello', 'slack']);
    });

    it('supports task-creation phrasing declared by a newly registered service', () => {
      const jira: ServiceDefinition = {
        id: 'jira', name: 'Jira', description: 'Issue tracking', scopes: [], scopeKey: 'repos',
        credentialFields: [], intentKeywords: [], intentPatterns: [/\bopen\s+a\s+ticket\b/iu],
      };
      const jiraTool: ToolDefinition = {
        name: 'jira.create_ticket', service: 'jira', description: 'Create Jira ticket', sideEffect: 'write',
        riskLevel: 'low', inputSchema: { type: 'object' }, outputSchema: { type: 'object' },
      };
      expect(classifyIntent('Open a ticket and notify Slack', [...SLACK_TOOLS, jiraTool], [...SERVICE_REGISTRY.filter(service => service.id !== 'jira'), jira]))
        .toEqual(['slack', 'jira']);
    });

    it('supports a newly registered service without another router branch', () => {
      const jira: ServiceDefinition = {
        id: 'jira', name: 'Jira', description: 'Issue tracking', scopes: [], scopeKey: 'repos',
        credentialFields: [], intentKeywords: ['jira', 'ticket'],
      };
      const jiraTool: ToolDefinition = {
        name: 'jira.create_ticket', service: 'jira', description: 'Create Jira ticket', sideEffect: 'write',
        riskLevel: 'low', inputSchema: { type: 'object' }, outputSchema: { type: 'object' },
      };
      expect(classifyIntent('Open a Jira ticket', [jiraTool], [...SERVICE_REGISTRY.filter(service => service.id !== 'jira'), jira])).toEqual(['jira']);
      expect(classifyIntent('Open a Jira ticket', tools, [...SERVICE_REGISTRY.filter(service => service.id !== 'jira'), jira])).toEqual([]);
    });
  });

  it('gathers a GitHub repository and exposes its verified owner/repo in memory', async () => {
    const provider = new MockLLMProvider();
    provider.setPlanResponses([{ kind: 'clarification', question: 'Which issue?', context: 'Need issue detail' }]);
    const memory = new WorkingMemory();
    const searches: Array<{ tool: string; query: unknown }> = [];
    const planner = new AIPlanner({ provider, toolCatalog: [...tools, ...GITHUB_TOOLS],
      gatherSearch: async ({ tool, args }) => {
        searches.push({ tool, query: args.query });
        return [{ id: '42', name: 'app', fullName: 'acme/app', url: 'https://github.com/acme/app' }];
      },
    });
    await planner.processMessage({ userMessage: 'Create GitHub issue in repo acme/app', memory });
    expect(searches).toEqual([{ tool: 'github.search_repos', query: 'acme/app' }]);
    expect(memory.getEntity('repository')).toMatchObject({ id: '42', fullName: 'acme/app' });
    expect(provider.getLastInput()?.toolCatalog.every((tool) => tool.service === 'github')).toBe(true);
  });

  it('uses a newly registered read tool for gather without planner service branches', async () => {
    const jira: ServiceDefinition = {
      id: 'jira', name: 'Jira', description: 'Issue tracking', scopes: [], scopeKey: 'repos',
      credentialFields: [], intentKeywords: ['jira'],
      gatherRules: [{ entityKey: 'ticket', tool: 'jira.search_tickets', pattern: /\bticket\s+([\w-]+)/iu }],
    };
    const jiraSearch: ToolDefinition = {
      name: 'jira.search_tickets', service: 'jira', description: 'Search tickets', sideEffect: 'read',
      riskLevel: 'low', inputSchema: { type: 'object' }, outputSchema: { type: 'array' },
    };
    const provider = new MockLLMProvider();
    provider.setPlanResponses([{ kind: 'clarification', question: 'Next action?', context: 'Ticket resolved' }]);
    const memory = new WorkingMemory();
    const queries: string[] = [];
    const planner = new AIPlanner({ provider, toolCatalog: [jiraSearch], serviceRegistry: [...SERVICE_REGISTRY.filter(service => service.id !== 'jira'), jira],
      gatherSearch: async ({ tool, args }) => {
        queries.push(`${tool}:${args.query}`);
        return [{ id: 'JIRA-42', name: 'ABC-42' }];
      },
    });
    await planner.processMessage({ userMessage: 'Find Jira ticket ABC-42', memory });
    expect(queries).toEqual(['jira.search_tickets:ABC-42']);
    expect(memory.getEntity('ticket')).toEqual({ id: 'JIRA-42', name: 'ABC-42' });
    expect(provider.getLastInput()?.toolCatalog.map((tool) => tool.name)).toEqual(['jira.search_tickets']);
  });

  it('refuses a configured service intent when its tools are absent from the active catalog', async () => {
    const provider = new MockLLMProvider();
    const planner = new AIPlanner({ provider, toolCatalog: tools });
    const response = await planner.processMessage({ userMessage: 'Create GitHub issue', memory: new WorkingMemory() });
    expect(response.kind).toBe('refusal');
    expect(provider.getCallCount()).toBe(0);
  });

  it('validates a dependent GitHub to Trello to Slack plan against the active catalog', async () => {
    const provider = new MockLLMProvider();
    provider.setPlanResponses([{
      kind: 'plan', thinking: 'Create an issue, link it from a card, then post the card.',
      summary: 'Create GitHub issue, Trello card and Slack notice', warnings: [],
      steps: [
        { id: 'issue', tool: 'github.create_issue', description: 'Create issue',
          args: { repo: 'acme/app', title: 'Fix login' }, dependsOn: [] },
        { id: 'card', tool: 'trello.create_card', description: 'Create linked card',
          args: { listId: 'list_1', title: 'Fix login', desc: { $template: 'Issue: ${issue.output.url}' } }, dependsOn: ['issue'] },
        { id: 'notice', tool: 'slack.send_message', description: 'Notify team',
          args: { channel: 'C1', text: { $template: 'Card: ${card.output.url}' } }, dependsOn: ['card'] },
      ],
    }]);
    const planner = new AIPlanner({ provider, toolCatalog: [...tools, ...GITHUB_TOOLS] });
    const memory = new WorkingMemory();
    memory.setEntity('repository', { id: '42', name: 'app', fullName: 'acme/app' });
    memory.setEntity('list', { id: 'list_1', name: 'To Do' });
    memory.setEntity('channel', { id: 'C1', name: 'general' });
    const response = await planner.processMessage({
      userMessage: 'Create GitHub issue, Trello card and notify Slack', memory,
    });
    expect(response.kind).toBe('plan');
    expect(provider.getCallCount()).toBe(1);
    expect(new Set(provider.getLastInput()?.toolCatalog.map((tool) => tool.service))).toEqual(new Set(['trello', 'slack', 'github']));
  });

  describe('resource grounding', () => {
    const inventedPlan = {
      kind: 'plan', thinking: 'Create a card and notify', summary: 'Create card and notify', warnings: [],
      steps: [{ id: 'step_1', tool: 'trello.create_card', description: 'Create card',
        args: { listId: 'list_frontend_todo', title: 'Update homepage' }, dependsOn: [] }],
    };
    const request = 'Tạo task cập nhật homepage cho team frontend, báo trên Slack';

    it('asks the user instead of returning a plan when the model keeps inventing resource IDs', async () => {
      const provider = new MockLLMProvider();
      provider.setPlanResponses([inventedPlan, inventedPlan]);
      const memory = new WorkingMemory();
      const planner = new AIPlanner({ provider, toolCatalog: tools });
      const response = await planner.processMessage({ userMessage: request, memory });
      expect(provider.getCallCount()).toBe(2);
      expect(response.kind).toBe('clarification');
      if (response.kind === 'clarification') expect(response.question).toMatch(/list/i);
      expect(memory.getEntity('__gatherIntent')).toBe(request);
    });

    it('feeds unverified arguments back to the model and accepts a grounded retry', async () => {
      const provider = new MockLLMProvider();
      provider.setPlanResponses([inventedPlan, {
        ...inventedPlan, steps: [{ ...inventedPlan.steps[0], args: { listId: 'list_9', title: 'Update homepage' } }],
      }]);
      const memory = new WorkingMemory();
      memory.setEntity('list', { id: 'list_9', name: 'To Do' });
      const planner = new AIPlanner({ provider, toolCatalog: tools });
      const response = await planner.processMessage({ userMessage: request, memory });
      expect(response.kind).toBe('plan');
      expect(provider.getLastInput()?.conversationHistory.at(-1)?.content).toMatch(/grounding.*listId/is);
    });

    it('resumes the original cross-service intent after a grounding clarification', async () => {
      const provider = new MockLLMProvider();
      provider.setPlanResponses([inventedPlan, inventedPlan]);
      const memory = new WorkingMemory();
      const planner = new AIPlanner({ provider, toolCatalog: tools, gatherSearch: async ({ tool }) =>
        tool === 'trello.search_boards' ? [{ id: 'board_1', name: 'Frontend' }] : [{ id: 'list_9', name: 'To Do' }] });
      await planner.processMessage({ userMessage: request, memory });
      provider.reset();
      provider.setPlanResponses([{ kind: 'clarification', question: 'Which channel?', context: 'Need a channel' }]);
      await planner.processMessage({ userMessage: 'board Frontend list To Do', history: [{ role: 'user', content: request }], memory });
      const input = provider.getLastInput();
      expect(new Set(input?.toolCatalog.map((tool) => tool.service))).toEqual(new Set(['trello', 'slack']));
      expect(input?.conversationHistory.at(-1)?.content).toContain(request);
      expect(input?.workingMemory.list).toEqual({ id: 'list_9', name: 'To Do' });
    });

    it('accepts an identifier the user supplies in reply and consumes the pending intent', async () => {
      const provider = new MockLLMProvider();
      provider.setPlanResponses([inventedPlan, inventedPlan]);
      const memory = new WorkingMemory();
      const planner = new AIPlanner({ provider, toolCatalog: tools });
      await planner.processMessage({ userMessage: request, memory });
      provider.reset();
      provider.setPlanResponses([inventedPlan]);
      const response = await planner.processMessage({
        userMessage: 'list_frontend_todo', history: [{ role: 'user', content: request }], memory,
      });
      expect(response.kind).toBe('plan');
      expect(memory.getEntity('__gatherIntent')).toBeUndefined();
    });

    it('can be disabled for canned sandbox providers that never read working memory', async () => {
      const provider = new MockLLMProvider();
      provider.setPlanResponses([inventedPlan]);
      const planner = new AIPlanner({ provider, toolCatalog: tools, requireGroundedResources: false });
      const response = await planner.processMessage({ userMessage: request, memory: new WorkingMemory() });
      expect(response.kind).toBe('plan');
      expect(provider.getCallCount()).toBe(1);
    });
  });

  describe('AIPlanner with 1x Retry', () => {
    const memoryWithList = () => {
      const memory = new WorkingMemory();
      memory.setEntity('list', { id: 'l1', name: 'To Do' });
      memory.setEntity('member', { id: 'm1', name: 'Minh' });
      return memory;
    };

    it('returns plan directly on first call when valid without retrying', async () => {
      const mockLLM = new MockLLMProvider();
      mockLLM.setPlanResponses([
        {
          kind: 'plan',
          thinking: 'Direct valid plan reasoning',
          summary: 'Valid plan on first shot',
          steps: [
            {
              id: 'step_1',
              tool: 'trello.create_card',
              description: 'Create card',
              args: { listId: 'l1', title: 'Task' },
              dependsOn: [],
            },
          ],
          warnings: [],
        },
      ]);

      const planner = new AIPlanner({ provider: mockLLM, toolCatalog: tools });
      const response = await planner.processMessage({
        userMessage: 'Tạo card',
        history: [],
        memory: memoryWithList(),
      });

      expect(mockLLM.getCallCount()).toBe(1);
      expect(response.kind).toBe('plan');
      if (response.kind === 'plan') {
        expect(response.summary).toBe('Valid plan on first shot');
      }
    });

    it('retries exactly once when first attempt fails validation, succeeding on second attempt', async () => {
      const mockLLM = new MockLLMProvider();
      mockLLM.setPlanResponses([
        // First attempt: broken $ref (step_99 does not exist)
        {
          kind: 'plan',
          thinking: 'Attempt 1 reasoning',
          summary: 'Broken ref plan',
          steps: [
            {
              id: 'step_1',
              tool: 'trello.add_member',
              description: 'Add member with invalid ref',
              args: { cardId: { $ref: 'step_99.output.id' }, memberId: 'm1' },
              dependsOn: [],
            },
          ],
          warnings: [],
        },
        // Second attempt: fixed plan with valid step
        {
          kind: 'plan',
          thinking: 'Attempt 2 reasoning: corrected ref',
          summary: 'Corrected plan on retry',
          steps: [
            {
              id: 'step_1',
              tool: 'trello.create_card',
              description: 'Create card directly',
              args: { listId: 'l1', title: 'Task' },
              dependsOn: [],
            },
          ],
          warnings: [],
        },
      ]);

      const planner = new AIPlanner({ provider: mockLLM, toolCatalog: tools });
      const response = await planner.processMessage({
        userMessage: 'Tạo card và thêm member',
        history: [],
        memory: memoryWithList(),
      });

      expect(mockLLM.getCallCount()).toBe(2);
      expect(response.kind).toBe('plan');
      if (response.kind === 'plan') {
        expect(response.summary).toBe('Corrected plan on retry');
      }
    });

    it('throws an error if both initial attempt and retry fail validation', async () => {
      const mockLLM = new MockLLMProvider();
      mockLLM.setPlanResponses([
        { kind: 'plan', thinking: 'fail 1', summary: 'fail', steps: [{ id: 'step_1', tool: 'nonexistent.tool', description: 'desc', args: {}, dependsOn: [] }] },
        { kind: 'plan', thinking: 'fail 2', summary: 'fail again', steps: [{ id: 'step_1', tool: 'nonexistent.tool', description: 'desc', args: {}, dependsOn: [] }] },
      ]);

      const planner = new AIPlanner({ provider: mockLLM, toolCatalog: tools });
      await expect(
        planner.processMessage({
          userMessage: 'Test persistent failure',
          history: [],
          memory: new WorkingMemory(),
        })
      ).rejects.toThrow(/Validation failed after retry/i);

      expect(mockLLM.getCallCount()).toBe(2);
    });
  });
});
