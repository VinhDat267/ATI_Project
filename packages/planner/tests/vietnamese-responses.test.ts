import { expect, it } from 'vitest';
import { AIPlanner, MockLLMProvider, WorkingMemory } from '../src/index.js';
import { TRELLO_TOOLS, SERVICE_REGISTRY } from '@wap/tool-schemas';
it('asks in Vietnamese when a named grounded resource cannot be found', async () => {
  const planner = new AIPlanner({ provider: new MockLLMProvider(), toolCatalog: TRELLO_TOOLS, gatherSearch: async () => [] });
  const result = await planner.processMessage({ userMessage: 'Tạo thẻ trên board Frontend', memory: new WorkingMemory() });
  expect(result).toMatchObject({ kind: 'clarification', question: expect.stringContaining('Không tìm thấy Frontend') });
});
it('asks in Vietnamese before a child lookup without its parent board', async () => {
  const planner = new AIPlanner({ provider: new MockLLMProvider(), toolCatalog: TRELLO_TOOLS, gatherSearch: async () => [] });
  const result = await planner.processMessage({ userMessage: 'Tạo thẻ trong list Cần làm', memory: new WorkingMemory() });
  expect(result).toMatchObject({ kind: 'clarification', question: 'Danh sách này nằm trong board nào?' });
});
it('refuses unavailable services in Vietnamese before calling the provider', async () => {
  const planner = new AIPlanner({ provider: new MockLLMProvider(), toolCatalog: TRELLO_TOOLS });
  const result = await planner.processMessage({ userMessage: 'Gửi tin qua Telegram', memory: new WorkingMemory() });
  expect(result).toMatchObject({ kind: 'refusal', reason: expect.stringContaining('Dịch vụ được yêu cầu') });
});
it('registry parent questions and planner fixed outward question/reason/context literals contain no English phrases', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/planner.ts', import.meta.url), 'utf8');
  expect(source).not.toMatch(/(?:question|reason|suggestion|context):\s*['`][^\n]*(?:Which |I could not|Please provide|The requested|Connect the service|These values|The lookup)/);
  for (const service of SERVICE_REGISTRY) for (const rule of service.gatherRules ?? []) if (rule.requires) expect(rule.requires.question).not.toMatch(/Which|must be|Select/);
});
