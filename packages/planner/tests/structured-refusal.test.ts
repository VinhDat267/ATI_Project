import { describe, expect, it } from 'vitest';
import { ALL_TOOLS } from '@wap/tool-schemas';
import { AIPlanner, MockLLMProvider, WorkingMemory } from '../src/index.js';

describe('UI-API-01: structured planner refusals', () => {
  it.each(['regex', 'llm'] as const)('returns the two unavailable services without changing the refusal text (%s)', async searchMode => {
    const provider = new MockLLMProvider();
    const planner = new AIPlanner({
      provider,
      toolCatalog: ALL_TOOLS.filter(tool => tool.service !== 'notion' && tool.service !== 'jira'),
      searchMode,
      prefetchDirectory: false,
    });

    const result = await planner.processMessage({
      userMessage: 'Tạo page trong Notion rồi tạo ticket Jira',
      memory: new WorkingMemory(),
    });

    expect(result).toEqual({
      kind: 'refusal',
      reason: 'Notion và Jira chưa được kết nối hoặc chưa có tài nguyên được phép.',
      suggestion: 'Hãy kết nối dịch vụ và cấp phạm vi tài nguyên được phép trước khi lập kế hoạch.',
      unavailableServices: [{ id: 'notion', name: 'Notion' }, { id: 'jira', name: 'Jira' }],
    });
    expect(provider.getCallCount()).toBe(0);
  });

  it.each(['regex', 'llm'] as const)('omits unavailable services when no registered service was identified (%s)', async searchMode => {
    const planner = new AIPlanner({ provider: new MockLLMProvider(), toolCatalog: [], searchMode });

    const result = await planner.processMessage({ userMessage: 'Xin chào', memory: new WorkingMemory() });

    expect(result).toEqual({
      kind: 'refusal',
      reason: 'Dịch vụ được yêu cầu chưa khả dụng hoặc chưa được cấp quyền trong kết nối này.',
      suggestion: 'Hãy kết nối dịch vụ và cấp phạm vi tài nguyên được phép trước khi lập kế hoạch.',
    });
  });

  it.each(['regex', 'llm'] as const)('keeps model refusals without unavailable services (%s)', async searchMode => {
    const provider = new MockLLMProvider();
    provider.setPlanResponses([{
      kind: 'refusal',
      reason: 'Yêu cầu này không được hỗ trợ.',
      suggestion: 'Hãy chọn thao tác có trong danh mục.',
    }]);
    const planner = new AIPlanner({ provider, toolCatalog: ALL_TOOLS, searchMode, prefetchDirectory: false });

    const result = await planner.processMessage({ userMessage: 'Gửi tin nhắn Slack', memory: new WorkingMemory() });

    expect(result).toEqual({
      kind: 'refusal',
      reason: 'Yêu cầu này không được hỗ trợ.',
      suggestion: 'Hãy chọn thao tác có trong danh mục.',
    });
    expect(provider.getCallCount()).toBe(1);
  });

  it.each(['regex', 'llm'] as const)('discards model-generated unavailable services because the router owns them (%s)', async searchMode => {
    const provider = new MockLLMProvider();
    provider.setPlanResponses([{
      kind: 'refusal',
      reason: 'Yêu cầu này không được hỗ trợ.',
      suggestion: 'Hãy chọn thao tác có trong danh mục.',
      unavailableServices: [{ id: 'notion', name: 'Notion' }],
    }]);
    const planner = new AIPlanner({ provider, toolCatalog: ALL_TOOLS, searchMode, prefetchDirectory: false });

    const result = await planner.processMessage({ userMessage: 'Gửi tin nhắn Slack', memory: new WorkingMemory() });

    expect(result).toEqual({
      kind: 'refusal',
      reason: 'Yêu cầu này không được hỗ trợ.',
      suggestion: 'Hãy chọn thao tác có trong danh mục.',
    });
    expect(provider.getCallCount()).toBe(1);
  });
});
