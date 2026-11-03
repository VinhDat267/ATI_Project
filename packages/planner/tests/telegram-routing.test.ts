import { expect, it } from 'vitest';
import { ALL_TOOLS, TELEGRAM_TOOLS } from '@wap/tool-schemas';
import { classifyIntent } from '../src/router.js';
import { AIPlanner, WorkingMemory } from '../src/index.js';

it.each([
  ['Gửi tin nhắn lên kênh ati-test', ['slack']],
  ['Báo nhóm Telegram ATI Test là đã hoàn tất', ['telegram']],
  ['Báo nhóm Telegram ATI Test là đã tạo issue', ['telegram']],
  ['Tạo issue GitHub rồi báo Telegram', ['github', 'telegram']],
  ['Gửi thông báo lên cả Slack và Telegram', ['slack', 'telegram']],
  ['Tạo issue rồi báo Telegram', ['github', 'telegram']],
  ['Báo Telegram là đã tạo issue rồi tạo issue mới', ['github', 'telegram']],
  ['Báo Telegram là đã tạo issue; tạo issue mới trên GitHub', ['github', 'telegram']],
  ['Báo Telegram là đã tạo issue\nTạo issue trên GitHub', ['github', 'telegram']],
  ['Báo Telegram và Slack là đã tạo issue', ['slack', 'telegram']],
  ['Báo Telegram rằng đã tạo issue và card', ['telegram']],
])('routes %s against the entire registry', (prompt, expected) => expect(classifyIntent(prompt, ALL_TOOLS)).toEqual(expected));

it('keeps implicit message requests on Slack while refusing explicit unavailable Telegram', () => {
  const catalog = ALL_TOOLS.filter(t => t.service !== 'telegram');
  expect(classifyIntent('Gửi tin nhắn lên kênh ati-test', catalog)).toEqual(['slack']);
  expect(classifyIntent('Báo nhóm Telegram ATI Test', catalog)).toEqual([]);
});

it('allows a completed-issue notification with only Telegram connected, preserving actual unavailable requests', () => {
  const catalog = ALL_TOOLS.filter(t => t.service === 'telegram');
  expect(classifyIntent('Báo nhóm Telegram ATI Test là đã tạo issue', catalog)).toEqual(['telegram']);
  expect(classifyIntent('Báo Telegram rằng đã tạo issue GitHub', catalog)).toEqual(['telegram']);
  expect(classifyIntent('Tạo issue GitHub rồi báo Telegram', catalog)).toEqual([]);
  expect(classifyIntent('Báo Telegram là đã tạo issue rồi tạo issue mới trên GitHub', catalog)).toEqual([]);
  expect(classifyIntent('Báo Telegram là đã tạo issue\nTạo issue GitHub', catalog)).toEqual([]);
});

it('routes generic message/notification intent to Telegram when Telegram is connected and Slack is not, while still refusing explicit Slack/channel mentions', () => {
  const catalog = ALL_TOOLS.filter(t => t.service === 'telegram' || t.service === 'github');
  expect(classifyIntent('Tạo issue GitHub rồi gửi tin nhắn thông báo cho nhóm Đội Sản Phẩm', catalog)).toEqual(['github', 'telegram']);
  expect(classifyIntent('Báo cho nhóm Vận Hành là đã hoàn tất', catalog)).toEqual(['telegram']);
  expect(classifyIntent('Gửi tin nhắn lên kênh ati-test', catalog)).toEqual([]);
  expect(classifyIntent('Gửi thông báo lên Slack', catalog)).toEqual([]);
});

it('preserves chat type (private vs supergroup) in WorkingMemory.__observed.chat during directory prefetch', async () => {
  const memory = new WorkingMemory();
  let capturedMemory: any;
  const planner = new AIPlanner({
    toolCatalog: TELEGRAM_TOOLS,
    searchMode: 'llm',
    gatherSearch: async ({ tool }) => {
      if (tool === 'telegram.list_chats') {
        return [
          { id: '777888999', title: 'Telegram của tôi (Minh)', type: 'private' },
          { id: '-1001234567890', title: 'Đội Sản Phẩm', type: 'supergroup' },
        ];
      }
      return [];
    },
    provider: {
      name: 'test',
      generatePlan: async (input) => {
        capturedMemory = structuredClone(input.workingMemory);
        return JSON.stringify({
          kind: 'plan',
          thinking: 'Gửi tin nhắn vào nhóm Đội Sản Phẩm',
          summary: 'Gửi tin nhắn Telegram',
          warnings: [],
          steps: [
            {
              id: 's1',
              tool: 'telegram.send_message',
              description: 'Gửi tin nhắn',
              args: { chatId: '-1001234567890', text: 'Xin chào' },
              dependsOn: [],
            },
          ],
        });
      },
    },
  });

  const res = await planner.processMessage({
    userMessage: 'Gửi tin nhắn Telegram vào nhóm Đội Sản Phẩm',
    memory,
  });
  expect(res.kind).toBe('plan');
  expect(capturedMemory.__observed?.chat).toEqual([
    { id: '777888999', title: 'Telegram của tôi (Minh)', type: 'private' },
    { id: '-1001234567890', title: 'Đội Sản Phẩm', type: 'supergroup' },
  ]);
});
