import { describe, it, expect } from 'vitest';
import {
  ALL_TOOLS,
  TRELLO_TOOLS,
  SLACK_TOOLS,
  getToolDefinition,
  type ToolDefinition,
  type PlanResponse,
  type ClarificationResponse,
  type RefusalResponse,
  type PlannerResponse,
} from '../src/index.js';

describe('packages/tool-schemas (Task 2)', () => {
  it('should export exactly 11 tools (9 Trello + 2 Slack) with unique names', () => {
    expect(ALL_TOOLS).toHaveLength(11);
    expect(TRELLO_TOOLS).toHaveLength(9);
    expect(SLACK_TOOLS).toHaveLength(2);

    const names = ALL_TOOLS.map((t) => t.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(11);
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

  it('should enforce search_* read tools to have query or boardId and limit <= 10', () => {
    const readTools = ALL_TOOLS.filter((t) => t.sideEffect === 'read');
    expect(readTools).toHaveLength(6);

    for (const tool of readTools) {
      expect(tool.riskLevel).toBe('low');
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.outputSchema).toBeDefined();

      if (tool.name.includes('.search_')) {
        expect(tool.inputSchema.properties.limit).toBeDefined();
        expect(tool.inputSchema.properties.limit.maximum).toBeLessThanOrEqual(10);
      }
    }
  });

  it('should enforce write tools risk levels per spec v3', () => {
    const writeTools = ALL_TOOLS.filter((t) => t.sideEffect === 'write');
    expect(writeTools).toHaveLength(5);

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
