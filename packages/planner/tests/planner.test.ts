import { describe, it, expect } from 'vitest';
import {
  AIPlanner,
  MockLLMProvider,
  WorkingMemory,
  classifyIntent,
} from '../src/index.js';
import { TRELLO_TOOLS, SLACK_TOOLS } from '@wap/tool-schemas';

describe('packages/planner (Task 10: Hierarchical Router & Planner with 1x Automatic Retry)', () => {
  const tools = [...TRELLO_TOOLS, ...SLACK_TOOLS];

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
  });

  describe('AIPlanner with 1x Retry', () => {
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
        memory: new WorkingMemory(),
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
        memory: new WorkingMemory(),
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
