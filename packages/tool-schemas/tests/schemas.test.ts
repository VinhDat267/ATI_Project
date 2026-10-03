import { describe, it, expect } from 'vitest';
import {
  ALL_TOOLS,
  TRELLO_TOOLS,
  SLACK_TOOLS,
  GITHUB_TOOLS,
  SERVICE_REGISTRY,
  getServiceDefinition,
  getToolDefinition,
  type ToolDefinition,
  type PlanResponse,
  type ClarificationResponse,
  type RefusalResponse,
  type PlannerResponse,
} from '../src/index.js';

describe('packages/tool-schemas (Task 2)', () => {
  it('exports 33 unique tools across eight registered services', () => {
    expect(ALL_TOOLS).toHaveLength(33);
    expect(TRELLO_TOOLS).toHaveLength(9);
    expect(SLACK_TOOLS).toHaveLength(2);
    expect(GITHUB_TOOLS).toHaveLength(5);

    const names = ALL_TOOLS.map((t) => t.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(33);
    expect(new Set(SERVICE_REGISTRY.map((service) => service.id)).size).toBe(8);
    for (const tool of ALL_TOOLS) {
      expect(getServiceDefinition(tool.service)).toBeDefined();
    }
  });

  it('publishes GitHub credentials, repository scope and executable tool contracts', () => {
    const github = getServiceDefinition('github');
    expect(github?.scopeKey).toBe('repos');
    expect(github?.credentialFields).toEqual([{ key: 'token', label: 'Personal access token', type: 'password' }]);
    expect(GITHUB_TOOLS.map((tool) => tool.name)).toEqual([
      'github.search_repos', 'github.search_issues', 'github.get_issue', 'github.create_issue', 'github.add_label',
    ]);
    expect(getToolDefinition('github.create_issue')?.inputSchema.required).toEqual(['repo', 'title']);
    expect(getToolDefinition('github.create_issue')?.outputSchema.properties.url.type).toBe('string');
    expect(getToolDefinition('github.add_label')?.inputSchema.required).toEqual(['repo', 'issueNumber', 'label']);
    expect(getToolDefinition('github.search_repos')?.sideEffect).toBe('read');
    expect(getToolDefinition('github.create_issue')?.sideEffect).toBe('write');
  });

  it('should retrieve tools by name using getToolDefinition', () => {
    const createCard = getToolDefinition('trello.create_card');
    expect(createCard).toBeDefined();
    expect(createCard?.service).toBe('trello');
    expect(createCard?.sideEffect).toBe('write');
    expect(createCard?.riskLevel).toBe('low');

    const sendMessage = getToolDefinition('slack.send_message');
    expect(sendMessage).toBeDefined();
    expect(sendMessage?.service).toBe('slack');
    expect(sendMessage?.sideEffect).toBe('write');
    expect(sendMessage?.riskLevel).toBe('medium');

    expect(getToolDefinition('unknown.tool')).toBeUndefined();
  });

  it('bounds search tools by directory limit10 or explicit search limit20', () => {
    const readTools = ALL_TOOLS.filter((t) => t.sideEffect === 'read');
    expect(readTools).toHaveLength(19);

    for (const tool of readTools) {
      expect(tool.riskLevel).toBe('low');
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.outputSchema).toBeDefined();

      if (tool.name.includes('.search_')) {
        expect(tool.inputSchema.properties.limit).toBeDefined();
        expect(tool.inputSchema.properties.limit.maximum).toBeLessThanOrEqual(tool.listable ? 10 : 20);
      }
    }
  });

  it('should enforce write tools risk levels per spec v3', () => {
    const writeTools = ALL_TOOLS.filter((t) => t.sideEffect === 'write');
    expect(writeTools).toHaveLength(14);

    // Trello writes are low risk
    const trelloWrites = writeTools.filter((t) => t.service === 'trello');
    expect(trelloWrites).toHaveLength(4);
    for (const tool of trelloWrites) {
      expect(tool.riskLevel).toBe('low');
    }

    // Slack send_message is medium risk
    const slackMsg = writeTools.find((t) => t.name === 'slack.send_message');
    expect(slackMsg?.riskLevel).toBe('medium');
  });

  it('should validate plan response contracts type compatibility', () => {
    const samplePlan: PlanResponse = {
      kind: 'plan',
      thinking: 'Resolve board and list, then create card',
      summary: 'Create card on board',
      steps: [
        {
          id: 'step_1',
          tool: 'trello.create_card',
          description: 'Create card',
          args: {
            listId: 'list_123',
            title: 'Fix issue',
          },
          dependsOn: [],
        },
      ],
      warnings: [],
    };

    const sampleClarification: ClarificationResponse = {
      kind: 'clarification',
      question: 'Which board?',
      options: ['Frontend', 'Backend'],
      context: 'Multiple boards match Frontend',
    };

    const sampleRefusal: RefusalResponse = {
      kind: 'refusal',
      reason: 'Cannot delete all cards without card IDs',
      suggestion: 'Provide specific card IDs',
    };

    const responses: PlannerResponse[] = [samplePlan, sampleClarification, sampleRefusal];
    expect(responses).toHaveLength(3);
    expect(responses[0]?.kind).toBe('plan');
    expect(responses[1]?.kind).toBe('clarification');
    expect(responses[2]?.kind).toBe('refusal');
  });
});

