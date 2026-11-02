import { describe, it, expect } from 'vitest';
import { AIPlanner, MockLLMProvider, WorkingMemory } from '../src/index.js';
import { ALL_TOOLS, SERVICE_REGISTRY, type ToolDefinition } from '@wap/tool-schemas';

// PBI-02: the landing playbook prompt, sent as-is from the landing page.
const PLAYBOOK = 'Tạo card trên bảng Trello cho lỗi đăng nhập Google, tạo issue trên kho GitHub kèm nhãn bug, '
  + 'ghi một dòng vào bảng tính Google Sheets và gửi thông báo vào kênh Slack của nhóm.';

// The sandbox catalog: shared services only, Trello/GitHub/Telegram need a personal connection.
const SANDBOX_TOOLS = ALL_TOOLS.filter((tool) => !['trello', 'github', 'telegram'].includes(tool.service));

function harness(toolCatalog: ToolDefinition[], found: (tool: string, query: string) => Array<{ id: string; name: string }> = () => []) {
  const provider = new MockLLMProvider();
  provider.setPlanResponses([{ kind: 'clarification', question: 'Bạn muốn làm gì tiếp?', context: 'test' }]);
  const searches: Array<{ tool: string; query: string }> = [];
  const planner = new AIPlanner({ provider, toolCatalog, serviceRegistry: SERVICE_REGISTRY, searchMode: 'regex',
    gatherSearch: async ({ tool, args }) => {
      searches.push({ tool, query: String(args.query) });
      return found(tool, String(args.query));
    } });
  const memory = new WorkingMemory();
  const send = (userMessage: string) => planner.processMessage({ userMessage, memory });
  return { provider, searches, memory, send };
}

describe('regex gather never takes a service name for a resource name', () => {
  it('refuses the playbook prompt in the sandbox because Trello and GitHub are not connected, without searching Slack for "Slack"', async () => {
    const { send, searches, provider } = harness(SANDBOX_TOOLS);
    const response = await send(PLAYBOOK);
    expect(searches).toEqual([]);
    expect(provider.getCallCount()).toBe(0);
    expect(response.kind).toBe('refusal');
    if (response.kind !== 'refusal') return;
    expect(response.reason).toBe('Trello và GitHub chưa được kết nối hoặc chưa có tài nguyên được phép.');
    expect(response.unavailableServices).toEqual([{ id: 'trello', name: 'Trello' }, { id: 'github', name: 'GitHub' }]);
  });

  it('keeps refusing when the same playbook prompt is sent again in the conversation', async () => {
    const { send, searches } = harness(SANDBOX_TOOLS);
    await send(PLAYBOOK);
    const again = await send(PLAYBOOK);
    expect(searches).toEqual([]);
    expect(again.kind).toBe('refusal');
  });

  it('searches no board named "Trello" or "tính" and no channel named "Slack" when every service is connected', async () => {
    const { send, searches, provider } = harness(ALL_TOOLS);
    await send(PLAYBOOK);
    expect(searches).toEqual([]);
    expect(provider.getCallCount()).toBe(1);
  });

  it.each([
    'Gửi thông báo vào kênh Slack của nhóm',
    'gửi tin nhắn vào KÊNH SLACK',
    'Post a message to channel Slack',
    'post to the CHANNEL slack now',
    'Gửi thông báo vào kênh Telegram của nhóm',
    'Tạo card trên bảng Trello',
    'tạo card trên BẢNG TRELLO cho nhóm',
    'Create a card on board Trello',
    'create a card on the BOARD trello',
    'Ghi một dòng vào bảng tính Google Sheets',
    'Tạo issue trên kho GitHub kèm nhãn bug',
    'Create an issue in repo GitHub',
  ])('runs no gather search for "%s"', async (message) => {
    const { send, searches } = harness(ALL_TOOLS);
    await send(message);
    expect(searches).toEqual([]);
  });

  it.each([
    ['Gửi thông báo vào kênh #ati-test', 'slack.search_channels', 'ati-test'],
    ['Gửi thông báo vào kênh general', 'slack.search_channels', 'general'],
    ['Post to channel ati-test', 'slack.search_channels', 'ati-test'],
    ['Gửi vào kênh Slack #ati-test', 'slack.search_channels', 'ati-test'],
    ['Tạo card trên bảng Frontend', 'trello.search_boards', 'Frontend'],
    // Existing behaviour, unchanged: a board name is a single token.
    ['Create a card on board ATI Sprint', 'trello.search_boards', 'ATI'],
    ['Tạo card trên bảng Trello rồi ghi vào bảng Frontend', 'trello.search_boards', 'Frontend'],
    ['Create GitHub issue in repo acme/app', 'github.search_repos', 'acme/app'],
  ])('still extracts the real resource name from "%s"', async (message, tool, query) => {
    const { send, searches } = harness(ALL_TOOLS, (_tool, name) => [{ id: `id_${name}`, name }]);
    await send(message);
    expect(searches).toContainEqual({ tool, query });
    expect(searches.every((search) => search.tool === tool)).toBe(true);
  });

  it('searches the name the correction reply gives, not the whole reply', async () => {
    const { send, searches } = harness(ALL_TOOLS, (_tool, name) => (name === 'Missing' ? [] : [{ id: `id_${name}`, name }]));
    await send('Gửi thông báo vào kênh Missing');
    await send('kênh general');
    expect(searches).toEqual([
      { tool: 'slack.search_channels', query: 'Missing' },
      { tool: 'slack.search_channels', query: 'general' },
    ]);
  });
});
