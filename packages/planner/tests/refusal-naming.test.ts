import { describe, expect, it } from 'vitest';
import { ALL_TOOLS } from '@wap/tool-schemas';
import * as planner from '../src/index.js';
import { AIPlanner, MockLLMProvider, WorkingMemory, classifyIntent } from '../src/index.js';

// Calendar and Notion are registered but not configured in this session.
const catalog = ALL_TOOLS.filter(tool => tool.service !== 'calendar' && tool.service !== 'notion');
const calendar = 'Đặt lịch Google Calendar họp với team frontend lúc 3 giờ chiều mai';
const both = 'Tạo page trong Notion rồi đặt lịch Google Calendar cho buổi review';
const routeIntent = (message: string, tools = catalog) => {
  expect((planner as any).routeIntent).toBeTypeOf('function');
  return (planner as any).routeIntent(message, tools);
};

describe('W3-00b: routing reports the services a request needs but are not configured', () => {
  it('names one or several unavailable services, in registry order', () => {
    expect(routeIntent(calendar)).toEqual({ services: [], unavailable: [{ id: 'calendar', name: 'Google Calendar' }] });
    expect(routeIntent(both)).toEqual({ services: [], unavailable: [{ id: 'calendar', name: 'Google Calendar' }, { id: 'notion', name: 'Notion' }] });
  });

  it('reports nothing unavailable when every matched service is configured, and classifyIntent keeps its result', () => {
    expect(routeIntent('Tạo ticket Jira và báo Slack')).toEqual({ services: ['slack', 'jira'], unavailable: [] });
    for (const message of [calendar, both, 'Tạo ticket Jira và báo Slack', 'Xin chào', 'Gửi tài liệu hướng dẫn lên kênh ati-test']) {
      expect(classifyIntent(message, catalog)).toEqual(routeIntent(message).services);
    }
  });
});

describe('W3-00b: the planner refusal names the missing services', () => {
  const plan = async (searchMode: 'regex' | 'llm', userMessage: string, toolCatalog = catalog) => {
    const provider = new MockLLMProvider();
    const result = await new AIPlanner({ provider, toolCatalog, searchMode, prefetchDirectory: false, gatherSearch: async () => [] })
      .processMessage({ userMessage, memory: new WorkingMemory() });
    return { result: result as any, calls: provider.getCallCount() };
  };

  it.each(['regex', 'llm'] as const)('names a single missing service without calling the model (%s)', async mode => {
    const { result, calls } = await plan(mode, calendar);
    expect(result.kind).toBe('refusal');
    expect(result.reason).toBe('Google Calendar chưa được kết nối hoặc chưa có tài nguyên được phép.');
    expect(calls).toBe(0);
  });

  it.each(['regex', 'llm'] as const)('names every missing service (%s)', async mode => {
    const { result } = await plan(mode, both);
    expect(result.kind).toBe('refusal');
    expect(result.reason).toBe('Google Calendar và Notion chưa được kết nối hoặc chưa có tài nguyên được phép.');
  });

  it.each(['regex', 'llm'] as const)('keeps the general refusal when no service is configured at all (%s)', async mode => {
    const { result } = await plan(mode, 'Xin chào', []);
    expect(result).toMatchObject({ kind: 'refusal', reason: 'Dịch vụ được yêu cầu chưa khả dụng hoặc chưa được cấp quyền trong kết nối này.' });
  });
});