describe('search tools declare the resources they discover', () => {
  const searchTools = ALL_TOOLS.filter((tool) => tool.name.includes('.search_'));

  it('maps each search tool to the resource its results identify', () => {
    expect(Object.fromEntries(searchTools.map((tool) => [tool.name, tool.discovers]))).toEqual({
      'trello.search_boards': 'board',
      'trello.search_lists': 'list',
      'trello.search_members': 'member',
      'trello.search_cards': 'card',
      'slack.search_channels': 'channel',
      'github.search_repos': 'repository',
      'github.search_issues': 'issue',
      'notion.search_databases': 'database',
      'jira.search_projects': 'project',
      'jira.search_issues': 'jira_issue',
    });
  });

  it('marks the search tools that can enumerate a resource with an empty query', () => {
    expect(ALL_TOOLS.filter((t) => t.listable).map((t) => t.name).sort()).toEqual([
      'calendar.list_calendars', 'github.search_repos', 'jira.search_projects', 'notion.search_databases', 'sheets.list_sheets', 'sheets.list_spreadsheets', 'slack.search_channels', 'telegram.list_chats', 'trello.search_boards', 'trello.search_lists', 'trello.search_members',
    ]);
    for (const tool of ALL_TOOLS.filter((t) => t.listable)) expect(tool.discovers, tool.name).toBeDefined();
  });

  it('steers member assignment on a new card to create_card.idMembers', () => {
    const description = (name: string) => ALL_TOOLS.find((t) => t.name === name)!.description;
    expect(description('trello.add_member')).toMatch(/đã có.*idMembers/is);
    expect(description('trello.create_card')).toMatch(/idMembers/);
  });

  it('requires a board for member search, as the Trello adapter does', () => {
    const tool = ALL_TOOLS.find((t) => t.name === 'trello.search_members')!;
    expect(tool.inputSchema.required).toEqual(expect.arrayContaining(['query', 'boardId']));
  });

  it('only lets read tools discover resources that some tool argument consumes', () => {
    for (const tool of ALL_TOOLS.filter((t) => t.discovers)) expect(tool.sideEffect).toBe('read');
    const consumed = new Set(ALL_TOOLS.flatMap((tool) => Object.values<any>(tool.inputSchema.properties ?? {})
      .map((property) => property['x-resource']).filter(Boolean)));
    for (const tool of searchTools) expect(consumed.has(tool.discovers!), tool.name).toBe(true);
  });
});
