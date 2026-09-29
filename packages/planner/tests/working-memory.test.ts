import { describe, it, expect } from 'vitest';
import {
  WorkingMemory,
  MockLLMProvider,
  GeminiProvider,
} from '../src/index.js';

describe('packages/planner (Task 8: Working Memory & LLM Provider Abstraction)', () => {
  it('stores resolved entities and formats them as structured JSON and prompt context', () => {
    const memory = new WorkingMemory();
    memory.setEntity('board', { id: 'b_frontend', name: 'Frontend Web' });
    memory.addMember({ id: 'm_1', name: 'Minh', username: 'minhn' });

    const snapshot = memory.toJSON();
    expect(snapshot.board).toEqual({ id: 'b_frontend', name: 'Frontend Web' });
    expect(snapshot.members).toHaveLength(1);
    expect(snapshot.members[0]).toEqual({ id: 'm_1', name: 'Minh', username: 'minhn' });

    const promptStr = memory.toPromptString();
    expect(promptStr).toContain('b_frontend');
    expect(promptStr).toContain('Frontend Web');
    expect(promptStr).toContain('minhn');
  });

  it('provides deterministic responses and tracks call counts in MockLLMProvider', async () => {
    const mock = new MockLLMProvider();
    mock.setResponses([
      JSON.stringify({ kind: 'plan', summary: 'Plan 1', steps: [] }),
      JSON.stringify({ kind: 'plan', summary: 'Plan 2', steps: [] }),
    ]);

    const res1 = await mock.generatePlan({
      systemPrompt: 'System',
      conversationHistory: [{ role: 'user', content: 'Do task' }],
      toolCatalog: [],
      workingMemory: {},
    });
    expect(res1).toContain('Plan 1');
    expect(mock.getCallCount()).toBe(1);

    const res2 = await mock.generatePlan({
      systemPrompt: 'System',
      conversationHistory: [{ role: 'user', content: 'Do task' }],
      toolCatalog: [],
      workingMemory: {},
    });
    expect(res2).toContain('Plan 2');
    expect(mock.getCallCount()).toBe(2);
  });

  it('throws an error if GeminiProvider is created in live mode without GEMINI_API_KEY', () => {
    const original = process.env.GEMINI_API_KEY;
    try {
      delete process.env.GEMINI_API_KEY;
      expect(() => new GeminiProvider({ apiKey: '' })).toThrow(
        /GEMINI_API_KEY is required/i
      );
    } finally {
      if (original) {
        process.env.GEMINI_API_KEY = original;
      }
    }
  });
});
