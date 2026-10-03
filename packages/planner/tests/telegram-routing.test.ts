import { expect, it } from 'vitest';
import { ALL_TOOLS } from '@wap/tool-schemas';
import { classifyIntent } from '../src/router.js';

it.each([
  ['Gửi tin nhắn lên kênh ati-test', ['slack']],
  ['Báo nhóm Telegram ATI Test là đã hoàn tất', ['telegram']],
  // Existing GitHub metadata also matches "issue", including past-tense mentions.
  ['Báo nhóm Telegram ATI Test là đã tạo issue', ['github', 'telegram']],
  ['Tạo issue GitHub rồi báo Telegram', ['github', 'telegram']],
  ['Gửi thông báo lên cả Slack và Telegram', ['slack', 'telegram']],
])('routes %s against the entire registry', (prompt, expected) => expect(classifyIntent(prompt, ALL_TOOLS)).toEqual(expected));

it('keeps implicit message requests on Slack while refusing explicit unavailable Telegram', () => {
  const catalog = ALL_TOOLS.filter(t => t.service !== 'telegram');
  expect(classifyIntent('Gửi tin nhắn lên kênh ati-test', catalog)).toEqual(['slack']);
  expect(classifyIntent('Báo nhóm Telegram ATI Test', catalog)).toEqual([]);
});
